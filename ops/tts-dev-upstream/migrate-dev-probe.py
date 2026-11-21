#!/usr/bin/env python3
"""Build the pinned API and migrate one archived DEV probe without starting the application."""
import argparse
import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys

CONTAINER = 'postgis18-dev'
SOURCE_COMMIT = '00a319f6c58eea8830a4d4584812863d05dcb505'
SOURCE_TREE = 'f009b743b753aad3118d96cb8a24f24ae856d03e'
BUILD_IMAGE = 'maven:3.10.0-eclipse-temurin-25-noble'
ROOT = Path('/srv/tailormap-releases/dev-upstream-20261121')


def capture(args, **kwargs):
    return subprocess.run(args, capture_output=True, text=True, check=True, **kwargs).stdout.strip()


def load_probe(path):
    path = path.resolve()
    if path.name != 'probe.json' or path.parent.parent != ROOT:
        raise ValueError('Verwacht een probe.json direct onder de bekende releasewerkmap')
    data = json.loads(path.read_text())
    if data.get('container') != CONTAINER or data.get('source') != 'tailormap':
        raise ValueError('Onverwachte bronregistratie')
    if not re.fullmatch(r'tts_upstream_probe_\d{8}t\d{6}z_[0-9a-f]{8}', data.get('database', '')):
        raise ValueError('Geen geldige proefdatabasenaam')
    if Path(data.get('workdir','')).resolve() != path.parent:
        raise ValueError('Werkmap wijkt af')
    if data.get('state') != 'LEGACY_ARCHIVED_ON_COPY':
        raise ValueError('Verwacht een nog niet gemigreerde, gearchiveerde proefkopie')
    if data.get('official_migrations_applied') or data.get('application_started'):
        raise ValueError('Deze proef is al gebruikt')
    return data


def credentials():
    inspected = json.loads(capture(['docker', 'inspect', CONTAINER]))[0]
    env = dict(item.split('=',1) for item in inspected['Config'].get('Env',[]) if '=' in item)
    user = env.get('POSTGRES_USER', 'postgres')
    password = env.get('POSTGRES_PASSWORD')
    if password is None and env.get('POSTGRES_PASSWORD_FILE'):
        password = capture(['docker','exec',CONTAINER,'cat',env['POSTGRES_PASSWORD_FILE']])
    if not password:
        raise ValueError('Geen databasebeheerwachtwoord in de containerconfiguratie; geen migratie uitgevoerd')
    if any(c in user+password for c in '\r\n'):
        raise ValueError('Credentialformaat niet geschikt voor het private env-bestand')
    return user,password


