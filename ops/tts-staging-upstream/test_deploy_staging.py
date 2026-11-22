import copy,importlib.util,json,subprocess,tempfile,unittest
from pathlib import Path
from unittest.mock import patch,MagicMock
spec=importlib.util.spec_from_file_location('stage',Path(__file__).with_name('deploy-staging.py'));s=importlib.util.module_from_spec(spec);spec.loader.exec_module(s)

class StageTests(unittest.TestCase):
 def state(self):return {'old_database_oid':1,'new_database_oid':2,'fresh_database':'tts_stage_probe_20261122t130000z_12345678','old_database':'tts_stage_before_20261122t130000z_12345678','failed_database':'tts_stage_attempt_20261122t130000z_12345678'}
 def test_sql_refuses_dev_replica_and_arbitrary_databases(self):
  with patch.object(s.h,'capture') as run:
   for name in ['tailormap','geodata_fresh','tailormap_stage_129;drop database x','tts_upstream_probe_20261122t130000z_12345678']:
    with self.subTest(name=name),self.assertRaises(ValueError):s.sql(name,'SELECT 1')
   run.assert_not_called()
 def test_database_map_refuses_other_environment_names(self):
  state=self.state();state['old_database']='tailormap'
  with patch.object(s,'sql') as sql,self.assertRaises(ValueError):s.database_map(state)
  sql.assert_not_called()
 def test_wrong_database_identity_does_not_rename(self):
  with patch.object(s,'database_map',return_value={s.DB:{'oid':999}}),patch.object(s,'sql') as sql,self.assertRaises(ValueError):s.swap(self.state())
  sql.assert_not_called()
 def test_forward_switch_is_transactional_and_staging_only(self):
  state=self.state()
  with patch.object(s,'database_map',return_value={s.DB:{'oid':1},state['fresh_database']:{'oid':2}}),patch.object(s,'block') as block,patch.object(s,'sql') as sql:
   s.swap(state)
  self.assertEqual([x.args[0] for x in block.call_args_list],[s.DB,state['fresh_database']])
  self.assertIn('BEGIN;ALTER DATABASE "tailormap_stage_129" RENAME TO',sql.call_args_list[0].args[1]);self.assertIn('COMMIT;',sql.call_args_list[0].args[1])
  self.assertNotIn('DROP DATABASE',str(sql.call_args_list))
 def test_rollback_before_swap_only_reenables_old_staging(self):
  state=self.state();state.pop('new_database_oid')
  with patch.object(s,'database_map',return_value={s.DB:{'oid':1}}),patch.object(s,'sql') as sql:s.swap(state,True)
  self.assertEqual(sql.call_count,1);self.assertIn('ALLOW_CONNECTIONS true',sql.call_args.args[1])
 def test_helper_compile_has_one_network_and_no_spring_start(self):
  with tempfile.TemporaryDirectory() as d,patch.object(s.h,'logged') as logged:
   s.compile_migration({'workdir':'/known/probe','build_image':'sha256:image'},Path(d))
   args=logged.call_args.args[0];self.assertEqual(args.count('--network'),1);self.assertEqual(args[args.index('--network')+1],'none');self.assertIn('javac',args[-1]);self.assertNotIn('TailormapApiApplication',args[-1]);self.assertIn('tailormap-api.jar',args[-1])
 def simulated(self,failure=None):
  with tempfile.TemporaryDirectory() as td:
   root=Path(td);releases=root/'releases';backups=root/'backups';backups.mkdir();candidates=root/'candidates';candidates.mkdir();old=root/'old';old.mkdir();dev=root/'dev';dev.mkdir();(dev/'version.json').write_text(json.dumps({'ttsBuild':{'commit':s.p.VIEWER_COMMIT,'sourceTree':s.p.VIEWER_TREE}}))
   static=root/'static';static.symlink_to(old,target_is_directory=True)
   cfg={'services':{'tailormap':{'image':s.OLD_IMAGE}}};newcfg=copy.deepcopy(cfg);newcfg['services']['tailormap']['image']=s.NEW_IMAGE
   c={'Id':'old'};effects=[]
   def sql(db,query):
    if 'jsonb_build_object' in query:return json.dumps({'oid':1,'owner':'tailormap'})
    if 'to_jsonb(oid' in query:return '2'
    raise AssertionError(query)
   def migrate(*args):
    effects.append('migration')
    if failure=='migration':raise RuntimeError('migration failure')
    if failure=='interrupt':raise SystemExit(143)
   def ready(image,*args):
    effects.append('ready:'+image)
    if failure=='health' and image==s.NEW_IMAGE:raise RuntimeError('health failure')
   def render(files):return cfg if len(files)==1 else newcfg
   def run(args,**kw):
    self.assertEqual(args[0],'docker');self.assertEqual(args[3 if args[2]=='-i' else 2],'postgis18-dev')
    if 'pg_dump' in args:kw['stdout'].write(b'dump')
    return subprocess.CompletedProcess(args,0)
   from contextlib import ExitStack
   with ExitStack() as stack:
    patches=[patch.object(s,'ROOT',releases),patch.object(s,'BACKUPS',backups),patch.object(s,'STATIC',static),patch.object(s.p,'CANDIDATES',candidates),patch.object(s,'baseline',return_value=(c,cfg,old,{})),patch.object(s,'history_guard'),patch.object(s,'load_dev',return_value=({}, {},dev)),patch.object(s,'branding'),patch.object(s,'compile_migration'),patch.object(s,'check_runtime_options'),patch.object(s,'render',side_effect=render),patch.object(s,'COMPOSE',[str(root/'compose.yml')]),patch.object(s,'sql',side_effect=sql),patch.object(s.h,'capture',return_value=''),patch.object(s,'stop',side_effect=lambda *_:effects.append('stop')),patch.object(s,'start',side_effect=lambda *_:effects.append('start')),patch.object(s,'migrate',side_effect=migrate),patch.object(s,'swap',side_effect=lambda _,reverse=False:effects.append('swap-reverse' if reverse else 'swap-forward')),patch.object(s,'ready',side_effect=ready),patch.object(s,'database_map',return_value={s.DB:{'oid':2}}),patch.object(s,'inspect',return_value={'Image':s.NEW_IMAGE}),patch.object(s.subprocess,'run',side_effect=run)]
    (root/'compose.yml').write_text('services: {}')
    # Use actual SHA guard against a temporary fixture, without weakening artifact digest checks.
    digest=s.p.digest
    stack.enter_context(patch.object(s.p,'digest',side_effect=lambda file:s.POLICY_SHA if str(file)=='/srv/tailormap/scripts/refresh-policy.py' else digest(file)))
    for item in patches:stack.enter_context(item)
    if failure:
     with self.assertRaises((RuntimeError,SystemExit)):s.deploy()
    else:s.deploy()
   state=json.loads(next(backups.glob('*/state.json')).read_text())
   self.assertEqual(state['phase'],'ROLLED_BACK' if failure else 'ACTIVE')
   self.assertEqual(static.resolve(),old if failure else Path(state['candidate']))
   self.assertIn('swap-reverse' if failure else 'swap-forward',effects)
   self.assertTrue(next(backups.glob('*/rollback.sh')).is_file())
   if failure=='migration':self.assertNotIn('swap-forward',effects)
 def test_success_retains_rollback_and_staging_configuration(self):self.simulated()
 def test_migration_failure_restores_old_staging(self):self.simulated('migration')
 def test_start_failure_restores_database_api_and_viewer(self):self.simulated('health')
 def test_interruption_attempts_automatic_restore(self):self.simulated('interrupt')

if __name__=='__main__':unittest.main()
