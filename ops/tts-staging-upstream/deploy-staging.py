#!/usr/bin/env python3
"""Promote accepted DEV artifacts to LT3 staging; preserve staging data and migration numbering."""
import argparse,base64,datetime,fcntl,gzip,hashlib,importlib.util,json,os,re,secrets,shlex,shutil,signal,subprocess,sys,tempfile,time,urllib.request
from pathlib import Path
SUPPORT=Path(__file__).resolve().parent.parent/'tts-dev-upstream'
spec=importlib.util.spec_from_file_location('stage_support',SUPPORT/'prepare-dev-release.py');p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)
h=p.helpers
ROOT=Path('/srv/tailormap-releases/staging-upstream-20261122')
BACKUPS=Path('/var/backups/tailormap/staging')
STATIC=Path('/var/tailormap/staging/static')
COMPOSE=['/srv/tailormap-staging/docker-compose.yml']
DB='tailormap_stage_129'
OLD_IMAGE='sha256:82f9d7f4cebd599cbf042e6fde642bdad78fabc377804f054726b4c0cd73e523'
OLD_COMMIT='2980c7700ce346eeeb39d6eea6e5c4b4ce0d02cd'
NEW_IMAGE='sha256:f3be426220f455468af15df91fe607ce0ee91485ba6f16529b62e48b100888e4'
DEV_MANIFEST=Path('/srv/tailormap-releases/dev-upstream-20261121/prepare-lxywtiz8/prepared.json')
POLICY_SHA='24d48c0cf484ca83412137e9927cb3d76bebe73eb96859ec0cc38865e7978848'

def require(ok,msg):
    if not ok:raise ValueError(msg)

def save(path,state):
    fd,name=tempfile.mkstemp(prefix='.stage-state-',dir=path.parent)
    try:
        with os.fdopen(fd,'w') as stream:json.dump(state,stream,indent=2);stream.write('\n');stream.flush();os.fsync(stream.fileno())
        os.chmod(name,0o600);os.replace(name,path)
    finally:Path(name).unlink(missing_ok=True)

def ident(name):
    require(re.fullmatch(r'[a-z][a-z0-9_]{0,62}',name),'Ongeldige databasenaam');return '"'+name+'"'

def sql(db,text):
    require(db in ('postgres',DB) or re.fullmatch(r'tts_stage_(?:probe|before|attempt)_\d{8}t\d{6}z_[0-9a-f]{8}',db),'SQL buiten staging geweigerd')
    return h.capture(['docker','exec','-i','postgis18-dev','psql','-X','-qAt','-U','postgres','-p','5432','-d',db,'-v','ON_ERROR_STOP=1'],input=text)

def compose(files):
    result=['docker','compose','--project-directory','/srv/tailormap-staging','-p','tailormap-staging']
    for f in files:result+=['-f',str(f)]
    return result

def render(files):return json.loads(h.capture(compose(files)+['config','--format','json']))
def inspect():return json.loads(h.capture(['docker','inspect','tailormap-stage']))[0]
def image(name):return json.loads(h.capture(['docker','image','inspect',name]))[0]

def baseline():
    c=inspect();require(c['State']['Running'] and c['Image']==OLD_IMAGE,'Staging wijkt af van de bevestigde runtime')
    labels=c['Config'].get('Labels') or {};env=dict(x.split('=',1) for x in c['Config'].get('Env',[]) if '=' in x)
    require(labels.get('com.docker.compose.project')=='tailormap-staging' and labels.get('com.docker.compose.service')=='tailormap' and labels.get('com.docker.compose.project.config_files','').split(',')==COMPOSE,'Onverwachte staging Compose-configuratie')
    require(c['Config'].get('User')=='1002:1001' and c['HostConfig']['NetworkMode']=='host' and env.get('SERVER_PORT')=='8185','Onverwachte staging gebruiker/netwerk/poort')
    require(re.fullmatch(r'jdbc:postgresql://(?:localhost|127\.0\.0\.1):5432/tailormap_stage_129(?:\?.*)?',env.get('SPRING_DATASOURCE_URL','')),'Verkeerde stagingdatabase')
    require('populate-testdata' not in env.get('SPRING_PROFILES_ACTIVE','')+env.get('JAVA_OPTS',''),'Testdata-profiel geweigerd')
    mounts={(m['Source'],m['Destination'],m['RW']) for m in c['Mounts']}
    require(mounts=={(str(STATIC),'/home/cnb/static',False),('/var/tailormap/staging/logs','/var/log/tailormap',True),('/var/tailormap/staging/uploads','/var/tailormap/uploads',True)},'Staging-volumes wijken af')
    require(STATIC.is_symlink(),'Staging static moet een symlink zijn')
    old=STATIC.resolve();metadata=json.loads((old/'version.json').read_text())
    require(metadata.get('ttsBuild',{}).get('commit')==OLD_COMMIT,'Staging-viewer wijkt af')
    cfg=render(COMPOSE);svc=cfg['services']['tailormap']
    require(svc.get('container_name')=='tailormap-stage' and svc.get('network_mode')=='host' and image(svc['image'])['Id']==OLD_IMAGE,'Compose-runtime wijkt af')
    require(not svc.get('entrypoint'),'Expliciete entrypoint vereist beoordeling')
    cmd=svc.get('command') or [];require(not cmd or isinstance(cmd,list) and all(x.startswith('--') for x in cmd),'Expliciet startcommando vereist beoordeling')
    for k,v in (svc.get('environment') or {}).items():
        require(k not in env if v is None else env.get(k) in (str(v),str(v).replace('$$','$')),'Compose wijkt af voor '+k)
    return c,cfg,old,metadata

