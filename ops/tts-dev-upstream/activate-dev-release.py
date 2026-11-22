#!/usr/bin/env python3
"""Activate the prepared LT3 DEV release with a fresh migrated clone and reversible database names."""
import argparse
import datetime
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import re
import secrets
import shlex
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import urllib.request


def module(name,file):
    spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(file));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m

prep=module('prepare_release','prepare-dev-release.py')
helpers=prep.helpers
policy=module('refresh_upgrade','upgrade-refresh-policy.py')
ROOT=prep.ROOT
BACKUPS=Path('/var/backups/tailormap/dev')


def require(ok,msg):
    if not ok:raise ValueError(msg)


def save(path,state):
    fd,name=tempfile.mkstemp(prefix='.upstream-state-',dir=path.parent)
    temp=Path(name)
    try:
        with os.fdopen(fd,'w') as stream:json.dump(state,stream,indent=2);stream.write('\n');stream.flush();os.fsync(stream.fileno())
        temp.chmod(0o600);os.replace(temp,path)
    finally:temp.unlink(missing_ok=True)


def ident(name):
    require(re.fullmatch(r'[a-z][a-z0-9_]{0,62}',name),'Ongeldige databasenaam')
    return '"'+name+'"'


def sql(database,statement):
    ident(database)
    return helpers.capture(['docker','exec','-i','postgis18-dev','psql','-X','-qAt','-U','postgres','-p','5432','-d',database,'-v','ON_ERROR_STOP=1'],input=statement)


def database_map(state):
    names=['tailormap',state['old_database'],state['fresh_database'],state['failed_database']]
    values=','.join("'"+n+"'" for n in names if ident(n))
    return json.loads(sql('postgres',"SELECT coalesce(jsonb_object_agg(datname,jsonb_build_object('oid',oid::bigint,'allow',datallowconn)),'{}') FROM pg_database WHERE datname IN ("+values+");"))


def block_and_disconnect(name):
    quoted=ident(name)
    sql('postgres',f'ALTER DATABASE {quoted} ALLOW_CONNECTIONS false;')
    sql('postgres',"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='"+name+"' AND pid<>pg_backend_pid();")


def swap_databases(state,reverse=False):
    rows=database_map(state)
    active=rows.get('tailormap',{})
    if reverse:
        if active.get('oid')==state['old_database_oid']:
            sql('postgres','ALTER DATABASE tailormap ALLOW_CONNECTIONS true;');return
        require(active.get('oid')==state.get('new_database_oid') and rows.get(state['old_database'],{}).get('oid')==state['old_database_oid'],'Database-identiteit wijkt af; geen rollback uitgevoerd')
        displaced=state['failed_database'];replacement=state['old_database']
    else:
        require(active.get('oid')==state['old_database_oid'] and rows.get(state['fresh_database'],{}).get('oid')==state['new_database_oid'],'Database-identiteit wijkt af vóór omschakeling')
        displaced=state['old_database'];replacement=state['fresh_database']
    require(displaced not in rows,'Bewaarnaam database bestaat al')
    block_and_disconnect('tailormap');block_and_disconnect(replacement)
    sql('postgres','BEGIN; ALTER DATABASE tailormap RENAME TO '+ident(displaced)+'; ALTER DATABASE '+ident(replacement)+' RENAME TO tailormap; COMMIT;')
    sql('postgres','ALTER DATABASE tailormap ALLOW_CONNECTIONS true;')


def link_static(target):
    require(prep.STATIC.is_symlink(),'Static is geen symlink')
    with tempfile.TemporaryDirectory(prefix='.upstream-static-',dir=prep.STATIC.parent) as work:
        temp=Path(work)/'static';temp.symlink_to(target,target_is_directory=True);os.replace(temp,prep.STATIC)


def wait_ready(image,commit,tree=None):
    deadline=time.monotonic()+180;last='nog niet gestart'
    while time.monotonic()<deadline:
        try:
            c=json.loads(helpers.capture(['docker','inspect','tailormap-dev']))[0]
            require(c['Image']==image and c['State']['Running'],'DEV-container niet gereed')
            with urllib.request.urlopen('http://127.0.0.1:8085/version.json',timeout=3) as response:metadata=json.load(response)
            build=metadata.get('ttsBuild',{})
            require(build.get('commit')==commit and (tree is None or build.get('sourceTree')==tree),'Viewer-versie wijkt af')
            with urllib.request.urlopen('http://127.0.0.1:8085/api/user',timeout=3) as response:user=json.load(response)
            require(user.get('isAuthenticated') is False,'Geen geldige anonieme API-respons')
            return
        except Exception as error:last=str(error);time.sleep(2)
    raise RuntimeError('DEV niet gezond: '+last)


