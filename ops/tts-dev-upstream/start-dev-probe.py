#!/usr/bin/env python3
"""Start and stop the already-built API against the migrated probe only."""
import argparse
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import zipfile

spec=importlib.util.spec_from_file_location('migration_runner',Path(__file__).with_name('migrate-dev-probe.py'))
helpers=importlib.util.module_from_spec(spec);spec.loader.exec_module(helpers)
ROOT=helpers.ROOT


def load_start_probe(path):
    path=path.resolve();data=json.loads(path.read_text())
    if path.name!='probe.json' or path.parent.parent!=ROOT or data.get('workdir')!=str(path.parent):
        raise ValueError('Onverwachte proefregistratie/werkmap')
    if data.get('container')!='postgis18-dev' or data.get('source')!='tailormap':
        raise ValueError('Onverwachte bron')
    if not re.fullmatch(r'tts_upstream_probe_\d{8}t\d{6}z_[0-9a-f]{8}',data.get('database','')):
        raise ValueError('Geen proefdatabase')
    fresh=data.get('state')=='MIGRATED_ON_COPY' and not data.get('application_started')
    known_failure=(data.get('state')=='API_START_ATTEMPTED_ON_COPY'
                   and not data.get('api_start_mode') and data.get('probe_runtime_removed') is True)
    if known_failure:
        old_log=path.parent/'api-start/api.log'
        known_failure=(old_log.is_file() and old_log.read_text().strip()
                       =='no main manifest attribute, in /probe-api.jar')
    if not data.get('official_migrations_applied') or not (fresh or known_failure):
        raise ValueError('Verwacht een gemigreerde kopie of uitsluitend de bekende jar-manifestfout')
    if data.get('api_source_commit')!=helpers.SOURCE_COMMIT or data.get('api_source_tree')!=helpers.SOURCE_TREE:
        raise ValueError('Onverwachte API-bron')
    jar=path.parent/'api-build/source/target/tailormap-api.jar'
    if data.get('api_jar')!=str(jar) or not jar.is_file():raise ValueError('Gebouwde jar ontbreekt')
    with jar.open('rb') as stream:digest=hashlib.file_digest(stream,'sha256').hexdigest()
    if data.get('api_jar_sha256')!=digest:raise ValueError('API-jar wijkt af van migratieregistratie')
    if not re.fullmatch(r'sha256:[a-f0-9]{64}',data.get('build_image','')):raise ValueError('Bouwimage-ID ontbreekt')
    with zipfile.ZipFile(jar) as archive:
        if 'org/tailormap/api/TailormapApiApplication.class' not in archive.namelist():
            raise ValueError('API-hoofdklasse ontbreekt in de gewone jar')
    classpath_file=path.parent/'api-build/classpath.txt'
    if not classpath_file.is_file():raise ValueError('Bestaand Maven-classpath ontbreekt')
    dependencies=classpath_file.read_text().strip().split(':')
    if not dependencies or any(not p.startswith('/root/.m2/repository/') or '\n' in p or '\r' in p for p in dependencies):
        raise ValueError('Onverwacht dependency-classpath')
    return data