def load_dev():
    d=json.loads(DEV_MANIFEST.read_text())
    require(d.get('state')=='ACTIVE' and d.get('activation_performed') and d.get('new_image')==NEW_IMAGE,'DEV-release is niet de geaccepteerde actieve versie')
    require(d.get('viewer_commit')==p.VIEWER_COMMIT and d.get('viewer_tree')==p.VIEWER_TREE and d.get('api_source_commit')==h.SOURCE_COMMIT and d.get('api_source_tree')==h.SOURCE_TREE,'DEV-bronnen wijken af')
    candidate=Path(d['candidate']).resolve();require(candidate.parent==p.CANDIDATES and candidate.name.startswith('tts-dev-upstream-20261122-'),'Onverwachte DEV-kandidaat')
    require(all(d.get('branding_reports',{}).get(lang)==[] for lang in ('nl','en','de')),'Niet-lege DEV CSS-overlays vereisen beoordeling vóór promotie')
    require(json.loads((candidate/'version.json').read_text()).get('ttsBuild',{}).get('commit')==p.VIEWER_COMMIT,'DEV-artifactversie wijkt af')
    require(image(NEW_IMAGE)['Config'].get('User')=='1002:1001','Nieuwe API-image wijkt af')
    probe=p.load_probe(Path(d['probe']))
    return d,probe,candidate

def history_guard():
    data=json.loads(sql(DB,"BEGIN READ ONLY; SELECT jsonb_build_object('database',current_database(),'port',current_setting('port'),'recovery',pg_is_in_recovery(),'official',(SELECT jsonb_agg(jsonb_build_array(version,script,checksum,success) ORDER BY installed_rank) FROM public.flyway_schema_history WHERE version::numeric>=37),'own',(SELECT jsonb_agg(jsonb_build_array(version,script,checksum,success) ORDER BY installed_rank) FROM tts_start.flyway_schema_history WHERE version IS NOT NULL),'legacy',to_regclass('public.user_start_position') IS NOT NULL OR to_regclass('public.user_start_extent') IS NOT NULL); COMMIT;"))
    require(data['database']==DB and data['port']=='5432' and not data['recovery'] and not data['legacy'],'Niet de verwachte schone stagingdatabase')
    require(data['official']==[['37','V37__search_index_source_crs.sql',-1297085591,True]] and data['own']==[['1','V1__personal_start_position.sql',1761125400,True]],'Staging-migratiehistorie wijkt af')

