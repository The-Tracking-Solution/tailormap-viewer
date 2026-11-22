import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('activation',Path(__file__).with_name('activate-dev-release.py'));a=importlib.util.module_from_spec(spec);spec.loader.exec_module(a)

class ActivationTests(unittest.TestCase):
 def test_rejects_unsafe_database_identifiers(self):
  for name in ['tailormap;DROP DATABASE x','x"','x'*64,'../db']:
   with self.subTest(name=name),self.assertRaises(ValueError):a.ident(name)
 def test_oid_mismatch_never_renames_databases(self):
  state={'old_database_oid':1,'new_database_oid':2,'fresh_database':'fresh','old_database':'old','failed_database':'failed'}
  with patch.object(a,'database_map',return_value={'tailormap':{'oid':999},'fresh':{'oid':2}}),patch.object(a,'sql') as execute:
   with self.assertRaises(ValueError):a.swap_databases(state)
   execute.assert_not_called()
 def test_unswapped_database_recovery_requires_no_new_oid(self):
  state={'old_database_oid':1}
  with patch.object(a,'database_map',return_value={'tailormap':{'oid':1}}),patch.object(a,'sql') as execute:
   a.swap_databases(state,reverse=True);self.assertEqual(execute.call_args.args,('postgres','ALTER DATABASE tailormap ALLOW_CONNECTIONS true;'))
 def exercise(self,failure=None):
  with tempfile.TemporaryDirectory() as directory:
   root=Path(directory);backups=root/'backups';backups.mkdir();old=root/'old';old.mkdir();new=root/'new';new.mkdir();static=root/'static';static.symlink_to(old)
   prepared=root/'prepared.json';prepared.write_text('{}')
   data={'probe':str(root/'probe.json'),'old_image':a.prep.OLD_IMAGE,'new_image':'sha256:new','old_compose_files':['base','oldpin'],'new_compose_files':['base','newpin'],'old_compose_fingerprint':'same','old_viewer':str(old),'candidate':str(new)}
   probe={'workdir':str(root/'accepted')}
   observed={'database':'old','image':a.prep.OLD_IMAGE,'commands':[]}
   def capture(args,**kwargs):
    if args[:3]==['docker','inspect','tailormap-dev']:return json.dumps([{'Image':observed['image']}])
    raise AssertionError(args)
   def logged(args,*rest):
    observed['commands'].append(args)
    if 'up' in args:observed['image']='sha256:new' if 'newpin' in args else a.prep.OLD_IMAGE
   def run(args,**kwargs):
    observed['commands'].append(args)
    if 'pg_dump' in args:kwargs['stdout'].write(b'fixture dump')
    return subprocess.CompletedProcess(args,0)
   def sql(db,statement):
    if "jsonb_build_object('recovery'" in statement:return json.dumps({'recovery':False,'port':'5432','oid':1,'owner':'postgres'})
    if 'to_jsonb(oid::bigint)' in statement:return '2'
    return ''
   def swap(state,reverse=False):observed['database']='old' if reverse else 'new'
   def migrate(*args):
    if failure=='migration':raise RuntimeError('migration fixture failure')
    if failure=='signal':raise SystemExit(143)
   def wait(image,*args):
    if failure=='health' and image=='sha256:new':raise RuntimeError('new API fixture failure')
   with patch.object(a,'BACKUPS',backups),patch.object(a.prep,'STATIC',static),patch.object(a,'validate_prepared',return_value=data),patch.object(a.prep,'load_probe',return_value=probe),patch.object(a.policy,'install',return_value='UPDATED'),patch.object(a,'sql',side_effect=sql),patch.object(a.helpers,'capture',side_effect=capture),patch.object(a.helpers,'logged',side_effect=logged),patch.object(a.subprocess,'run',side_effect=run),patch.object(a,'migrate_fresh',side_effect=migrate),patch.object(a,'swap_databases',side_effect=swap),patch.object(a,'database_map',side_effect=lambda state:{'tailormap':{'oid':1 if observed['database']=='old' else 2}}),patch.object(a.prep,'render',return_value={}),patch.object(a.prep,'fingerprint',return_value='same'),patch.object(a,'wait_ready',side_effect=wait):
    if failure:
     with self.assertRaises(SystemExit if failure=='signal' else RuntimeError):a.activate(prepared)
    else:a.activate(prepared)
   records=list(backups.glob('*/state.json'));self.assertEqual(len(records),1);record=json.loads(records[0].read_text())
   if failure:
    self.assertEqual(observed['database'],'old');self.assertEqual(observed['image'],a.prep.OLD_IMAGE);self.assertEqual(static.resolve(),old);self.assertEqual(record['phase'],'ROLLED_BACK')
   else:
    self.assertEqual(observed['database'],'new');self.assertEqual(observed['image'],'sha256:new');self.assertEqual(static.resolve(),new);self.assertEqual(record['phase'],'ACTIVE')
   self.assertFalse(any('DROP DATABASE' in ' '.join(c) for c in observed['commands']))
   self.assertTrue((records[0].parent/'rollback.sh').is_file())
   self.assertTrue((records[0].parent/'upgrade-refresh-policy.py').is_file())
 def test_success_switches_only_the_prepared_dev_release(self):self.exercise()
 def test_migration_failure_restores_original_runtime(self):self.exercise('migration')
 def test_failed_new_api_restores_database_image_and_viewer(self):self.exercise('health')
 def test_signal_during_migration_restores_original_runtime(self):self.exercise('signal')

if __name__=='__main__':unittest.main()
