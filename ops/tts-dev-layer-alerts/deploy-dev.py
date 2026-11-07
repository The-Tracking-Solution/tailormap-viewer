#!/usr/bin/env python3
"""Build and activate map alerts on the accepted LT3 DEV viewer."""
import argparse
import fcntl
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import urllib.request

SOURCE_COMMIT = 'dd27a0b9b149ca9b07f0ea1f9fbd3ed82bf9a783'
SOURCE_TREE = '5e6302f77256df3c8a146b862c1ea9373a2ed6f1'
ROOT = Path('/srv/tailormap-releases/dev-layer-alerts-20261107')
STATIC = Path('/var/tailormap/dev/static')
CANDIDATES = Path('/var/tailormap/candidates')
BACKUPS = Path('/var/backups/tailormap/dev')
BASE_VIEWER = CANDIDATES / 'tts-dev-follow-20261101-branded'
BASE_COMMIT = '6b7cdd2cc4d29157cc67486ec2679d2e184c42a1'
IMAGE = 'sha256:0f1d8bf4d824c2db31570ea2609edce97bc4b0e2a4d9aa1803e4d116bd567197'
SERVICE = 'tailormap'
BASE_COMPOSE_FILE = '/srv/tailormap-dev/docker-compose.yml'
REPOSITORY = 'https://github.com/The-Tracking-Solution/tailormap-viewer.git'
BUILDER_IMAGE = 'node:24.22.1'
BRANDING = ('apple-touch-icon.png', 'favicon.ico', 'favicon.svg', 'icons/logo.svg')


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def run(args, cwd=None, log=None):
    if log is None:
        result = subprocess.run(args, cwd=cwd, text=True, capture_output=True)
        require(result.returncode == 0, result.stderr.strip() or result.stdout.strip() or 'Opdracht mislukt')
        return result.stdout.strip()
    with Path(log).open('w') as output:
        process = subprocess.Popen(args, cwd=cwd, stdout=output, stderr=subprocess.STDOUT)
        try:
            while True:
                try:
                    result = process.wait(timeout=30)
                    break
                except subprocess.TimeoutExpired:
                    print('  Nog bezig; log:', log, flush=True)
        except BaseException:
            process.terminate()
            process.wait(timeout=15)
            raise
    if result:
        tail = '\n'.join(Path(log).read_text(errors='replace').splitlines()[-45:])
        raise RuntimeError('Opdracht mislukt; log: ' + str(log) + '\n' + tail)
    return ''


def inspect():
    return json.loads(run(['docker', 'inspect', 'tailormap-dev']))[0]


def version():
    with urllib.request.urlopen('http://127.0.0.1:8085/version.json', timeout=5) as response:
        return json.load(response)


def compose_command(files):
    require(1 <= len(files) <= 2 and files[0] == BASE_COMPOSE_FILE, 'Onverwachte DEV Compose-invoer.')
    if len(files) == 2:
        # The previous DEV runner may have recreated the service with this pinned-image override.
        override = Path(files[1])
        require(override.parent.parent == BACKUPS and override.name == 'pinned-image.json'
                and override.parent.name.startswith('follow-selected-feature-')
                and override.is_file() and not override.is_symlink(), 'Onbekende DEV Compose-override.')
        require(json.loads(override.read_text()) == {'services': {SERVICE: {'image': IMAGE}}},
                'De vorige DEV-imageoverride is gewijzigd.')
    command = ['docker', 'compose', '--project-directory', '/srv/tailormap-dev', '-p', 'tailormap-dev']
    for file in files:
        command.extend(['-f', file])
    return command


def compose_state(files):
    config = json.loads(run(compose_command(files) + ['config', '--format', 'json']))
    service = config['services'][SERVICE]
    require(service.get('container_name') == 'tailormap-dev', 'Onverwachte doelcontainer.')
    configured_image = json.loads(run(['docker', 'image', 'inspect', service['image']]))[0]['Id']
    require(configured_image == IMAGE, 'Compose gebruikt een andere API-image.')
    fingerprint = hashlib.sha256(json.dumps(config, sort_keys=True).encode()).hexdigest()
    return fingerprint, service