def branding(old,candidate,release,d):
    baseline=gzip.decompress(base64.b64decode((SUPPORT/'previous-styles.css.gz.b64').read_text()));require(hashlib.sha256(baseline).hexdigest()==p.BASE_CSS_HASH,'Referentie-CSS wijkt af')
    (release/'previous-styles.css').write_bytes(baseline);shutil.copy2(SUPPORT/'transfer-branding.mjs',release)
    require((DEV_MANIFEST.parent/'viewer/node_modules/postcss').is_dir(),'Bestaande brandingparser ontbreekt')
    args=['docker','run','--rm','--network','none','--memory=512m','--cpus=1','--mount',f'type=bind,src={DEV_MANIFEST.parent}/viewer,dst=/work,readonly','--mount',f'type=bind,src={release},dst=/release','--mount',f'type=bind,src={old},dst=/old,readonly','--mount',f'type=bind,src={candidate},dst=/candidate',d['node_image']]
    script=''
    for lang in ('nl','en','de'):
        require((old/lang/'styles-YU6ZJSX5.css').is_file(),'Onverwachte oude staging stylesheet')
        script+=f'set -- /candidate/{lang}/styles-*.css; test "$#" -eq 1\nnode /release/transfer-branding.mjs /release/previous-styles.css /old/{lang}/styles-YU6ZJSX5.css "$1" /candidate/{lang}/tts-branding-overrides.css /release/branding-{lang}.json\n'
    h.logged(args+['sh','-eu','-c',script],release/'branding.log','Staging-branding overzetten')
    for lang in ('nl','en','de'):
        folder=candidate/lang
        for name in p.BRANDING:
            source=old/lang/name;require(source.is_file() and not source.is_symlink(),'Branding ontbreekt: '+str(source));shutil.copy2(source,folder/name)
        manifest=old/lang/'manifest.webmanifest'
        if manifest.is_file():shutil.copy2(manifest,folder/manifest.name)
        html=(folder/'index.html').read_text();title=re.search(r'<title>.*?</title>',(old/lang/'index.html').read_text(),re.S)
        if title:html=re.sub(r'<title>.*?</title>',lambda _:title.group(0),html,count=1,flags=re.S)
        (folder/'index.html').write_text(html)
        for file in [folder/'index.html',folder/'tts-branding-overrides.css',*(folder/n for n in p.BRANDING),*([folder/manifest.name] if manifest.is_file() else [])]:file.with_name(file.name+'.gz').write_bytes(gzip.compress(file.read_bytes(),mtime=0))
        css=(folder/'tts-branding-overrides.css').read_text()
        for url in re.findall(r'url\([\s\'\"]*([^\)\'\"\s]+)',css):
            if not re.match(r'^(?:[a-z]+:|/|#)',url,re.I):require((folder/url.split('?',1)[0]).is_file(),'Brandingasset ontbreekt: '+url)

def migration_args(probe,release,network='container:postgis18-dev'):
    build=Path(probe['workdir'])/'api-build'
    return ['docker','run','--rm','--memory=2g','--cpus=2','--network',network,'--mount',f'type=bind,src={build}/source,dst=/work,readonly','--mount',f'type=bind,src={build},dst=/accepted,readonly','--mount',f'type=bind,src={h.ROOT}/m2,dst=/root/.m2,readonly','--mount',f'type=bind,src={release},dst=/probe']

def check_runtime_options(container,release):
    env=dict(x.split('=',1) for x in container['Config'].get('Env',[]) if '=' in x)
    options=env.get('JAVA_OPTS','');require('\n' not in options and '\r' not in options,'Meerregelige JAVA_OPTS vereist beoordeling')
    file=release/'runtime-options.env';file.write_text('JAVA_OPTS='+options+'\n')
    try:h.logged(['docker','run','--rm','--network','none','--env-file',str(file),'--entrypoint','/bin/sh',NEW_IMAGE,'-c','set -efu; exec java ${JAVA_OPTS:--Xmx2g} -version'],release/'runtime-java.log','Staging Java-opties controleren')
    finally:file.unlink(missing_ok=True)

def compile_migration(probe,release):
    shutil.copy2(Path(__file__).with_name('StageMigrations.java'),release)
    (release/'classes').mkdir()
    h.logged(migration_args(probe,release,'none')+['--entrypoint','/bin/sh',probe['build_image'],'-eu','-c','exec javac -J-Xmx256m -cp "/work/target/tailormap-api.jar:$(cat /accepted/classpath.txt)" -d /probe/classes /probe/StageMigrations.java'],release/'migration-compile.log','Migratiehelper compileren')

def migrate(state,probe,release):
    user,password=h.credentials();env=release/'migration.env';env.write_text(f'TTS_PROBE_DATABASE={state["fresh_database"]}\nTTS_PROBE_USER={user}\nTTS_PROBE_PASSWORD={password}\n')
    try:h.logged(migration_args(probe,release)+['--env-file',str(env),'--entrypoint','/bin/sh',probe['build_image'],'-eu','-c','exec java -Xmx1g -cp "/probe/classes:/work/target/tailormap-api.jar:$(cat /accepted/classpath.txt)" StageMigrations'],release/'migration.log','Stagingkopie migreren')
    finally:env.unlink(missing_ok=True)
    r=json.loads((release/'migration-result.json').read_text());require(r.get('official_migrations')==3 and r.get('private_migrations')==0 and r.get('components_preserved') and r.get('private_history_preserved'),'Migratiecontrole mislukt')

