#!/usr/bin/env python3
"""Prepare viewer, runtime image and immutable configuration evidence; never activate DEV."""
import argparse
import base64
import fcntl
import gzip
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import shlex
import subprocess
import sys
import tempfile

spec=importlib.util.spec_from_file_location('migration_runner',Path(__file__).with_name('migrate-dev-probe.py'))
helpers=importlib.util.module_from_spec(spec);spec.loader.exec_module(helpers)
ROOT=helpers.ROOT
VIEWER_COMMIT='ca468d9dcd93728efc3346b3191c319175cfb021'
VIEWER_TREE='7743dee7f968f9e3005a28bd150af8a1331a79aa'
OLD_COMMIT='8f19687452d4c819f91afbcbf706f1bd3f3054c7'
OLD_IMAGE='sha256:0f1d8bf4d824c2db31570ea2609edce97bc4b0e2a4d9aa1803e4d116bd567197'
COMPOSE=['/srv/tailormap-dev/docker-compose.yml','/var/backups/tailormap/dev/follow-selected-feature-20261101T134734Z/pinned-image.json']
STATIC=Path('/var/tailormap/dev/static')
CANDIDATES=Path('/var/tailormap/candidates')
NODE_IMAGE='node:24.22.1'
BRANDING=('apple-touch-icon.png','favicon.ico','favicon.svg','icons/logo.svg')
BASE_CSS_HASH='8323c925d1d038887f83b502971aaf71a4f6c12723082836c963f1f66a23bdcd'


def require(ok,message):
    if not ok:raise ValueError(message)


def digest(path):
    with Path(path).open('rb') as stream:return hashlib.file_digest(stream,'sha256').hexdigest()


def capture(args,**kwargs):return helpers.capture(args,**kwargs)


def compose(files):
    args=['docker','compose','--project-directory','/srv/tailormap-dev','-p','tailormap-dev']
    for path in files:args+=['-f',str(path)]
    return args


def render(files):return json.loads(capture(compose(files)+['config','--format','json']))


def fingerprint(value):return hashlib.sha256(json.dumps(value,sort_keys=True).encode()).hexdigest()


def baseline():
    c=json.loads(capture(['docker','inspect','tailormap-dev']))[0]
    require(c['State']['Running'] and c['Image']==OLD_IMAGE,'Actieve DEV-API wijkt af')
    require(c['Config'].get('User')=='1002:1001' and c['HostConfig']['NetworkMode']=='host','DEV-gebruiker/netwerk wijkt af')
    labels=c['Config'].get('Labels') or {}
    require(labels.get('com.docker.compose.project')=='tailormap-dev' and labels.get('com.docker.compose.service')=='tailormap','Onverwachte Compose-service')
    require(labels.get('com.docker.compose.project.config_files','').split(',')==COMPOSE,'Compose-bestanden wijken af')
    env=dict(e.split('=',1) for e in c['Config'].get('Env',[]) if '=' in e)
    require(env.get('SERVER_PORT')=='8085','Onverwachte DEV-poort')
    require('populate-testdata' not in env.get('SPRING_PROFILES_ACTIVE',''),'Testdata-profiel mag niet worden uitgerold')
    require(STATIC.is_symlink(),'DEV static is geen symlink')
    expected={(str(STATIC),'/home/cnb/static',False),('/var/tailormap/dev/logs','/var/log/tailormap',True),('/var/tailormap/dev/uploads','/var/tailormap/uploads',True)}
    require({(m['Source'],m['Destination'],m['RW']) for m in c['Mounts']}==expected,'DEV-volumes wijken af')
    old=STATIC.resolve();version=json.loads((old/'version.json').read_text())
    require(version.get('ttsBuild',{}).get('commit')==OLD_COMMIT,'DEV-viewer is gewijzigd')
    config=render(COMPOSE);service=config['services']['tailormap']
    require(service.get('container_name')=='tailormap-dev' and service.get('network_mode')=='host','Compose-doel wijkt af')
    require(not service.get('entrypoint'),'Bestaande expliciete entrypoint vereist beoordeling')
    command=service.get('command') or []
    require(not command or (isinstance(command,list) and all(x.startswith('--') for x in command)),'Bestaand startcommando vereist beoordeling')
    require(json.loads(capture(['docker','image','inspect',service['image']]))[0]['Id']==OLD_IMAGE,'Compose-image wijkt af')
    for key,value in (service.get('environment') or {}).items():
        expected_value=None if value is None else str(value)
        actual=env.get(key)
        require((key not in env if expected_value is None else actual in (expected_value,expected_value.replace('$$','$'))),'Compose wijkt af van runtime voor '+key)
    return c,config,old,version