def baseline():
    container = inspect()
    require(container['State']['Running'] and container['Image'] == IMAGE, 'DEV draait niet op de vastgestelde API-image.')
    labels = container['Config'].get('Labels') or {}
    require(labels.get('com.docker.compose.project') == 'tailormap-dev'
            and labels.get('com.docker.compose.service') == SERVICE, 'Onverwachte DEV Compose-service.')
    files = labels.get('com.docker.compose.project.config_files', '').split(',')
    require(STATIC.is_symlink(), 'DEV static is geen symlink.')
    require(any(m['Source'] == str(STATIC) and m['Destination'] == '/home/cnb/static'
                for m in container['Mounts']), 'DEV heeft een andere static-mount.')
    env = dict(item.split('=', 1) for item in container['Config'].get('Env', []) if '=' in item)
    if container['HostConfig']['NetworkMode'] == 'host':
        require(env.get('SERVER_PORT') == '8085', 'Onverwachte DEV-poort.')
    else:
        ports = {b['HostPort'] for bindings in (container['NetworkSettings'].get('Ports') or {}).values()
                 if bindings for b in bindings}
        require(ports == {'8085'}, 'Onverwachte DEV-poortbinding.')
    fingerprint, service = compose_state(files)
    for key, value in (service.get('environment') or {}).items():
        expected = None if value is None else str(value)
        # Docker Compose escapes dollar signs when serializing password hashes.
        if expected is not None and key == 'ADMIN_HASHED_PASSWORD':
            expected = expected.replace('$$', '$')
        require((key not in env if expected is None else env.get(key) == expected),
                'Compose wijkt af van de actieve container voor sleutel ' + key)
    current_version = version()
    require(current_version.get('ttsBuild', {}).get('commit') == BASE_COMMIT, 'DEV-viewer is inmiddels gewijzigd.')
    old = STATIC.resolve()
    require(old == BASE_VIEWER and json.loads((old / 'version.json').read_text()) == current_version,
            'Static-map en actieve DEV-viewer verschillen van de vastgelegde basis.')
    return container['Id'], files, fingerprint, old, current_version


def atomic_link(target):
    with tempfile.TemporaryDirectory(prefix='.layer-alerts-', dir=STATIC.parent) as directory:
        temporary = Path(directory) / 'static'
        temporary.symlink_to(target, target_is_directory=True)
        os.replace(temporary, STATIC)


def restart(state, logfile):
    run(compose_command(state['compose_files']) + ['up', '-d', '--no-deps', '--no-build',
        '--pull', 'never', '--force-recreate', SERVICE], log=logfile)


def wait_up(commit):
    last_error = 'nog niet gestart'
    deadline = time.monotonic() + 180
    while time.monotonic() < deadline:
        try:
            container = inspect()
            require(container['Image'] == IMAGE and container['State']['Running'], 'DEV-container nog niet gereed')
            metadata = version().get('ttsBuild', {})
            require(metadata.get('commit') == commit, 'Viewer-versie nog niet gereed')
            if commit == SOURCE_COMMIT:
                require(metadata.get('sourceTree') == SOURCE_TREE, 'Onverwachte viewerbronboom.')
            with urllib.request.urlopen('http://127.0.0.1:8085/api/user', timeout=3) as response:
                user = json.load(response)
            require(isinstance(user.get('isAuthenticated'), bool), 'API-respons nog niet gereed')
            return
        except Exception as error:
            last_error = str(error)
            time.sleep(2)
    raise RuntimeError('DEV werd niet gezond: ' + last_error)


def rollback(statefile):
    statefile = Path(statefile)
    state = json.loads(statefile.read_text())
    require(state['image'] == IMAGE and state['new_commit'] == SOURCE_COMMIT, 'Onbekende rollbackregistratie.')
    require(STATIC.is_symlink() and str(STATIC.resolve()) == state['new_viewer'],
            'Deze viewer is niet meer actief; rollback afgebroken.')
    fingerprint, _service = compose_state(state['compose_files'])
    require(fingerprint == state['compose_fingerprint'], 'Compose is na deze uitrol gewijzigd.')
    try:
        container = inspect()
    except RuntimeError:
        container = None
    require(container is None or container['Image'] == IMAGE, 'DEV gebruikt inmiddels een andere API-image.')
    require(Path(state['old_viewer']) == BASE_VIEWER and BASE_VIEWER.is_dir(), 'Oude DEV-viewer ontbreekt.')
    atomic_link(state['old_viewer'])
    restart(state, statefile.parent / 'rollback.log')
    wait_up(BASE_COMMIT)
    print('Rollback geslaagd: vorige DEV-viewer en dezelfde API-image actief.', flush=True)