def recreate(files,log):helpers.logged(prep.compose(files)+['up','-d','--no-deps','--no-build','--pull','never','--force-recreate','tailormap'],log,'DEV starten')


def rollback(statefile):
    statefile=statefile.resolve();state=json.loads(statefile.read_text())
    require(statefile.parent.parent==BACKUPS.resolve() and state.get('kind')=='tts-dev-upstream-20261122','Onbekende rollbackregistratie')
    require(prep.fingerprint(prep.render(state['old_compose_files']))==state['old_compose_fingerprint'],'Oude Compose-configuratie is gewijzigd')
    try:c=json.loads(helpers.capture(['docker','inspect','tailormap-dev']))[0]
    except subprocess.CalledProcessError:c=None
    require(c is None or c['Image'] in (state['old_image'],state['new_image']),'DEV-image is na deze uitrol gewijzigd')
    require(prep.STATIC.is_symlink() and str(prep.STATIC.resolve()) in (state['old_viewer'],state['candidate']),'Static is na deze uitrol gewijzigd')
    if c is not None:
        files=state['new_compose_files'] if c['Image']==state['new_image'] else state['old_compose_files']
        helpers.logged(prep.compose(files)+['stop','-t','30','tailormap'],statefile.parent/'rollback-stop.log','DEV stoppen voor herstel')
    swap_databases(state,reverse=True)
    link_static(state['old_viewer']);recreate(state['old_compose_files'],statefile.parent/'rollback-start.log')
    wait_ready(state['old_image'],prep.OLD_COMMIT)
    state.update(phase='ROLLED_BACK',active=False);save(statefile,state)
    print('Rollback geslaagd: oorspronkelijke DEV-database, viewer en API actief. Nieuwe data blijft in de bewaarde pogingdatabase.',flush=True)


def validate_prepared(path):
    path=path.resolve();data=json.loads(path.read_text())
    require(path.name=='prepared.json' and path.parent.parent==ROOT and path.parent.name.startswith('prepare-'),'Onverwachte release-registratie')
    require(data.get('state')=='PREPARED_NOT_ACTIVE' and not data.get('activation_performed'),'Release niet in voorbereide staat')
    require(data.get('old_image')==prep.OLD_IMAGE and data.get('viewer_commit')==prep.VIEWER_COMMIT and data.get('viewer_tree')==prep.VIEWER_TREE,'Onverwachte releaseversie')
    require(data.get('api_source_commit')==helpers.SOURCE_COMMIT and data.get('api_source_tree')==helpers.SOURCE_TREE,'API-bron wijkt af')
    candidate=Path(data['candidate']);require(candidate.parent==prep.CANDIDATES and candidate.name.startswith('tts-dev-upstream-20261122-') and candidate.is_dir(),'Onverwachte viewer-kandidaat')
    metadata=json.loads((candidate/'version.json').read_text()).get('ttsBuild',{})
    require(metadata.get('commit')==prep.VIEWER_COMMIT and metadata.get('sourceTree')==prep.VIEWER_TREE,'Viewer-kandidaat wijkt af')
    require(data.get('new_compose_files')==[prep.COMPOSE[0],str(path.parent/'pinned-image.json')],'Onverwachte nieuwe image-pin')
    require(prep.fingerprint(prep.render(data['new_compose_files']))==data['new_compose_fingerprint'],'Nieuwe Compose-configuratie gewijzigd')
    c,config,old,_=prep.baseline()
    require(c['Id']==data['old_container_id'] and prep.fingerprint(config)==data['old_compose_fingerprint'] and str(old)==data['old_viewer'],'Actieve DEV wijkt af sinds voorbereiding')
    env=dict(e.split('=',1) for e in c['Config'].get('Env',[]) if '=' in e)
    require('populate-testdata' not in env.get('JAVA_OPTS',''),'Testdata-profiel in JAVA_OPTS vereist beoordeling')
    url=env.get('SPRING_DATASOURCE_URL','')
    require(re.fullmatch(r'jdbc:postgresql:(?://(?:localhost|127\.0\.0\.1)(?::5432)?/)?tailormap(?:\?.*)?',url),'Actieve API wijst niet naar de verwachte lokale DEV-database')
    for file,sha in {**data['branding_hashes'],**data['configuration_hashes']}.items():require(prep.digest(file)==sha,'Configuratie/branding wijzigde sinds voorbereiding: '+file)
    require(json.loads(helpers.capture(['docker','image','inspect',data['new_image']]))[0]['Config'].get('User')=='1002:1001','Nieuwe runtime-image wijkt af')
    return data