def load_probe(path):
    path=path.resolve();data=json.loads(path.read_text())
    require(path.name=='probe.json' and path.parent.parent==ROOT and data.get('workdir')==str(path.parent),'Onverwachte proefregistratie')
    require(data.get('state')=='API_START_VERIFIED_ON_COPY' and data.get('api_start_verified') and data.get('probe_runtime_removed'),'API-opstartproef niet bevestigd')
    require(data.get('container')=='postgis18-dev' and data.get('source')=='tailormap','Onverwachte proefbron')
    require(re.fullmatch(r'tts_upstream_probe_\d{8}t\d{6}z_[0-9a-f]{8}',data.get('database','')),'Onverwachte proefdatabase')
    require(data.get('api_source_commit')==helpers.SOURCE_COMMIT and data.get('api_source_tree')==helpers.SOURCE_TREE,'API-bron wijkt af')
    jar=path.parent/'api-build/source/target/tailormap-api.jar'
    require(data.get('api_jar')==str(jar) and digest(jar)==data.get('api_jar_sha256'),'API-jar wijkt af')
    require(re.fullmatch(r'sha256:[0-9a-f]{64}',data.get('build_image','')),'Bouwimage-ID ontbreekt')
    return data


def copy_dependencies(classpath_file,cache,destination):
    dependencies=classpath_file.read_text().strip().split(':');result=[]
    destination.mkdir()
    for index,item in enumerate(dependencies):
        require(item.startswith('/root/.m2/repository/'),'Onverwacht Maven-classpath')
        relative=Path(item).relative_to('/root/.m2')
        source=(cache/relative).resolve()
        require(source.is_relative_to(cache.resolve()) and source.is_file() and source.suffix=='.jar','Dependency ontbreekt of heeft onverwacht pad')
        name=f'{index:04d}-{source.name}';shutil.copy2(source,destination/name)
        result.append('/app/lib/'+name)
    require(result,'Leeg dependency-classpath')
    return result


def runtime_dockerfile(base):
    require(re.fullmatch(r'local/[a-z0-9/-]+:[a-z0-9-]+',base),'Onverwachte basistag')
    return f'''FROM {base}
USER root
WORKDIR /home/tts
COPY --chown=1002:1001 api.jar /app/api.jar
COPY --chown=1002:1001 lib /app/lib
COPY --chown=1002:1001 start.sh /app/start.sh
RUN mkdir -p /app/tmp /home/tts /home/cnb/static /var/log/tailormap /var/tailormap/uploads && chown 1002:1001 /app/tmp /home/tts
ENV HOME=/home/tts
USER 1002:1001
ENTRYPOINT ["/bin/sh","/app/start.sh"]
CMD []
'''


def make_readable(path):
    for item in [path,*path.rglob('*')]:
        require(not item.is_symlink(),'Onverwachte symlink in kandidaat')
        item.chmod(0o755 if item.is_dir() else 0o644)


