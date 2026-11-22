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
    if data.get('state')!='MIGRATED_ON_COPY' or not data.get('official_migrations_applied') or data.get('application_started'):
        raise ValueError('Verwacht een gemigreerde kopie zonder eerdere applicatiestart')
    if data.get('api_source_commit')!=helpers.SOURCE_COMMIT or data.get('api_source_tree')!=helpers.SOURCE_TREE:
        raise ValueError('Onverwachte API-bron')
    jar=path.parent/'api-build/source/target/tailormap-api.jar'
    if data.get('api_jar')!=str(jar) or not jar.is_file():raise ValueError('Gebouwde jar ontbreekt')
    with jar.open('rb') as stream:digest=hashlib.file_digest(stream,'sha256').hexdigest()
    if data.get('api_jar_sha256')!=digest:raise ValueError('API-jar wijkt af van migratieregistratie')
    if not re.fullmatch(r'sha256:[a-f0-9]{64}',data.get('build_image','')):raise ValueError('Bouwimage-ID ontbreekt')
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
        runtime=work/'api-start';runtime.mkdir()
        name='tts-api-probe-'+data['database'].rsplit('_',1)[1]
        # Refuse to replace any existing container, even one using the same probe token.
        found=subprocess.run(['docker','container','inspect',name],capture_output=True)
        if found.returncode==0:raise ValueError('Proefcontainer bestaat al')
        before=snapshot(data['database'])
        user,password=helpers.credentials()
        envfile=runtime/'connection.env'
        envfile.write_text(f'SPRING_DATASOURCE_URL=jdbc:postgresql://127.0.0.1:5432/{data["database"]}\nSPRING_DATASOURCE_USERNAME={user}\nSPRING_DATASOURCE_PASSWORD={password}\n')
        shutil.copy(Path(__file__).with_name('ProbeHttp.java'),runtime)
        jar=Path(data['api_jar'])
        args_run=['docker','run','-d','--name',name,'--label','tts.purpose=upstream-api-probe',
                  '--network','container:postgis18-dev','--memory=3g','--cpus=2',
                  '--mount',f'type=bind,src={jar},dst=/probe-api.jar,readonly',
                  '--mount',f'type=bind,src={runtime},dst=/probe',
                  '--env-file',str(envfile),data['build_image'],
                  'java','-Xmx2g','-jar','/probe-api.jar',
                  '--server.address=127.0.0.1','--server.port=18086',
                  '--spring.quartz.auto-startup=false','--spring.quartz.overwrite-existing-jobs=false',
                  '--tailormap-api.security.admin.create-if-not-exists=false',
                  '--tailormap-api.solr-url=http://127.0.0.1:9/solr/',
                  '--tailormap-api.prometheus-api-url=http://127.0.0.1:9/api/v1',
                  '--tailormap-api.extract.location=/probe/exports',
                  '--spring.web.resources.static-locations=file:/probe/static/',
                  '--management.endpoints.web.exposure.include=health,info']
        data['state']='API_START_ATTEMPTED_ON_COPY';data['application_started']=True
        args.probe.write_text(json.dumps(data,indent=2)+'\n')
        attempted=False
        try:
            print('[1/2] Tijdelijke API starten op de proefkopie; bestaande DEV blijft draaien.',flush=True)
            attempted=True
            helpers.capture(args_run)
            print('[2/2] API-opstart en /api/user controleren; daarna proefcontainer verwijderen.',flush=True)
            helpers.logged(['docker','exec',name,'java','/probe/ProbeHttp.java'],runtime/'health.log','Proefstart')
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
    except (ValueError,RuntimeError,OSError,subprocess.CalledProcessError) as error:
        print('STOP: '+(str(error) if not isinstance(error,subprocess.CalledProcessError) else 'opdracht mislukt; zie de proeflogs'),file=sys.stderr);sys.exit(1)
