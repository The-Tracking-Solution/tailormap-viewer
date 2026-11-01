import importlib.util
import gzip
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('runner', Path(__file__).with_name('deploy-dev.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class DeploymentTests(unittest.TestCase):
    def test_wrong_api_image_stops_without_compose_or_restart(self):
        with patch.object(m, 'inspect', return_value={'State': {'Running': True}, 'Image': 'other'}), patch.object(m, 'run') as run:
            with self.assertRaisesRegex(RuntimeError, 'API-image'):
                m.baseline()
            run.assert_not_called()

    def test_atomic_switch_keeps_both_candidates_and_rejects_collision(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            old, new = root / 'old', root / 'new'
            old.mkdir(); new.mkdir()
            link = root / 'static'; link.symlink_to(old)
            with patch.object(m, 'STATIC', link):
                m.atomic_link(new)
                self.assertEqual(link.resolve(), new)
                self.assertTrue(old.is_dir())
                link.with_name('static.follow-next').write_text('preserve')
                with self.assertRaises(RuntimeError):
                    m.atomic_link(old)
                self.assertEqual(link.resolve(), new)

    def test_restart_pins_original_image_and_only_recreates_dev_service(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(m, 'run') as run:
            m.restart({'backup': directory}, Path(directory) / 'log')
            command = run.call_args.args[0]
            self.assertEqual(command[-1], 'tailormap')
            self.assertIn('--no-deps', command)
            self.assertIn('--no-build', command)
            self.assertIn('--force-recreate', command)
            self.assertNotIn('down', command)
            self.assertEqual(json.loads((Path(directory) / 'pinned-image.json').read_text()),
                             {'services': {'tailormap': {'image': m.IMAGE}}})

    def test_failed_activation_restores_old_viewer_and_reraises(self):
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / 'state.json'; state.write_text('{}')
            with patch.object(m, 'atomic_link'), patch.object(m, 'restart'), \
                 patch.object(m, 'wait_up', side_effect=RuntimeError('health failed')), patch.object(m, 'rollback') as rollback:
                with self.assertRaisesRegex(RuntimeError, 'health failed'):
                    m.activate(state)
                rollback.assert_called_once_with(state)

    def test_rollback_handles_missing_container_after_failed_recreation(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); old = root / 'old'; new = root / 'new'
            old.mkdir(); new.mkdir(); link = root / 'static'; link.symlink_to(new)
            state = root / 'state.json'
            state.write_text(json.dumps({'image': m.IMAGE, 'new_commit': m.SOURCE_COMMIT,
                                         'old_viewer': str(old), 'compose_config': {}, 'backup': str(root)}))
            with patch.object(m, 'STATIC', link), patch.object(m, 'CANDIDATE', new), \
                 patch.object(m, 'run', return_value='{}'), patch.object(m, 'inspect', side_effect=RuntimeError('missing')), \
                 patch.object(m, 'restart') as restart, patch.object(m, 'wait_up') as wait:
                m.rollback(state)
                self.assertEqual(link.resolve(), old)
                restart.assert_called_once()
                wait.assert_called_once_with(m.BASE_COMMIT)

    def test_stale_rollback_does_not_overwrite_later_viewer(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); later = root / 'later'; later.mkdir()
            link = root / 'static'; link.symlink_to(later)
            state = root / 'state.json'
            state.write_text(json.dumps({'image': m.IMAGE, 'new_commit': m.SOURCE_COMMIT, 'old_viewer': '/old'}))
            with patch.object(m, 'STATIC', link), patch.object(m, 'atomic_link') as switch:
                with self.assertRaisesRegex(RuntimeError, 'gewijzigd'):
                    m.rollback(state)
                switch.assert_not_called()

    def test_stale_rollback_does_not_overwrite_new_compose(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); old = root / 'old'; old.mkdir()
            link = root / 'static'; link.symlink_to(old)
            state = root / 'state.json'
            state.write_text(json.dumps({'image': m.IMAGE, 'new_commit': m.SOURCE_COMMIT,
                                         'old_viewer': str(old), 'compose_config': {}}))
            with patch.object(m, 'STATIC', link), patch.object(m, 'run', return_value='{"changed":true}'), \
                 patch.object(m, 'atomic_link') as switch:
                with self.assertRaisesRegex(RuntimeError, 'Compose'):
                    m.rollback(state)
                switch.assert_not_called()

    def test_branding_preserves_new_code_and_compressed_assets(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); old, new = root / 'old', root / 'new'
            for language in ('en', 'nl', 'de'):
                for base in (old, new):
                    (base / language / 'icons').mkdir(parents=True)
                    (base / language / 'styles-ABC.css').write_text('old-custom' if base == old else 'default-css')
                    (base / language / 'index.html').write_text('<title>Custom</title>old.js' if base == old else '<title>Default</title>new.js')
                for name in m.BRANDING:
                    (old / language / name).write_text('TTS')
                (new / language / 'main.js').write_text('new code')
            m.brand(new, old)
            self.assertEqual((new / 'nl/main.js').read_text(), 'new code')
            self.assertIn('new.js', (new / 'nl/index.html').read_text())
            self.assertIn('<title>Custom</title>', (new / 'nl/index.html').read_text())
            self.assertEqual(gzip.decompress((new / 'nl/icons/logo.svg.gz').read_bytes()), b'TTS')
            self.assertEqual(gzip.decompress((new / 'nl/styles-ABC.css.gz').read_bytes()), b'old-custom')

    def test_unknown_global_stylesheet_does_not_copy_old_css(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); old, new = root / 'old', root / 'new'
            old.mkdir(); new.mkdir()
            (old / 'styles-OLD.css').write_text('old')
            (new / 'styles-NEW.css').write_text('new')
            with self.assertRaisesRegex(RuntimeError, 'stylesheet'):
                m.brand(new, old)
            self.assertEqual((new / 'styles-NEW.css').read_text(), 'new')


if __name__ == '__main__':
    unittest.main()