def database_map(state):
    names=[DB,state['old_database'],state['fresh_database'],state['failed_database']]
    for n in names:
        ident(n);require(n==DB or re.fullmatch(r'tts_stage_(?:probe|before|attempt)_\d{8}t\d{6}z_[0-9a-f]{8}',n),'Database buiten staging geweigerd')
    return json.loads(sql('postgres',"SELECT coalesce(jsonb_object_agg(datname,jsonb_build_object('oid',oid::bigint,'allow',datallowconn)),'{}') FROM pg_database WHERE datname IN ("+','.join("'"+n+"'" for n in names)+");"))

def block(db):
    sql('postgres',f'ALTER DATABASE {ident(db)} ALLOW_CONNECTIONS false;')
    sql('postgres',"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='"+db+"' AND pid<>pg_backend_pid();")

def swap(state,reverse=False):
    rows=database_map(state);active=rows.get(DB,{})
    if reverse:
        if active.get('oid')==state['old_database_oid']:
            sql('postgres',f'ALTER DATABASE {ident(DB)} ALLOW_CONNECTIONS true;');return
        require(active.get('oid')==state.get('new_database_oid') and rows.get(state['old_database'],{}).get('oid')==state['old_database_oid'],'Stagingdatabase wijkt af; herstel geweigerd')
        displaced,replacement=state['failed_database'],state['old_database']
    else:
        require(active.get('oid')==state['old_database_oid'] and rows.get(state['fresh_database'],{}).get('oid')==state['new_database_oid'],'Stagingdatabase wijkt af vóór omschakeling')
        displaced,replacement=state['old_database'],state['fresh_database']
    require(displaced not in rows,'Bewaarnaam bestaat al')
    block(DB);block(replacement)
    sql('postgres',f'BEGIN;ALTER DATABASE {ident(DB)} RENAME TO {ident(displaced)};ALTER DATABASE {ident(replacement)} RENAME TO {ident(DB)};COMMIT;')
    sql('postgres',f'ALTER DATABASE {ident(DB)} ALLOW_CONNECTIONS true;')

def link(target):
    require(STATIC.is_symlink(),'Staging static is geen symlink')
    with tempfile.TemporaryDirectory(prefix='.stage-static-',dir=STATIC.parent) as d:
        t=Path(d)/'static';t.symlink_to(target,target_is_directory=True);os.replace(t,STATIC)

def ready(expected_image,commit,tree=None):
    until=time.monotonic()+180;last='nog niet gestart'
    while time.monotonic()<until:
        try:
            c=inspect();require(c['State']['Running'] and c['Image']==expected_image,'Stagingcontainer niet gereed')
            with urllib.request.urlopen('http://127.0.0.1:8185/version.json',timeout=3) as r:v=json.load(r)
            b=v.get('ttsBuild',{});require(b.get('commit')==commit and (tree is None or b.get('sourceTree')==tree),'Staging-viewerversie wijkt af')
            with urllib.request.urlopen('http://127.0.0.1:8185/api/user',timeout=3) as r:u=json.load(r)
            require(u.get('isAuthenticated') is False,'Staging-API geeft geen geldige anonieme respons');return
        except Exception as e:last=str(e);time.sleep(2)
    raise RuntimeError('Staging niet gezond: '+last)

def stop(files,log):h.logged(compose(files)+['stop','-t','30','tailormap'],log,'Staging stoppen')
def start(files,log):h.logged(compose(files)+['up','-d','--no-deps','--no-build','--pull','never','--force-recreate','tailormap'],log,'Staging starten')

def rollback(path):
    path=path.resolve();s=json.loads(path.read_text());require(path.parent.parent==BACKUPS.resolve() and s.get('kind')=='tts-staging-upstream-20261122','Onbekende staging herstelregistratie')
    require(p.fingerprint(render(COMPOSE))==s['old_compose_fingerprint'],'Oude stagingconfiguratie gewijzigd')
    require(p.fingerprint(render(s['new_compose_files']))==s['new_compose_fingerprint'],'Nieuwe stagingconfiguratie gewijzigd')
    try:c=inspect()
    except subprocess.CalledProcessError:c=None
    require(c is None or c['Image'] in (OLD_IMAGE,NEW_IMAGE),'Staging-image gewijzigd na deze release')
    require(STATIC.is_symlink() and str(STATIC.resolve()) in (s['old_viewer'],s['candidate']),'Staging static gewijzigd na deze release')
    if c:stop(s['new_compose_files'] if c['Image']==NEW_IMAGE else COMPOSE,path.parent/'rollback-stop.log')
    swap(s,True);link(s['old_viewer']);start(COMPOSE,path.parent/'rollback-start.log');ready(OLD_IMAGE,OLD_COMMIT)
    s.update(phase='ROLLED_BACK',active=False);save(path,s);print('Rollback geslaagd: oude stagingdatabase, API en viewer actief. Nieuwe gegevens blijven apart bewaard.',flush=True)