def migrate_fresh(state,backup,probe):
    build=Path(probe['workdir'])/'api-build'
    env=backup/'migration.env';user,password=helpers.credentials()
    env.write_text(f'TTS_PROBE_DATABASE={state["fresh_database"]}\nTTS_PROBE_USER={user}\nTTS_PROBE_PASSWORD={password}\n')
    # Reuse the exact helper classes and API classes that migrated the accepted probe.
    args=['docker','run','--rm','--memory=3g','--cpus=2','--network','container:postgis18-dev',
          '--mount',f'type=bind,src={build}/source,dst=/work,readonly',
          '--mount',f'type=bind,src={build},dst=/accepted,readonly',
          '--mount',f'type=bind,src={backup},dst=/probe',
          '--mount',f'type=bind,src={ROOT}/m2,dst=/root/.m2,readonly',
          '--env-file',str(env),'--entrypoint','/bin/sh',probe['build_image'],'-eu','-c',
          'exec java -Xmx1g -cp "/accepted/classes:/work/target/classes:$(cat /accepted/classpath.txt)" ProbeMigrations']
    try:helpers.logged(args,backup/'migration.log','Actuele kopie migreren')
    finally:env.unlink(missing_ok=True)
    result=json.loads((backup/'migration-result.json').read_text())
    require(result.get('official_migrations')==3 and result.get('private_migrations')==0 and result.get('components_preserved'),'Migratieresultaat wijkt af')


