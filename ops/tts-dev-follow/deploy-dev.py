#!/usr/bin/env python3
"""Build and activate the selected-feature follower on the accepted LT3 DEV base."""
import argparse
import datetime
import fcntl
import gzip
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import signal
import subprocess
import sys
import time
import urllib.request

SOURCE_COMMIT = '6b7cdd2cc4d29157cc67486ec2679d2e184c42a1'
SOURCE_TREE = 'b7562b8608117cf4e9ac5718b4fa138dfc07c8fb'
ROOT = Path('/srv/tailormap-releases/dev-follow-20261101')
STATIC = Path('/var/tailormap/dev/static')
CANDIDATE = Path('/var/tailormap/candidates/tts-dev-follow-20261101-branded')
BASE_SOURCE = Path('/srv/tailormap-user-start-ui-20261023T094132Z/viewer')
BASE_COMMIT = '3d8bfa03c797dbd30e4aedcb16ef1f3881d893ec'
BASE_TREE = 'b2b81f9b1d31ef6455172e32d3498fba3ca9cfbf'
IMAGE = 'sha256:0f1d8bf4d824c2db31570ea2609edce97bc4b0e2a4d9aa1803e4d116bd567197'
SERVICE = 'tailormap'
COMPOSE = ['docker', 'compose', '--project-directory', '/srv/tailormap-dev',
           '-p', 'tailormap-dev', '-f', '/srv/tailormap-dev/docker-compose.yml']
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


def baseline():
    container = inspect()
    require(container['State']['Running'] and container['Image'] == IMAGE, 'DEV draait niet op de vastgestelde API-image.')
    labels = container['Config'].get('Labels') or {}
    require(labels.get('com.docker.compose.project') == 'tailormap-dev'
            and labels.get('com.docker.compose.service') == SERVICE
            and labels.get('com.docker.compose.project.config_files') == '/srv/tailormap-dev/docker-compose.yml',
            'Onverwachte DEV Compose-invoer.')
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
    config = json.loads(run(COMPOSE + ['config', '--format', 'json']))
    service = config['services'][SERVICE]
    require(service.get('container_name') == 'tailormap-dev', 'Onverwachte doelcontainer.')
    configured_image = json.loads(run(['docker', 'image', 'inspect', service['image']]))[0]['Id']
    require(configured_image == IMAGE, 'Compose gebruikt een andere API-image.')
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
    require(json.loads((old / 'version.json').read_text()) == current_version, 'Static-map en actieve viewer verschillen.')
    git = ['git', '-c', 'safe.directory=' + str(BASE_SOURCE), '-C', str(BASE_SOURCE)]
    require(run(git + ['rev-parse', 'HEAD']) == BASE_COMMIT
            and run(git + ['rev-parse', 'HEAD^{tree}']) == BASE_TREE, 'De behouden DEV-bronbasis wijkt af.')
    return container, config, old, current_version


def atomic_link(target):
    temporary = STATIC.with_name(STATIC.name + '.follow-next')
    require(not temporary.exists() and not temporary.is_symlink(), 'Tijdelijke omschakellink bestaat al.')
    temporary.symlink_to(target, target_is_directory=True)
    os.replace(temporary, STATIC)


def restart(state, logfile):
    override = Path(state['backup']) / 'pinned-image.json'
    override.write_text(json.dumps({'services': {SERVICE: {'image': IMAGE}}}))
    run(COMPOSE + ['-f', str(override), 'up', '-d', '--no-deps', '--no-build',
                   '--pull', 'never', '--force-recreate', SERVICE], log=logfile)


def wait_up(commit):
    last_error = 'nog niet gestart'
    deadline = time.monotonic() + 180
    while time.monotonic() < deadline:
        try:
            container = inspect()
            require(container['Image'] == IMAGE and container['State']['Running'], 'DEV-container nog niet gereed')
            require(version().get('ttsBuild', {}).get('commit') == commit, 'Viewer-versie nog niet gereed')
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
    require(str(STATIC.resolve()) in (state['old_viewer'], str(CANDIDATE)), 'DEV is na deze uitrol gewijzigd.')
    config = json.loads(run(COMPOSE + ['config', '--format', 'json']))
    require(config == state['compose_config'], 'Compose is na deze uitrol gewijzigd.')
    try:
        container = inspect()
    except RuntimeError:
        container = None
    require(container is None or container['Image'] == IMAGE, 'DEV gebruikt inmiddels een andere API-image.')
    require(Path(state['old_viewer']).is_dir(), 'Oude viewer ontbreekt.')
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
        atomic_link(CANDIDATE)
        restart(state, statefile.parent / 'activate.log')
        wait_up(SOURCE_COMMIT)
    except BaseException:
        print('Activering mislukt; vorige DEV wordt teruggezet.', flush=True)
        rollback(statefile)
        raise


