"""Run with: python scripts/render-epub-mupdf.test.py (no PyMuPDF required)."""
import argparse
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('renderer', Path(__file__).with_name('render-epub-mupdf.py'))
renderer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(renderer)


class RendererTests(unittest.TestCase):
    def test_exact_epub3_notice(self):
        notice = 'unknown epub version: 3.0'
        self.assertEqual(renderer.classify_messages(notice), ([notice], []))
        for warning in ['unknown epub version: 4.0', 'unknown epub version: <none>',
                        'unknown epub version: 3.0 extra', 'cannot load font-face: font.woff2',
                        'syntax error: css syntax error', 'ignoring chapter broken.xhtml']:
            with self.subTest(warning=warning):
                self.assertEqual(renderer.classify_messages(notice + '\n' + warning), ([notice], [warning]))

    def test_viewport_validation(self):
        self.assertEqual(renderer.viewport_widths('420,240,420'), [420, 240])
        for value in ['', 'nan', '119', '3001', '240.5', '240,']:
            with self.subTest(value=value), self.assertRaises(argparse.ArgumentTypeError):
                renderer.viewport_widths(value)
        for value in ['nan', 'inf', '-1', '5']:
            with self.subTest(value=value), self.assertRaises(argparse.ArgumentTypeError):
                renderer.bounded_number(value, 0.5, 4)


if __name__ == '__main__':
    unittest.main()