def brand(candidate, old):
    require({p.relative_to(candidate).as_posix() for p in candidate.rglob('styles-*.css')}
            == {p.relative_to(old).as_posix() for p in old.rglob('styles-*.css')},
            'Globale stylesheetnamen zijn gewijzigd; branding vereist beoordeling.')
    for language in ('en', 'nl', 'de'):
        require((candidate / language / 'index.html').is_file(), 'Build mist locale ' + language)
        for name in BRANDING:
            source = old / language / name
            target = candidate / language / name
            require(source.is_file() and not source.is_symlink(), 'Brandingbestand ontbreekt: ' + str(source))
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)
        for source in (old / language).glob('styles-*.css'):
            shutil.copy2(source, candidate / language / source.name)
        manifest = old / language / 'manifest.webmanifest'
        if manifest.is_file():
            shutil.copy2(manifest, candidate / language / manifest.name)
            if (candidate / language / (manifest.name + '.gz')).exists():
                (candidate / language / (manifest.name + '.gz')).write_bytes(gzip.compress(manifest.read_bytes(), mtime=0))
        index = candidate / language / 'index.html'
        title = re.search(r'<title>.*?</title>', (old / language / 'index.html').read_text(), re.S)
        if title:
            index.write_text(re.sub(r'<title>.*?</title>', lambda match: title.group(0), index.read_text(), count=1, flags=re.S))
        for path in [index, *(candidate / language / name for name in BRANDING),
                     *(candidate / language).glob('styles-*.css')]:
            path.with_name(path.name + '.gz').write_bytes(gzip.compress(path.read_bytes(), mtime=0))


def activate(statefile):
    statefile = Path(statefile)
    state = json.loads(statefile.read_text())
    try:
        atomic_link(state['new_viewer'])
        restart(state, statefile.parent / 'activate.log')
        wait_up(SOURCE_COMMIT)
    except BaseException:
        if str(STATIC.resolve()) == state['new_viewer']:
            print('Activering mislukt; vorige DEV wordt teruggezet.', flush=True)
            rollback(statefile)
        raise