def snapshot(database):
    query="""BEGIN READ ONLY;
SELECT jsonb_build_object(
 'database',current_database(),'port',current_setting('port'),'replica',pg_is_in_recovery(),
 'official',(SELECT coalesce(jsonb_agg(to_jsonb(h) ORDER BY installed_rank),'[]') FROM public.flyway_schema_history h),
 'private',(SELECT coalesce(jsonb_agg(to_jsonb(h) ORDER BY installed_rank),'[]') FROM tts_start.flyway_schema_history h),
 'components',(SELECT md5(coalesce(jsonb_agg(jsonb_build_array(id,components) ORDER BY id)::text,'[]')) FROM public.application),
 'preferences',(SELECT count(*) FROM tts_start.user_start_position));
COMMIT;"""
    result=helpers.capture(['docker','exec','-i','postgis18-dev','psql','-X','-qAt','-U','postgres','-p','5432','-d',database,'-v','ON_ERROR_STOP=1'],input=query)
    data=json.loads(result)
    if data['database']!=database or data['port']!='5432' or data['replica']:
        raise ValueError('Onverwachte proefdatabaseverbinding')
    return data


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--probe',required=True,type=Path);args=parser.parse_args()
    os.umask(0o077)
    data=load_start_probe(args.probe);work=args.probe.resolve().parent
    with (work/'migration.lock').open('w') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        data=load_start_probe(args.probe)
        runtime=work/'api-start-classpath';runtime.mkdir()
        name='tts-api-probe-'+data['database'].rsplit('_',1)[1]
        # Refuse to replace any existing container, even one using the same probe token.
        found=subprocess.run(['docker','container','inspect',name],capture_output=True)
        if found.returncode==0:raise ValueError('Proefcontainer bestaat al')
        before=snapshot(data['database'])
        # Compile the tiny health client before starting the API, avoiding a concurrent source-file compiler.
        shutil.copy(Path(__file__).with_name('ProbeHttp.java'),runtime)
        helpers.logged(['docker','run','--rm','--memory=512m','--cpus=1',
                        '--mount',f'type=bind,src={runtime},dst=/probe',data['build_image'],
                        'javac','-J-Xmx128m','-d','/probe/classes','/probe/ProbeHttp.java'],
                       runtime/'health-compile.log','Startcontrole compileren')
        user,password=helpers.credentials()
        envfile=runtime/'connection.env'
        envfile.write_text(f'SPRING_DATASOURCE_URL=jdbc:postgresql://127.0.0.1:5432/{data["database"]}\nSPRING_DATASOURCE_USERNAME={user}\nSPRING_DATASOURCE_PASSWORD={password}\n')
        jar=Path(data['api_jar'])
        classpath='/probe-api.jar:'+(work/'api-build/classpath.txt').read_text().strip()
        args_run=['docker','run','-d','--name',name,'--label','tts.purpose=upstream-api-probe',
                  '--network','container:postgis18-dev','--memory=3g','--cpus=2',
                  '--mount',f'type=bind,src={jar},dst=/probe-api.jar,readonly',
                  '--mount',f'type=bind,src={runtime},dst=/probe',
                  '--mount',f'type=bind,src={ROOT}/m2,dst=/root/.m2,readonly',
                  '--env-file',str(envfile),'--entrypoint','java',data['build_image'],
                  '-Xmx2g','-cp',classpath,'org.tailormap.api.TailormapApiApplication',
                  '--server.address=127.0.0.1','--server.port=18086',
                  '--spring.quartz.auto-startup=false','--spring.quartz.overwrite-existing-jobs=false',
                  '--tailormap-api.security.admin.create-if-not-exists=false',
                  '--tailormap-api.solr-url=http://127.0.0.1:9/solr/',
                  '--tailormap-api.prometheus-api-url=http://127.0.0.1:9/api/v1',
                  '--tailormap-api.extract.location=/probe/exports',
                  '--spring.web.resources.static-locations=file:/probe/static/',
                  '--management.endpoints.web.exposure.include=health,info']
        data['state']='API_START_ATTEMPTED_ON_COPY';data['application_started']=True
        data['api_start_mode']='classpath-v2'
        data['api_start_log']=str(runtime/'api.log')
        args.probe.write_text(json.dumps(data,indent=2)+'\n')
        attempted=False
        try:
            print('[1/2] Tijdelijke API starten op de proefkopie; bestaande DEV blijft draaien.',flush=True)
            attempted=True
            helpers.capture(args_run)
            print('[2/2] API-opstart en /api/user controleren; daarna proefcontainer verwijderen.',flush=True)
            helpers.logged(['docker','exec',name,'java','-Xmx64m','-cp','/probe/classes','ProbeHttp'],runtime/'health.log','Proefstart')
            if snapshot(data['database'])!=before:
                raise ValueError('Migratiehistorie, meldingsregels of voorkeurentelling veranderd bij proefstart')
            data.update(state='API_START_VERIFIED_ON_COPY',api_start_verified=True,probe_runtime_removed=False)
        finally:
            removed=False
            if attempted:
                owned=subprocess.run(['docker','inspect','--format','{{index .Config.Labels \"tts.purpose\"}}',name],capture_output=True,text=True)
                exists=owned.returncode==0 and owned.stdout.strip()=='upstream-api-probe'
            else:
                exists=False
            if exists:
                with (runtime/'api.log').open('wb') as output:
                    subprocess.run(['docker','logs',name],stdout=output,stderr=subprocess.STDOUT)
                subprocess.run(['docker','rm','-f',name],stdout=subprocess.DEVNULL,check=True)
                removed=True
            envfile.unlink(missing_ok=True)
            data['probe_runtime_removed']=removed
            args.probe.write_text(json.dumps(data,indent=2)+'\n')
        print('Nieuwe API start en /api/user geeft een geldige anonieme respons.')
        print('Migratiehistorie, kaartmeldingsregels en voorkeurentelling behouden.')
        print(f'Proefcontainer verwijderd. Log: {runtime}/api.log')
        print(f'Registratie: {args.probe.resolve()}')
        print('Actieve DEV, staging, productie en replica zijn niet gewijzigd.')


if __name__=='__main__':
    try:main()
    except (ValueError,RuntimeError,OSError,zipfile.BadZipFile,subprocess.CalledProcessError) as error:
        print('STOP: '+(str(error) if not isinstance(error,subprocess.CalledProcessError) else 'opdracht mislukt; zie de proeflogs'),file=sys.stderr);sys.exit(1)