def deploy():
    c,cfg,old,oldmeta=baseline();history_guard();d,probe,dev=load_dev()
    require(p.digest('/srv/tailormap/scripts/refresh-policy.py')==POLICY_SHA,'Verwachte compatibele refresh-policy ontbreekt')
    ROOT.mkdir(parents=True,exist_ok=True);release=Path(tempfile.mkdtemp(prefix='promote-',dir=ROOT));token=secrets.token_hex(4);stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dt%H%M%Sz')
    candidate=p.CANDIDATES/f'tts-staging-upstream-20261122-{stamp}-{token}-branded'
    print('[1/3] Werkende DEV-artifacts voor staging voorbereiden; alle diensten blijven draaien. Werkmap:',release,flush=True)
    branding_hashes={str(x):p.digest(x) for lang in ('nl','en','de') for x in [old/lang/'index.html',old/lang/'styles-YU6ZJSX5.css',*(old/lang/n for n in p.BRANDING),old/lang/'manifest.webmanifest'] if x.is_file()}
    shutil.copytree(dev,candidate);branding(old,candidate,release,d)
    v=json.loads((candidate/'version.json').read_text());v['ttsBuild'].update(releaseTarget='staging',previousViewerCommit=OLD_COMMIT)
    (candidate/'version.json').write_text(json.dumps(v,indent=2)+'\n');(candidate/'version.json.gz').write_bytes(gzip.compress((candidate/'version.json').read_bytes(),mtime=0));p.make_readable(candidate)
    compile_migration(probe,release);check_runtime_options(c,release)
    newpin=release/'pinned-image.json';newpin.write_text(json.dumps({'services':{'tailormap':{'image':NEW_IMAGE}}})+'\n');files=COMPOSE+[str(newpin)]
    expected=json.loads(json.dumps(cfg));expected['services']['tailormap']['image']=NEW_IMAGE;require(render(files)==expected,'Nieuwe Compose wijzigt meer dan API-image')
    envfile=Path('/srv/tailormap-staging/.env');configs=[Path(x) for x in COMPOSE]+([envfile] if envfile.is_file() else [])
    config_hashes={str(x):p.digest(x) for x in configs}
    before=json.loads(sql('postgres',"SELECT jsonb_build_object('oid',oid::bigint,'owner',pg_get_userbyid(datdba)) FROM pg_database WHERE datname='"+DB+"';"))
    backup=BACKUPS/f'upstream-20261122-{stamp}-{token}';backup.mkdir(parents=True)
    for name in ['deploy-staging.py','StageMigrations.java']:
        dest=backup/'ops/tts-staging-upstream'/name;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(Path(__file__).with_name(name),dest)
    shutil.copytree(SUPPORT,backup/'ops/tts-dev-upstream',ignore=shutil.ignore_patterns('__pycache__'))
    for i,file in enumerate(configs):shutil.copy2(file,backup/f'config-{i}-{file.name}')
    (backup/'original-rendered.json').write_text(json.dumps(cfg,indent=2)+'\n');h.capture(['docker','tag',OLD_IMAGE,'local/tts-staging-before-upstream:20261122-'+token])
    s={'kind':'tts-staging-upstream-20261122','phase':'PREPARED','active':False,'old_image':OLD_IMAGE,'new_image':NEW_IMAGE,'old_viewer':str(old),'candidate':str(candidate),'new_compose_files':files,'old_compose_fingerprint':p.fingerprint(cfg),'new_compose_fingerprint':p.fingerprint(expected),'old_database_oid':before['oid'],'old_database':f'tts_stage_before_{stamp}_{token}','fresh_database':f'tts_stage_probe_{stamp}_{token}','failed_database':f'tts_stage_attempt_{stamp}_{token}','release':str(release)}
    statefile=backup/'state.json';save(statefile,s)
    rb=backup/'rollback.sh';rb.write_text('#!/bin/sh\nset -eu\nexec python3 '+shlex.quote(str(backup/'ops/tts-staging-upstream/deploy-staging.py'))+' --rollback '+shlex.quote(str(statefile))+'\n');rb.chmod(0o700)
    now,nowcfg,nowold,_=baseline();require(now['Id']==c['Id'] and nowcfg==cfg and nowold==old,'Staging gewijzigd tijdens voorbereiding')
    for f,sha in {**config_hashes,**branding_hashes}.items():require(p.digest(f)==sha,'Configuratie of branding gewijzigd tijdens voorbereiding')
    print('[2/3] Alleen Tailormap staging op 8185 wordt nu onderbroken. Rollback: bash '+str(rb),flush=True)
    try:
        s['phase']='STOPPING_STAGING';save(statefile,s);stop(COMPOSE,backup/'stop.log');s['phase']='STAGING_STOPPED';save(statefile,s)
        dump=backup/'staging-before-upstream.dump'
        with dump.open('wb') as output:subprocess.run(['docker','exec','postgis18-dev','pg_dump','-U','postgres','-p','5432','-d',DB,'-Fc'],stdout=output,check=True)
        s['database_dump_sha256']=p.digest(dump);save(statefile,s)
        subprocess.run(['docker','exec','postgis18-dev','createdb','-U','postgres','-p','5432','-O',before['owner'],s['fresh_database']],check=True)
        s['new_database_oid']=json.loads(sql('postgres',"SELECT to_jsonb(oid::bigint) FROM pg_database WHERE datname='"+s['fresh_database']+"';"));save(statefile,s)
        with dump.open('rb') as source,(backup/'restore.log').open('wb') as output:subprocess.run(['docker','exec','-i','postgis18-dev','pg_restore','-U','postgres','-p','5432','-d',s['fresh_database'],'--exit-on-error'],stdin=source,stdout=output,stderr=subprocess.STDOUT,check=True)
        migrate(s,probe,release);s['phase']='FRESH_DATABASE_MIGRATED';save(statefile,s)
        swap(s);s['phase']='DATABASE_NAMES_SWAPPED';save(statefile,s);link(candidate)
        print('[3/3] Nieuwe staging-viewer en API starten op 8185.',flush=True)
        start(files,backup/'start.log');ready(NEW_IMAGE,p.VIEWER_COMMIT,p.VIEWER_TREE)
        require(database_map(s).get(DB,{}).get('oid')==s['new_database_oid'],'Stagingdatabase wijkt af')
        s.update(phase='ACTIVE',active=True);save(statefile,s)
        print('Staging-upgrade actief op 8185. Viewercommit:',p.VIEWER_COMMIT);print('API-commit:',h.SOURCE_COMMIT)
        print('Officiële V38/V39/V40 toegepast; tts_start V1 en stagingconfiguratie behouden.');print('Oude stagingdatabase:',s['old_database']);print('DEV, productie en replica zijn ongewijzigd.');print('Rollback: bash '+str(rb));print('Registratie:',statefile)
    except BaseException:
        print('Activering mislukt; oorspronkelijke staging wordt hersteld. Logs:',backup,flush=True)
        try:rollback(statefile)
        except BaseException as e:print('Herstel niet voltooid; bewaar alle databases. Registratie: '+str(statefile)+'; '+str(e),file=sys.stderr)
        raise

def main():
    parser=argparse.ArgumentParser(description=__doc__);g=parser.add_mutually_exclusive_group(required=True);g.add_argument('--deploy',action='store_true');g.add_argument('--rollback',type=Path);args=parser.parse_args()
    os.umask(0o077);require(os.geteuid()==0,'Uitvoeren als root op LT3');require(Path('/srv/tailormap-staging').is_dir() and Path('/srv/tailormap-dev').is_dir(),'Verwachte LT3-omgeving ontbreekt')
    signal.signal(signal.SIGTERM,lambda *_:sys.exit(143));BACKUPS.mkdir(parents=True,exist_ok=True)
    with Path('/run/lock/tailormap-lt3-refresh.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        if args.rollback:rollback(args.rollback)
        else:deploy()

if __name__=='__main__':
    try:main()
    except (ValueError,RuntimeError,OSError,subprocess.CalledProcessError) as e:
        print('STOP: '+('Opdracht mislukt; zie release-log' if isinstance(e,subprocess.CalledProcessError) else str(e)),file=sys.stderr);sys.exit(1)
