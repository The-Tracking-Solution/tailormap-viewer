import hashlib
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('upgrade',Path(__file__).with_name('upgrade-refresh-policy.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class UpgradeTests(unittest.TestCase):
 def test_preserves_original_helper_and_is_idempotent(self):
  with tempfile.TemporaryDirectory() as folder:
   root=Path(folder);installed=root/'installed';installed.mkdir();old=b'# old helper\n';new=b'# new helper\n'
   (installed/'refresh-lt3-data.sh').write_bytes(b'script');(installed/'refresh-geodata.py').write_bytes(b'geodata');p=installed/'refresh-policy.py';p.write_bytes(old);p.chmod(0o700)
   with patch.object(m,'DIRECTORY',installed),patch.object(m,'SCRIPT_SHA',m.sha(b'script')),patch.object(m,'GEODATA_SHA',m.sha(b'geodata')),patch.object(m,'OLD_SHA',m.sha(old)),patch.object(m,'NEW_SHA',m.sha(new)),patch.object(m,'transform',return_value=new.decode()):
    self.assertEqual(m.install(root/'backup'),'UPDATED');self.assertEqual((root/'backup/refresh-policy.before').read_bytes(),old);self.assertEqual(p.read_bytes(),new);self.assertEqual(p.stat().st_mode & 0o777,0o700);self.assertEqual(m.install(root/'backup'),'ALREADY_CURRENT')
 def test_unknown_helper_is_never_overwritten(self):
  with tempfile.TemporaryDirectory() as folder:
   root=Path(folder);(root/'refresh-lt3-data.sh').write_bytes(b'script');(root/'refresh-geodata.py').write_bytes(b'geodata');p=root/'refresh-policy.py';p.write_bytes(b'unknown')
   with patch.object(m,'DIRECTORY',root),patch.object(m,'SCRIPT_SHA',m.sha(b'script')),patch.object(m,'GEODATA_SHA',m.sha(b'geodata')),patch.object(m,'transform') as transform:
    with self.assertRaises(ValueError):m.install(root/'backup')
    transform.assert_not_called();self.assertEqual(p.read_bytes(),b'unknown')
 def test_patch_refuses_unrecognized_source_shape(self):
  with self.assertRaises(ValueError):m.transform('print("not the refresh helper")')
if __name__=='__main__':unittest.main()
