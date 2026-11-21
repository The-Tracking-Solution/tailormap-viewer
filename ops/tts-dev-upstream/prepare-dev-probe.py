#!/usr/bin/env python3
"""Copy the known LT3 DEV configuration database and archive legacy markers on the copy only."""
import datetime
import hashlib
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys

CONTAINER = 'postgis18-dev'
SOURCE = 'tailormap'
SQL_FILE = Path(__file__).with_name('archive-legacy-with-existing-tts.sql')


def command(database, *args):
    return ['docker', 'exec', '-i', CONTAINER, 'psql', '-X', '-U', 'postgres', '-p', '5432',
            '-d', database, '-v', 'ON_ERROR_STOP=1', '-P', 'pager=off', *args]


def sql(database, statement):
    return subprocess.run(command(database, '-At'), input=statement, text=True,
                          capture_output=True, check=True).stdout.strip()


def main():
    if sys.argv[1:] != ['--prepare']:
        raise SystemExit('Gebruik: python3 prepare-dev-probe.py --prepare')
    os.umask(0o077)
    root = Path('/srv/tailormap-releases/dev-upstream-20261121')
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dt%H%M%Sz')
    token = secrets.token_hex(4)
    probe = f'tts_upstream_probe_{stamp}_{token}'
    work = root / f'probe-{stamp}-{token}'
    work.mkdir(parents=True)
    manifest = {'container': CONTAINER, 'source': SOURCE, 'database': probe,
                'state': 'PREPARING', 'workdir': str(work),
                'note': 'Snapshot for migration testing only; never activate this stale snapshot directly.'}
    manifest_path = work / 'probe.json'
    manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')
    guard = """BEGIN READ ONLY;
DO $$ BEGIN
 IF current_database()<>'tailormap' OR current_setting('port')<>'5432' OR pg_is_in_recovery() THEN
  RAISE EXCEPTION 'Niet de verwachte schrijfbare DEV-database';
 END IF;
END $$;
COMMIT;"""
    sql(SOURCE, guard)
    owner = sql(SOURCE, "SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname=current_database();")
    dump = work / 'dev-before-upstream.dump'
    print('[1/3] DEV-database kopiëren; alle diensten blijven draaien.', flush=True)
    with dump.open('wb') as output:
        subprocess.run(['docker', 'exec', CONTAINER, 'pg_dump', '-U', 'postgres', '-p', '5432',
                        '-d', SOURCE, '-Fc'], stdout=output, check=True)
    subprocess.run(['docker', 'exec', '-i', CONTAINER, 'pg_restore', '--list'],
                   stdin=dump.open('rb'), stdout=subprocess.DEVNULL, check=True)
    subprocess.run(['docker', 'exec', CONTAINER, 'createdb', '-U', 'postgres', '-p', '5432',
                    '-O', owner, probe], check=True)
    manifest['state'] = 'RESTORING'
    manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')
    print('[2/3] Alleen de nieuwe proefdatabase herstellen.', flush=True)
    with dump.open('rb') as input_file:
        subprocess.run(['docker', 'exec', '-i', CONTAINER, 'pg_restore', '-U', 'postgres',
                        '-p', '5432', '-d', probe, '--exit-on-error'], stdin=input_file, check=True)
    history_before = sql(probe, "SELECT coalesce(jsonb_agg(to_jsonb(h) ORDER BY installed_rank),'[]') FROM tts_start.flyway_schema_history h;")
    preferences_before = sql(probe, "SELECT count(*) FROM tts_start.user_start_position;")
    print('[3/3] Oude private migraties uitsluitend op de proefkopie archiveren.', flush=True)
    sql(probe, 'BEGIN;\n' + SQL_FILE.read_text() + '\nCOMMIT;')
    history_after = sql(probe, "SELECT coalesce(jsonb_agg(to_jsonb(h) ORDER BY installed_rank),'[]') FROM tts_start.flyway_schema_history h;")
    preferences_after = sql(probe, "SELECT count(*) FROM tts_start.user_start_position;")
    remaining = sql(probe, "SELECT count(*) FROM public.flyway_schema_history WHERE version::numeric>37;")
    archived = sql(probe, "SELECT count(*) FROM tts_legacy_dev.legacy_migration_history;")
    if history_before != history_after or preferences_before != preferences_after or remaining != '0' or archived != '3':
        raise RuntimeError('Nacontrole van proefkopie mislukt; huidige DEV is niet gewijzigd')
    digest = hashlib.file_digest(dump.open('rb'), 'sha256').hexdigest()
    manifest.update(state='LEGACY_ARCHIVED_ON_COPY', dump=str(dump), dump_sha256=digest,
                    preserved_tts_preferences=int(preferences_after),
                    official_migrations_applied=False, application_started=False)
    manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')
    print(f'Proefdatabase gereed: {CONTAINER}:5432/{probe}')
    print(f'Registratie: {manifest_path}')
    print('tts_start V1 behouden. Officiële V38/V39/V40 nog niet uitgevoerd.')
    print('Actieve DEV, staging, productie en replica zijn niet gewijzigd.')


if __name__ == '__main__':
    try:
        main()
    except subprocess.CalledProcessError as error:
        if error.stderr:
            print(error.stderr, file=sys.stderr)
        raise SystemExit(f'STOP: proefvoorbereiding mislukt (exit {error.returncode}); actieve DEV is niet gewijzigd.')