def activate(prepared):
    data=validate_prepared(prepared);probe=prep.load_probe(Path(data['probe']))
    stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dt%H%M%Sz');token=secrets.token_hex(4)
    backup=BACKUPS/f'upstream-20261122-{stamp}-{token}';backup.mkdir(parents=True)
    for file in ['activate-dev-release.py','prepare-dev-release.py','migrate-dev-probe.py','upgrade-refresh-policy.py','refresh-policy-extension.py']:
        shutil.copy2(Path(__file__).with_name(file),backup/file)
    state={**data,'kind':'tts-dev-upstream-20261122','phase':'PREPARED','active':False,
           'old_database':f'tailormap_before_upstream_{stamp}_{token}',
           'fresh_database':f'tts_upstream_probe_{stamp}_{token}',
           'failed_database':f'tailormap_upstream_attempt_{stamp}_{token}'}
    statefile=backup/'state.json'
    raw=sql('postgres',"SELECT jsonb_build_object('recovery',pg_is_in_recovery(),'port',current_setting('port'),'oid',(SELECT oid::bigint FROM pg_database WHERE datname='tailormap'),'owner',(SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname='tailormap'));")
    info=json.loads(raw);require(not info['recovery'] and info['port']=='5432' and info['oid'],'Niet de verwachte schrijfbare databasecontainer')
    state.update(old_database_oid=info['oid'],database_owner=info['owner']);save(statefile,state)
    script=backup/'rollback.sh';script.write_text('#!/bin/sh\nset -eu\nexec python3 '+shlex.quote(str(backup/'activate-dev-release.py'))+' --rollback '+shlex.quote(str(statefile))+'\n');script.chmod(0o700)
    # This policy supports both old/new APIs. Installation is checksum-guarded and does not refresh any data.
    state['refresh_policy_update']=policy.install(backup/'refresh-policy');save(statefile,state)
    print('[1/3] Alleen Tailormap DEV wordt nu onderbroken. Rollback: bash '+str(script),flush=True)
    try:
        state['phase']='STOPPING_DEV';save(statefile,state)
        helpers.logged(prep.compose(state['old_compose_files'])+['stop','-t','30','tailormap'],backup/'stop.log','DEV stoppen')
        state['phase']='DEV_STOPPED';save(statefile,state)
        dump=backup/'dev-before-upstream.dump'
        with dump.open('wb') as output:
            subprocess.run(['docker','exec','postgis18-dev','pg_dump','-U','postgres','-p','5432','-d','tailormap','-Fc'],stdout=output,check=True)
        state['database_dump']=str(dump);state['database_dump_sha256']=prep.digest(dump);save(statefile,state)
        subprocess.run(['docker','exec','postgis18-dev','createdb','-U','postgres','-p','5432','-O',info['owner'],state['fresh_database']],check=True)
        state['new_database_oid']=json.loads(sql('postgres',"SELECT to_jsonb(oid::bigint) FROM pg_database WHERE datname='"+state['fresh_database']+"';"));save(statefile,state)
        with dump.open('rb') as source,(backup/'restore.log').open('wb') as output:
            subprocess.run(['docker','exec','-i','postgis18-dev','pg_restore','-U','postgres','-p','5432','-d',state['fresh_database'],'--exit-on-error'],stdin=source,stdout=output,stderr=subprocess.STDOUT,check=True)
        print('[2/3] Laatste DEV-gegevens op een verse kopie migreren; oude database blijft bewaard.',flush=True)
        archive=Path(__file__).with_name('archive-legacy-with-existing-tts.sql').read_text()
        sql(state['fresh_database'],'BEGIN;\n'+archive+'\nCOMMIT;')
        migrate_fresh(state,backup,probe)
        state['phase']='FRESH_DATABASE_MIGRATED';save(statefile,state)
        swap_databases(state)
        state['phase']='DATABASE_NAMES_SWAPPED';save(statefile,state)
        link_static(state['candidate'])
        print('[3/3] Nieuwe DEV-viewer en API starten op 8085.',flush=True)
        recreate(state['new_compose_files'],backup/'start.log');wait_ready(state['new_image'],prep.VIEWER_COMMIT,prep.VIEWER_TREE)
        require(database_map(state).get('tailormap',{}).get('oid')==state['new_database_oid'],'Actieve database wijkt af')
        state.update(phase='ACTIVE',active=True,activation_performed=True);save(statefile,state)
        data.update(state='ACTIVE',activation_performed=True,activation_state=str(statefile),rollback=str(script));save(prepared.resolve(),data)
        print('DEV-upgrade actief op 8085. Viewercommit:',prep.VIEWER_COMMIT)
        print('API-commit:',helpers.SOURCE_COMMIT)
        print('Oorspronkelijke DEV-database bewaard als:',state['old_database'])
        print('Kaartmeldingsregels, branding en uploads behouden. Staging/productie/replica ongewijzigd.')
        print('Rollback: bash '+str(script))
        print('Registratie:',statefile)
    except BaseException:
        print('Activering mislukt; oorspronkelijke DEV wordt hersteld. Logs:',backup,flush=True)
        try:rollback(statefile)
        except BaseException as recovery:
            print('Automatisch herstel niet voltooid. Bewaar alle databases; herstelregistratie: '+str(statefile),file=sys.stderr)
            print(type(recovery).__name__+': '+str(recovery),file=sys.stderr)
        raise


def main():
    p=argparse.ArgumentParser(description=__doc__);group=p.add_mutually_exclusive_group(required=True);group.add_argument('--activate',type=Path);group.add_argument('--rollback',type=Path);args=p.parse_args()
    os.umask(0o077);require(os.geteuid()==0,'Uitvoeren als root op LT3')
    signal.signal(signal.SIGTERM,lambda signum,frame:sys.exit(143))
    require(Path('/srv/tailormap-dev').is_dir() and Path('/srv/tailormap-staging').is_dir(),'Verwachte LT3-omgevingen ontbreken')
    with Path('/var/backups/tailormap/dev/follow-selected-feature.lock').open('a') as release_lock,Path('/run/lock/tailormap-lt3-refresh.lock').open('a') as refresh_lock:
        fcntl.flock(release_lock,fcntl.LOCK_EX|fcntl.LOCK_NB);fcntl.flock(refresh_lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        if args.rollback:rollback(args.rollback)
        else:activate(args.activate)


if __name__=='__main__':
    try:main()
    except (ValueError,RuntimeError,OSError,subprocess.CalledProcessError) as error:
        print('STOP: '+(str(error) if not isinstance(error,subprocess.CalledProcessError) else 'opdracht mislukt; zie release-log'),file=sys.stderr);sys.exit(1)