def deploy():
    if (ROOT / 'active.json').exists():
        require(version().get('ttsBuild', {}).get('commit') == SOURCE_COMMIT, 'Deze release was actief; DEV is later gewijzigd.')
        print('Deze DEV-release is al actief. Rollback:', json.loads((ROOT / 'active.json').read_text())['rollback'])
        return
    container, config, old, old_version = baseline()
    require(not ROOT.exists() and not CANDIDATE.exists(), 'Er bestaat een eerdere poging; behoud de logs en beoordeel eerst de uitvoer.')
    ROOT.mkdir(parents=True, mode=0o700)
    shutil.copy2(__file__, ROOT / 'deploy-dev.py')
    viewer = ROOT / 'viewer'
    print('[1/3] Bron ophalen; bestaande DEV blijft draaien.', flush=True)
    run(['git', 'init', str(viewer)])
    run(['git', 'fetch', '--depth=1', REPOSITORY, SOURCE_COMMIT], cwd=viewer)
    run(['git', 'checkout', '--detach', 'FETCH_HEAD'], cwd=viewer)
    require(run(['git', 'rev-parse', 'HEAD^{tree}'], cwd=viewer) == SOURCE_TREE, 'Bronboom wijkt af van de geteste integratie.')
    print('[2/3] Viewer testen/bouwen in begrensde container (5 GiB, 2 CPU); DEV blijft draaien.', flush=True)
    lint_files = 'projects/core/src/lib/components/feature-info/feature-info-content/feature-info-content.component.html projects/core/src/lib/components/feature-info/feature-info-content/feature-info-content.component.ts projects/core/src/lib/components/feature-info/feature-info-dialog/feature-info-dialog.component.html projects/core/src/lib/components/feature-info/feature-info-dialog/feature-info-dialog.component.spec.ts projects/core/src/lib/components/feature-info/feature-info-dialog/feature-info-dialog.component.ts projects/core/src/lib/components/feature-info/feature-info-follow.service.spec.ts projects/core/src/lib/components/feature-info/feature-info-follow.service.ts projects/core/src/lib/components/toolbar/geolocation/geolocation.component.spec.ts projects/core/src/lib/components/toolbar/geolocation/geolocation.component.ts projects/core/src/lib/services/map-follow.service.ts projects/core/src/lib/test-helpers/map-service.mock.ts projects/map/src/lib/helpers/map-follow.helper.spec.ts projects/map/src/lib/helpers/map-follow.helper.ts projects/map/src/lib/map-service/map.service.ts projects/map/src/lib/openlayers-map/openlayers-map.ts projects/map/src/public-api.ts'
    build_command = 'npm ci --no-audit --no-fund\nnpx eslint ' + lint_files + '\nnpm run test\nnpm run build -- --app=app'
    builder = 'tailormap-dev-follow-build-' + str(os.getpid())
    try:
        run(['docker', 'run', '--rm', '--name', builder, '--memory=5g', '--memory-swap=5g', '--cpus=2',
             '-e', 'NODE_OPTIONS=--max-old-space-size=3584', '-e', 'NG_BUILD_MAX_WORKERS=1',
             '-e', 'NG_BUILD_PARALLEL_TS=0', '-e', 'CI=true',
             '--mount', 'type=bind,src=' + str(viewer) + ',dst=/work', '-w', '/work',
             BUILDER_IMAGE, 'sh', '-eu', '-c', build_command], log=ROOT / 'build.log')
    finally:
        subprocess.run(['docker', 'rm', '-f', builder], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    require(not run(['git', 'status', '--porcelain', '--untracked-files=no'], cwd=viewer), 'Build wijzigde bronbestanden.')
    shutil.copytree(viewer / 'dist/app', CANDIDATE)
    brand(CANDIDATE, old)
    metadata = json.loads((viewer / 'dist/app/version.json').read_text())
    metadata['ttsBuild'] = {**old_version['ttsBuild'], 'feature': 'follow-selected-feature', 'preview': 15,
                            'commit': SOURCE_COMMIT, 'sourceTree': SOURCE_TREE, 'previousViewerCommit': BASE_COMMIT,
                            'followSelectedFeature': True, 'followEdgeMargin': 0.2}
    (CANDIDATE / 'version.json').write_text(json.dumps(metadata, indent=2) + '\n')
    for path in [CANDIDATE, *CANDIDATE.rglob('*')]:
        if not path.is_symlink():
            path.chmod(0o755 if path.is_dir() else 0o644)
    # Ensure the source/configuration we are about to replace did not change while the build ran.
    current, current_config, current_old, current_version = baseline()
    require(current['Id'] == container['Id'] and current_config == config
            and current_old == old and current_version == old_version, 'DEV wijzigde tijdens de build.')
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    backup = Path('/var/backups/tailormap/dev') / ('follow-selected-feature-' + stamp)
    backup.mkdir(mode=0o700)
    state = {'image': IMAGE, 'old_viewer': str(old), 'new_viewer': str(CANDIDATE), 'new_commit': SOURCE_COMMIT,
             'compose_config': config, 'backup': str(backup)}
    statefile = backup / 'state.json'
    statefile.write_text(json.dumps(state, indent=2))
    shutil.copy2(__file__, backup / 'runner.py')
    rollback_script = backup / 'rollback.sh'
    rollback_script.write_text('#!/bin/sh\nset -eu\nexec python3 ' + shlex.quote(str(backup / 'runner.py'))
                               + ' --rollback ' + shlex.quote(str(statefile)) + '\n')
    rollback_script.chmod(0o700)
    print('[3/3] Alleen Tailormap DEV wordt nu kort onderbroken. Rollback:', rollback_script, flush=True)
    activate(statefile)
    (ROOT / 'active.json').write_text(json.dumps({'commit': SOURCE_COMMIT, 'tree': SOURCE_TREE,
                                               'rollback': str(rollback_script), 'candidate': str(CANDIDATE)}, indent=2))
    print('DEV actief: kaartvolging toegevoegd; bestaande functies, branding en API behouden.', flush=True)
    print('Geen databaseactie uitgevoerd. STAGING en LT4 zijn niet gewijzigd.', flush=True)
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
