import contextlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('runner',Path(__file__).with_name('migrate-dev-probe.py'))
runner=importlib.util.module_from_spec(spec);spec.loader.exec_module(runner)


class ProbeRunnerTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name);self.patch=patch.object(runner,'ROOT',self.root);self.patch.start();self.addCleanup(self.patch.stop)
        self.work=self.root/'probe-20261121t183941z-e863f0c7';self.work.mkdir()
        self.manifest=self.work/'probe.json'
        self.data={'container':'postgis18-dev','source':'tailormap','database':'tts_upstream_probe_20261121t183941z_e863f0c7','workdir':str(self.work),'state':'LEGACY_ARCHIVED_ON_COPY','official_migrations_applied':False,'application_started':False}
        self.save()
    def save(self):self.manifest.write_text(json.dumps(self.data))
    def test_accepts_confirmed_probe(self):
        self.assertEqual(runner.load_probe(self.manifest)['database'],self.data['database'])
    def test_refuses_live_names_wrong_container_and_used_probes(self):
        for key,value in [('database','tailormap'),('database','tailormap_stage_129'),('container','postgis18'),('state','MIGRATION_STARTED_ON_COPY'),('official_migrations_applied',True),('application_started',True)]:
            original=self.data[key];self.data[key]=value;self.save()
            with self.subTest(key=key,value=value),self.assertRaises(ValueError):runner.load_probe(self.manifest)
            self.data[key]=original
    def exercise(self,fail=False):
        commands=[]
        def capture(args,**kwargs):
            if args[0]=='git':return runner.SOURCE_TREE
            if args[:3]==['docker','image','inspect']:return 'sha256:testimage'
            raise AssertionError(args)
        def logged(args,log,label):
            commands.append(args)
            if label=='API bouwen':
                target=self.work/'api-build/source/target';target.mkdir();(target/'tailormap-api.jar').write_bytes(b'test artifact')
            if label=='Proefmigratie':
                env=self.work/'api-build/connection.env';self.assertTrue(env.exists())
                self.assertIn('TTS_PROBE_DATABASE='+self.data['database'],env.read_text())
                self.assertEqual(env.stat().st_mode & 0o777,0o600)
                if fail:raise RuntimeError('synthetic migration failure')
                (self.work/'api-build/migration-result.json').write_text(json.dumps({'official_migrations':3,'private_migrations':0,'repeat_migrations':0,'application_started':False}))
        with patch.object(runner,'capture',side_effect=capture),patch.object(runner,'logged',side_effect=logged),patch.object(runner,'credentials',return_value=('postgres','test-only')),patch('sys.argv',['runner','--probe',str(self.manifest)]),contextlib.redirect_stdout(io.StringIO()):
            if fail:
                with self.assertRaises(RuntimeError):runner.main()
            else:runner.main()
        self.assertFalse((self.work/'api-build/connection.env').exists())
        migration=next(c for c in commands if '--env-file' in c)
        self.assertIn('container:postgis18-dev',migration)
        self.assertTrue(all(c[0]!='docker' or c[1] in ('pull','run') for c in commands))
        self.assertFalse(any('compose' in c or 'restart' in c or 'stop' in c for c in commands))
        return json.loads(self.manifest.read_text())
    def test_success_records_artifact_without_starting_application(self):
        result=self.exercise();self.assertEqual(result['state'],'MIGRATED_ON_COPY');self.assertFalse(result['application_started']);self.assertTrue(result['official_migrations_applied'])
    def test_failure_removes_credentials_and_blocks_blind_retry(self):
        result=self.exercise(fail=True);self.assertEqual(result['state'],'MIGRATION_STARTED_ON_COPY')
        with self.assertRaises(ValueError):runner.load_probe(self.manifest)


if __name__=='__main__':unittest.main()