def prepare(probe_path):
    probe=load_probe(probe_path)
    container,config,old,old_version=baseline()
    attempt=Path(tempfile.mkdtemp(prefix='prepare-',dir=ROOT));token=attempt.name.removeprefix('prepare-').replace('_','-')
    manifest=attempt/'prepared.json'
    state={'state':'PREPARING','probe':str(probe_path.resolve()),'old_container_id':container['Id'],'old_image':OLD_IMAGE,'old_viewer':str(old),'old_viewer_commit':OLD_COMMIT,'old_compose_files':COMPOSE,'old_compose_fingerprint':fingerprint(config),'api_source_commit':helpers.SOURCE_COMMIT,'api_source_tree':helpers.SOURCE_TREE,'viewer_commit':VIEWER_COMMIT,'viewer_tree':VIEWER_TREE,'activation_performed':False}
    manifest.write_text(json.dumps(state,indent=2)+'\n')
    (attempt/'original-rendered.json').write_text(json.dumps(config,indent=2)+'\n')
    originals=attempt/'configuration-backup';originals.mkdir()
    files=COMPOSE+['/srv/tailormap-dev/.env']
    for index,name in enumerate(files):
        path=Path(name)
        if path.is_file():
            require(not path.is_symlink(),'Configuratiebestand is een symlink')
            shutil.copy2(path,originals/f'{index}-{path.name}')
    state['configuration_hashes']={str(Path(p)):digest(p) for p in files if Path(p).is_file()}
    snapshot=attempt/'branding-input';snapshot.mkdir()
    baseline_css=gzip.decompress(base64.b64decode(Path(__file__).with_name('previous-styles.css.gz.b64').read_text()))
    require(hashlib.sha256(baseline_css).hexdigest()==BASE_CSS_HASH,'Referentie-CSS wijkt af')
    (attempt/'previous-styles.css').write_bytes(baseline_css)
    state['branding_hashes']={}
    for language in ('nl','en','de'):
        (snapshot/language/'icons').mkdir(parents=True)
        for name in [*BRANDING,'styles-YU6ZJSX5.css','index.html','manifest.webmanifest']:
            source=old/language/name
            if not source.exists() and name=='manifest.webmanifest':continue
            require(source.is_file() and not source.is_symlink(),'Brandingbestand ontbreekt: '+str(source))
            shutil.copy2(source,snapshot/language/name);state['branding_hashes'][str(source)]=digest(source)
    shutil.copy2(Path(__file__).with_name('transfer-branding.mjs'),attempt)
    viewer=attempt/'viewer';candidate=CANDIDATES/f'tts-dev-upstream-20261122-{token}-branded'
    require(not candidate.exists(),'Viewer-kandidaat bestaat al')
    print('[1/3] Nieuwe viewer bouwen; bestaande DEV blijft draaien. Werkmap:',attempt,flush=True)
    helpers.logged(['git','init','-q',str(viewer)],attempt/'source.log','Viewerbron')
    helpers.logged(['git','-C',str(viewer),'fetch','-q','--depth=1','https://github.com/The-Tracking-Solution/tailormap-viewer.git',VIEWER_COMMIT],attempt/'source.log','Viewerbron')
    helpers.logged(['git','-C',str(viewer),'checkout','-q','--detach','FETCH_HEAD'],attempt/'source.log','Viewerbron')
    require(capture(['git','-C',str(viewer),'rev-parse','HEAD^{tree}'])==VIEWER_TREE,'Viewerbronboom wijkt af')
    helpers.logged(['docker','pull',NODE_IMAGE],attempt/'viewer-build.log','Node-image ophalen')
    node=capture(['docker','image','inspect',NODE_IMAGE,'--format','{{.Id}}'])
    docker=['docker','run','--rm','--memory=5g','--memory-swap=5g','--cpus=2','-e','NODE_OPTIONS=--max-old-space-size=3584','-e','NG_BUILD_MAX_WORKERS=1','-e','NG_BUILD_PARALLEL_TS=0','-e','CI=true','--mount',f'type=bind,src={viewer},dst=/work','--mount',f'type=bind,src={attempt},dst=/release','-w','/work',node]
    script='npm ci --no-audit --no-fund\nnpm run build -- --app=app\n'
    for language in ('nl','en','de'):
        script+=f'set -- /work/dist/app/{language}/styles-*.css; test "$#" -eq 1\nnode /release/transfer-branding.mjs /release/previous-styles.css /release/branding-input/{language}/styles-YU6ZJSX5.css "$1" /work/dist/app/{language}/tts-branding-overrides.css /release/branding-{language}.json\n'
    helpers.logged(docker+['sh','-eu','-c',script],attempt/'viewer-build.log','Viewer bouwen en branding overzetten')
    require(not capture(['git','-C',str(viewer),'status','--porcelain','--untracked-files=no']),'Viewerbuild wijzigde bronbestanden')
    shutil.copytree(viewer/'dist/app',candidate)
    for language in ('nl','en','de'):
        folder=candidate/language
        require((folder/'index.html').is_file(),'Viewer-locale ontbreekt')
        for name in BRANDING:
            (folder/name).parent.mkdir(parents=True,exist_ok=True)
            shutil.copy2(snapshot/language/name,folder/name)
        webmanifest=snapshot/language/'manifest.webmanifest'
        if webmanifest.exists():shutil.copy2(webmanifest,folder/webmanifest.name)
        index=folder/'index.html';html=index.read_text()
        title=re.search(r'<title>.*?</title>',(snapshot/language/'index.html').read_text(),re.S)
        if title:html=re.sub(r'<title>.*?</title>',lambda _:title.group(0),html,count=1,flags=re.S)
        require('</head>' in html,'Viewer-index mist head')
        html=html.replace('</head>','<link rel="stylesheet" href="tts-branding-overrides.css"></head>',1);index.write_text(html)
        for path in [index,folder/'tts-branding-overrides.css',*(folder/n for n in BRANDING),*([folder/'manifest.webmanifest'] if webmanifest.exists() else [])]:
            path.with_name(path.name+'.gz').write_bytes(gzip.compress(path.read_bytes(),mtime=0))
        # Reject missing relative assets used by custom CSS, rather than silently losing fonts/images.
        css=(folder/'tts-branding-overrides.css').read_text()
        for url in re.findall(r'url\([\s\'\"]*([^\)\'\"\s]+)',css):
            if not re.match(r'^(?:[a-z]+:|/|#)',url,re.I):require((folder/url.split('?',1)[0]).is_file(),'Branding verwijst naar ontbrekend bestand: '+url)
    version=json.loads((candidate/'version.json').read_text());version['ttsBuild']={**old_version.get('ttsBuild',{}),'feature':'upstream-integration','commit':VIEWER_COMMIT,'sourceTree':VIEWER_TREE,'previousViewerCommit':OLD_COMMIT,'apiCommit':helpers.SOURCE_COMMIT}
    (candidate/'version.json').write_text(json.dumps(version,indent=2)+'\n');(candidate/'version.json.gz').write_bytes(gzip.compress((candidate/'version.json').read_bytes(),mtime=0));make_readable(candidate)
    print('[2/3] Bestaande API-jar en dependencies in runtime-image verpakken; geen API-herbouw.',flush=True)
    context=attempt/'image-context';context.mkdir();shutil.copy2(probe['api_jar'],context/'api.jar')
    deps=copy_dependencies(probe_path.resolve().parent/'api-build/classpath.txt',ROOT/'m2',context/'lib')
    cp='/app/api.jar:'+':'.join(deps)
    (context/'start.sh').write_text('#!/bin/sh\nset -eu\nset -f\nexec java ${JAVA_OPTS:--Xmx2g} -Djava.io.tmpdir=/app/tmp -Duser.home=/home/tts -cp '+shlex.quote(cp)+' org.tailormap.api.TailormapApiApplication "$@"\n')
    base_tag='local/tts-dev-upstream-base:20261122-'+token
    image_tag='local/tailormap-api:tts-dev-upstream-20261122-'+token
    capture(['docker','tag',probe['build_image'],base_tag]);(context/'Dockerfile').write_text(runtime_dockerfile(base_tag));make_readable(context)
    helpers.logged(['docker','build','--pull=false','--network=none','-t',image_tag,str(context)],attempt/'image-build.log','API-runtime verpakken')
    image_info=json.loads(capture(['docker','image','inspect',image_tag]))[0]
    require(image_info['Config'].get('User')=='1002:1001','Runtime-image heeft verkeerde gebruiker')
    runtime_env=dict(e.split('=',1) for e in container['Config'].get('Env',[]) if '=' in e)
    java_options=runtime_env.get('JAVA_OPTS','')
    require('\n' not in java_options and '\r' not in java_options,'Meerdere regels in JAVA_OPTS vereisen beoordeling')
    options_file=attempt/'runtime-options.env';options_file.write_text('JAVA_OPTS='+java_options+'\n')
    try:
        helpers.logged(['docker','run','--rm','--network','none','--entrypoint','/bin/sh','--env-file',str(options_file),image_info['Id'],'-c','set -efu; exec java ${JAVA_OPTS:--Xmx2g} -version'],attempt/'runtime-java.log','Java-opties controleren')
    finally:
        options_file.unlink(missing_ok=True)
    newpin=attempt/'pinned-image.json';newpin.write_text(json.dumps({'services':{'tailormap':{'image':image_info['Id']}}},indent=2)+'\n')
    newfiles=[COMPOSE[0],str(newpin)];newconfig=render(newfiles)
    expected=json.loads(json.dumps(config));expected['services']['tailormap']['image']=image_info['Id']
    require(newconfig==expected,'Nieuwe Compose-rendering wijzigt meer dan de API-image')
    (attempt/'prepared-rendered.json').write_text(json.dumps(newconfig,indent=2)+'\n')
    print('[3/3] Configuratie en herstelbasis vastleggen; niets activeren.',flush=True)
    now,nowconfig,nowold,_=baseline()
    require(now['Id']==container['Id'] and fingerprint(nowconfig)==fingerprint(config) and nowold==old,'Actieve DEV wijzigde tijdens voorbereiding')
    for path,sha in state['branding_hashes'].items():require(digest(path)==sha,'Branding wijzigde tijdens voorbereiding')
    for path,sha in state['configuration_hashes'].items():require(digest(path)==sha,'Configuratie wijzigde tijdens voorbereiding')
    capture(['docker','tag',OLD_IMAGE,'local/tts-dev-before-upstream:20261122-'+token])
    state.update(state='PREPARED_NOT_ACTIVE',candidate=str(candidate),new_image=image_info['Id'],new_image_tag=image_tag,new_compose_files=newfiles,new_compose_fingerprint=fingerprint(newconfig),api_jar_sha256=probe['api_jar_sha256'],node_image=node,branding_reports={lang:json.loads((attempt/f'branding-{lang}.json').read_text()) for lang in ('nl','en','de')})
    manifest.write_text(json.dumps(state,indent=2)+'\n')
    print('DEV-release voorbereid; niet geactiveerd.')
    print('Registratie:',manifest)
    print('Viewer:',candidate)
    print('API-image:',image_info['Id'])
    print('Brandingregels per taal:',{lang:len(rows) for lang,rows in state['branding_reports'].items()})
    print('Geen databasewijziging, serviceherstart of Compose-/static-omschakeling uitgevoerd.')


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--probe',type=Path,required=True);args=parser.parse_args()
    os.umask(0o077);require(os.geteuid()==0,'Uitvoeren als root op LT3')
    lock=Path('/var/backups/tailormap/dev/follow-selected-feature.lock');lock.parent.mkdir(parents=True,exist_ok=True)
    with lock.open('a') as handle:
        fcntl.flock(handle,fcntl.LOCK_EX|fcntl.LOCK_NB);prepare(args.probe)


if __name__=='__main__':
    try:main()
    except (ValueError,RuntimeError,OSError,subprocess.CalledProcessError) as error:
        print('STOP: '+(str(error) if not isinstance(error,subprocess.CalledProcessError) else 'opdracht mislukt; zie release-log'),file=sys.stderr);sys.exit(1)