def logged(args, log, label):
    with log.open('ab') as output:
        process = subprocess.Popen(args,stdout=output,stderr=subprocess.STDOUT)
        try:
            while True:
                try:
                    code=process.wait(timeout=30)
                    break
                except subprocess.TimeoutExpired:
                    print(f'  {label} nog bezig; log: {log}',flush=True)
        except BaseException:
            process.terminate()
            try: process.wait(timeout=10)
            except subprocess.TimeoutExpired: process.kill(); process.wait()
            raise
    if code:
        raise RuntimeError(f'{label} mislukt (exit {code}); log: {log}')


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--probe',required=True,type=Path)
    args=parser.parse_args()
    os.umask(0o077)
    probe=load_probe(args.probe)
    work=args.probe.resolve().parent
    with (work/'migration.lock').open('w') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        probe=load_probe(args.probe)
        user,password=credentials()
        build=work/'api-build'
        if build.exists(): raise ValueError('api-build bestaat al; eerdere poging eerst beoordelen')
        build.mkdir()
        source=build/'source'; source.mkdir()
        log=build/'build.log'
        print('[1/3] Gepinde API-bron ophalen; bestaande DEV blijft draaien.',flush=True)
        logged(['git','-C',str(source),'init','-q'],log,'Bron ophalen')
        logged(['git','-C',str(source),'fetch','-q','--depth=1','https://github.com/The-Tracking-Solution/tailormap-api.git',SOURCE_COMMIT],log,'Bron ophalen')
        logged(['git','-C',str(source),'checkout','-q','--detach','FETCH_HEAD'],log,'Bron ophalen')
        if capture(['git','-C',str(source),'rev-parse','HEAD^{tree}'])!=SOURCE_TREE:
            raise ValueError('API-bronboom wijkt af')
        shutil.copy(Path(__file__).with_name('ProbeMigrations.java'),build)
        logged(['docker','pull',BUILD_IMAGE],log,'Bouwimage ophalen')
        image=capture(['docker','image','inspect',BUILD_IMAGE,'--format','{{.Id}}'])
        probe.update(api_source_commit=SOURCE_COMMIT,api_source_tree=SOURCE_TREE,build_image=image)
        args.probe.write_text(json.dumps(probe,indent=2)+'\n')
        base=['docker','run','--rm','--memory=5g','--cpus=2',
              '--mount',f'type=bind,src={source},dst=/work',
              '--mount',f'type=bind,src={build},dst=/probe',
              '--mount',f'type=bind,src={ROOT}/m2,dst=/root/.m2',
              '-w','/work','-e','MAVEN_OPTS=-Xmx3g']
        (ROOT/'m2').mkdir(exist_ok=True)
        print('[2/3] Nieuwe API bouwen (5 GiB, 2 CPU); geen applicatie starten.',flush=True)
        script='''mvn -B -ntp -DskipTests -DskipITs -Ddocker.skip=true -Dspotless.apply.skip=true -Dpom.fmt.skip=true package
mvn -B -ntp org.apache.maven.plugins:maven-dependency-plugin:3.8.1:build-classpath -Dmdep.outputFile=/probe/classpath.txt
mkdir -p /probe/classes
javac -cp "/work/target/classes:$(cat /probe/classpath.txt)" -d /probe/classes /probe/ProbeMigrations.java'''
        logged(base+[image,'sh','-eu','-c',script],log,'API bouwen')
        jar=source/'target/tailormap-api.jar'
        if not jar.is_file():raise ValueError('Gebouwde API-jar ontbreekt')
        envfile=build/'connection.env'
        envfile.write_text(f'TTS_PROBE_DATABASE={probe["database"]}\nTTS_PROBE_USER={user}\nTTS_PROBE_PASSWORD={password}\n')
        print('[3/3] Alleen Flyway op de proefdatabase uitvoeren; geen Spring/API-start.',flush=True)
        # Mark before starting: failed/partial migrations are never retried blindly.
        probe['state']='MIGRATION_STARTED_ON_COPY'
        args.probe.write_text(json.dumps(probe,indent=2)+'\n')
        try:
            logged(base+['--network',f'container:{CONTAINER}','--env-file',str(envfile),image,
                         'sh','-eu','-c','java -cp "/probe/classes:/work/target/classes:$(cat /probe/classpath.txt)" ProbeMigrations'],
                   build/'migration.log','Proefmigratie')
        finally:
            envfile.unlink(missing_ok=True)
        result=json.loads((build/'migration-result.json').read_text())
        with jar.open('rb') as stream: digest=hashlib.file_digest(stream,'sha256').hexdigest()
        probe.update(state='MIGRATED_ON_COPY',official_migrations_applied=True,application_started=False,
                     api_jar=str(jar),api_jar_sha256=digest,migration_result=result,
                     migrated_at=datetime.datetime.now(datetime.timezone.utc).isoformat())
        args.probe.write_text(json.dumps(probe,indent=2)+'\n')
        print(f'Proefmigratie geslaagd: {probe["database"]}')
        print('Officieel V38/V39/V40 toegepast; tts_start V1 en meldingsregels behouden.')
        print('Tweede migratiestart: nul wijzigingen. Geen applicatie of geplande jobs gestart.')
        print(f'Gebouwde API: {jar}')
        print(f'Registratie: {args.probe.resolve()}')
        print('Actieve DEV, staging, productie en replica zijn niet gewijzigd.')


if __name__=='__main__':
    try:main()
    except (ValueError,RuntimeError,OSError,subprocess.CalledProcessError) as error:
        # Do not print captured Docker inspection/env output, which can contain credentials.
        print(f'STOP: {type(error).__name__}: '+(str(error) if not isinstance(error,subprocess.CalledProcessError) else 'opdracht mislukt; zie bouwlog'),file=sys.stderr)
        sys.exit(1)