def deploy():
    active = ROOT / 'active.json'
    if active.exists():
        state = json.loads(active.read_text())
        if str(STATIC.resolve()) == state['candidate'] and version().get('ttsBuild', {}).get('commit') == SOURCE_COMMIT:
            print('Deze DEV-release is al actief. Rollback:', state['rollback'])
            return

    original = baseline()
    _container_id, files, fingerprint, old, old_version = original
    ROOT.mkdir(parents=True, exist_ok=True)
    attempt = Path(tempfile.mkdtemp(prefix='build-', dir=ROOT))
    candidate = CANDIDATES / ('tts-dev-layer-alerts-20261107-' + attempt.name.removeprefix('build-') + '-branded')
    require(not candidate.exists(), 'De nieuwe DEV-kandidaat bestaat al.')
    viewer = attempt / 'viewer'
    print('[1/3] Bron ophalen; bestaande DEV blijft draaien. Werkmap:', attempt, flush=True)
    run(['git', 'init', str(viewer)])
    run(['git', 'fetch', '--depth=1', REPOSITORY, SOURCE_COMMIT], cwd=viewer)
    run(['git', 'checkout', '--detach', 'FETCH_HEAD'], cwd=viewer)
    require(run(['git', 'rev-parse', 'HEAD'], cwd=viewer) == SOURCE_COMMIT
            and run(['git', 'rev-parse', 'HEAD^{tree}'], cwd=viewer) == SOURCE_TREE,
            'Broncommit of bronboom wijkt af.')

    lint_files = ' '.join([
        'projects/core/src/lib/components/layer-alerts/*.ts',
        'projects/core/src/lib/components/layer-alerts/*.html',
        'projects/core/src/lib/layout/base-layout/base-layout.component.ts',
        'projects/core/src/lib/layout/base-layout/base-layout.component.html',
        'projects/api/src/lib/services/authenticated-user.service.ts',
        'projects/api/src/lib/services/tailormap-api-v1.service.model.ts',
        'projects/api/src/lib/services/tailormap-api-v1.service.ts',
        'projects/api/src/lib/services/tailormap-api.constants.ts',
    ])
    build_command = '\n'.join([
        'npm ci --no-audit --no-fund',
        'npx --no-install eslint ' + lint_files,
        'npm run test',
        'npm run build -- --app=app',
    ])
    print('[2/3] Viewer testen en bouwen (5 GiB, 2 CPU); DEV blijft draaien.', flush=True)
    builder = 'tailormap-dev-alerts-build-' + str(os.getpid())
    try:
        run(['docker', 'run', '--rm', '--name', builder, '--memory=5g', '--memory-swap=5g', '--cpus=2',
             '-e', 'NODE_OPTIONS=--max-old-space-size=3584', '-e', 'NG_BUILD_MAX_WORKERS=1',
             '-e', 'NG_BUILD_PARALLEL_TS=0', '-e', 'CI=true',
             '--mount', 'type=bind,src=' + str(viewer) + ',dst=/work', '-w', '/work',
             BUILDER_IMAGE, 'sh', '-eu', '-c', build_command], log=attempt / 'build.log')
        require(not run(['git', 'status', '--porcelain', '--untracked-files=no'], cwd=viewer),
                'Build wijzigde bronbestanden.')
        shutil.copytree(viewer / 'dist/app', candidate)
    finally:
        subprocess.run(['docker', 'rm', '-f', builder], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        shutil.rmtree(viewer)

    brand(candidate, old)
    metadata_path = candidate / 'version.json'
    metadata = json.loads(metadata_path.read_text())
    metadata['ttsBuild'] = {
        **old_version['ttsBuild'], 'feature': 'layer-alerts', 'preview': 16, 'commit': SOURCE_COMMIT,
        'sourceTree': SOURCE_TREE, 'previousViewerCommit': BASE_COMMIT, 'layerAlerts': True,
    }
    metadata_path.write_text(json.dumps(metadata, indent=2) + '\n')
    compressed = metadata_path.with_suffix('.json.gz')
    if compressed.is_file():
        compressed.write_bytes(gzip.compress(metadata_path.read_bytes(), mtime=0))
    for path in [candidate, *candidate.rglob('*')]:
        if not path.is_symlink():
            path.chmod(0o755 if path.is_dir() else 0o644)

    require(baseline() == original, 'DEV wijzigde tijdens de build.')
    backup = Path(tempfile.mkdtemp(prefix='layer-alerts-20261107-', dir=BACKUPS))
    state = {'image': IMAGE, 'old_viewer': str(old), 'new_viewer': str(candidate), 'new_commit': SOURCE_COMMIT,
             'compose_files': files, 'compose_fingerprint': fingerprint}
    statefile = backup / 'state.json'
    statefile.write_text(json.dumps(state, indent=2))
    shutil.copy2(__file__, backup / 'runner.py')
    rollback_script = backup / 'rollback.sh'
    rollback_script.write_text('#!/bin/sh\nset -eu\nexec python3 ' + shlex.quote(str(backup / 'runner.py'))
                               + ' --rollback ' + shlex.quote(str(statefile)) + '\n')
    rollback_script.chmod(0o700)

    print('[3/3] Alleen Tailormap DEV wordt nu kort onderbroken. Rollback:', rollback_script, flush=True)
    activate(statefile)
    active.write_text(json.dumps({'commit': SOURCE_COMMIT, 'tree': SOURCE_TREE, 'rollback': str(rollback_script),
                                  'candidate': str(candidate)}, indent=2) + '\n')
    print('DEV actief op 8085. Viewercommit:', SOURCE_COMMIT, flush=True)
    print('Buildlog:', attempt / 'build.log', flush=True)
    print('Kaartmeldingen zijn beschikbaar voor configuratie per DEV-applicatie.', flush=True)
    print('Rollback: bash ' + str(rollback_script), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument('--deploy', action='store_true')
    action.add_argument('--rollback', type=Path)
    args = parser.parse_args()
    try:
        require(os.geteuid() == 0, 'Voer dit op LT3 als root uit.')
        os.umask(0o077)
        lock_path = Path('/var/backups/tailormap/dev/follow-selected-feature.lock')
        lock_path.parent.mkdir(parents=True, exist_ok=True)
        with lock_path.open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            signal.signal(signal.SIGTERM, lambda signum, frame: sys.exit(143))
            if args.rollback:
                rollback(args.rollback)
            else:
                deploy()
        return 0
    except Exception as error:
        print('STOP:', error, file=sys.stderr, flush=True)
        return 1


if __name__ == '__main__':
    sys.exit(main())
