import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('prepare',Path(__file__).with_name('prepare-dev-release.py'));r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)
class PrepareTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.root=Path(self.temp.name)
 def test_runtime_keeps_uid_and_does_not_assume_an_executable_jar(self):
  text=r.runtime_dockerfile('local/test-base:20261122-abcd')
  self.assertIn('USER 1002:1001',text);self.assertIn('ENTRYPOINT ["/bin/sh","/app/start.sh"]',text);self.assertIn('CMD []',text)
  with self.assertRaises(ValueError):r.runtime_dockerfile('malformed\nRUN false')
 def test_dependency_order_is_preserved_and_escape_is_refused(self):
  cache=self.root/'m2';repo=cache/'repository';repo.mkdir(parents=True);(repo/'b.jar').write_bytes(b'b');(repo/'a.jar').write_bytes(b'a')
  cp=self.root/'classpath';cp.write_text('/root/.m2/repository/b.jar:/root/.m2/repository/a.jar')
  result=r.copy_dependencies(cp,cache,self.root/'lib');self.assertEqual(result,['/app/lib/0000-b.jar','/app/lib/0001-a.jar'])
  outside=self.root/'outside.jar';outside.write_bytes(b'outside');(repo/'link.jar').symlink_to(outside);cp.write_text('/root/.m2/repository/link.jar')
  with self.assertRaises(ValueError):r.copy_dependencies(cp,cache,self.root/'refused')
 def test_only_verified_probe_and_exact_jar_are_accepted(self):
  with patch.object(r,'ROOT',self.root):
   work=self.root/'probe';work.mkdir();path=work/'probe.json';jar=work/'api-build/source/target/tailormap-api.jar';jar.parent.mkdir(parents=True);jar.write_bytes(b'jar')
   data={'workdir':str(work),'state':'API_START_VERIFIED_ON_COPY','api_start_verified':True,'probe_runtime_removed':True,'container':'postgis18-dev','source':'tailormap','database':'tts_upstream_probe_20261121t183941z_e863f0c7','api_source_commit':r.helpers.SOURCE_COMMIT,'api_source_tree':r.helpers.SOURCE_TREE,'api_jar':str(jar),'api_jar_sha256':hashlib.sha256(b'jar').hexdigest(),'build_image':'sha256:'+'a'*64};path.write_text(json.dumps(data));r.load_probe(path)
   for key,value in [('database','tailormap'),('state','MIGRATED_ON_COPY'),('api_jar_sha256','wrong'),('probe_runtime_removed',False)]:
    old=data[key];data[key]=value;path.write_text(json.dumps(data))
    with self.subTest(key=key),self.assertRaises(ValueError):r.load_probe(path)
    data[key]=old

if __name__=='__main__':unittest.main()
