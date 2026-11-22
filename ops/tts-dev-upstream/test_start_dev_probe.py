import contextlib
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
import zipfile
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('start_runner',Path(__file__).with_name('start-dev-probe.py'))
r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)

class StartProbeTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name)
  p=patch.object(r,'ROOT',self.root);p.start();self.addCleanup(p.stop)
  self.work=self.root/'probe-test';self.work.mkdir();self.path=self.work/'probe.json'
  jar=self.work/'api-build/source/target/tailormap-api.jar';jar.parent.mkdir(parents=True)
  with zipfile.ZipFile(jar,'w') as z:z.writestr('org/tailormap/api/TailormapApiApplication.class',b'fixture class')
  (self.work/'api-build/classpath.txt').write_text('/root/.m2/repository/example.jar')
  self.data={'container':'postgis18-dev','source':'tailormap','database':'tts_upstream_probe_20261121t183941z_e863f0c7','workdir':str(self.work),'state':'MIGRATED_ON_COPY','official_migrations_applied':True,'application_started':False,'api_source_commit':r.helpers.SOURCE_COMMIT,'api_source_tree':r.helpers.SOURCE_TREE,'api_jar':str(jar),'api_jar_sha256':hashlib.sha256(jar.read_bytes()).hexdigest(),'build_image':'sha256:'+'a'*64}
  self.save()
 def save(self):self.path.write_text(json.dumps(self.data))
 def test_rejects_live_targets_changed_jar_and_wrong_state(self):
  for key,value in [('database','tailormap'),('state','API_START_ATTEMPTED_ON_COPY'),('api_jar_sha256','wrong'),('container','postgis18'),('application_started',True)]:
   old=self.data[key];self.data[key]=value;self.save()
   with self.subTest(key=key),self.assertRaises(ValueError):r.load_start_probe(self.path)
   self.data[key]=old
 def test_retries_only_the_confirmed_manifest_failure(self):
  self.data.update(state='API_START_ATTEMPTED_ON_COPY',application_started=True,probe_runtime_removed=True)
  old=self.work/'api-start';old.mkdir();log=old/'api.log'
  log.write_text('no main manifest attribute, in /probe-api.jar\n');self.save()
  self.assertEqual(r.load_start_probe(self.path)['database'],self.data['database'])
  log.write_text('an unrelated startup failure')
  with self.assertRaises(ValueError):r.load_start_probe(self.path)
  log.write_text('no main manifest attribute, in /probe-api.jar\n');self.data['api_start_mode']='classpath-v2';self.save()
  with self.assertRaises(ValueError):r.load_start_probe(self.path)
 def exercise(self,fail):
  commands=[]
  def run(args,**kwargs):
   commands.append(args)
   if args[:3]==['docker','container','inspect']:return subprocess.CompletedProcess(args,1)
   if args[:2]==['docker','inspect']:return subprocess.CompletedProcess(args,0,stdout='upstream-api-probe\n')
   return subprocess.CompletedProcess(args,0)
  def capture(args):
   commands.append(args)
   if args[:3]==['docker','run','-d']:
    self.assertIn('container:postgis18-dev',args);self.assertIn('--spring.quartz.auto-startup=false',args)
    self.assertFalse('-jar' in args);self.assertIn('org.tailormap.api.TailormapApiApplication',args);self.assertIn('/probe-api.jar:/root/.m2/repository/example.jar',args)
    self.assertFalse('-p' in args);self.assertIn('--server.address=127.0.0.1',args)
   return 'container-id'
  def logged(*args):
   if fail and args[2]=='Proefstart':raise RuntimeError('startup failed')
  with patch.object(r.subprocess,'run',side_effect=run),patch.object(r.helpers,'capture',side_effect=capture),patch.object(r.helpers,'logged',side_effect=logged),patch.object(r.helpers,'credentials',return_value=('postgres','test-password')),patch.object(r,'snapshot',return_value={'stable':'snapshot'}),patch('sys.argv',['runner','--probe',str(self.path)]),contextlib.redirect_stdout(io.StringIO()):
   if fail:
    with self.assertRaises(RuntimeError):r.main()
   else:r.main()
  self.assertFalse((self.work/'api-start-classpath/connection.env').exists())
  self.assertIn(['docker','rm','-f','tts-api-probe-e863f0c7'],commands)
  self.assertFalse(any('compose' in c or 'restart' in c for c in commands))
  return json.loads(self.path.read_text())
 def test_success_cleans_temporary_container_and_records_result(self):
  d=self.exercise(False);self.assertEqual(d['state'],'API_START_VERIFIED_ON_COPY');self.assertTrue(d['probe_runtime_removed'])
 def test_failure_cleans_credentials_and_container(self):
  d=self.exercise(True);self.assertEqual(d['state'],'API_START_ATTEMPTED_ON_COPY');self.assertTrue(d['probe_runtime_removed'])

if __name__=='__main__':unittest.main()
