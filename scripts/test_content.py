#!/usr/bin/env python3
"""Check scaffold isolation, schema metadata, format linking and overwrite safety."""
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]

class ScaffoldTest(unittest.TestCase):
    def test_draft_and_overwrite(self):
        with tempfile.TemporaryDirectory() as tmp:
            command = ['python3', str(ROOT / 'scripts/content.py'), 'new-scenario', '--id', 'test-draft', '--output', tmp]
            result = subprocess.run(command, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            path = Path(tmp) / 'corpus/test-draft.json'
            q = json.loads(path.read_text())
            self.assertEqual(q['schema_version'], 1)
            self.assertEqual(q['review_status'], 'preview')
            self.assertTrue((Path(tmp) / 'formats' / (q['format_id'] + '.json')).exists())
            original = path.read_bytes()
            self.assertNotEqual(subprocess.run(command, capture_output=True).returncode, 0)
            self.assertEqual(path.read_bytes(), original)

    def test_reject_path_id(self):
        result = subprocess.run(['python3', str(ROOT / 'scripts/content.py'), 'new-format', '--id', '../unsafe'], capture_output=True)
        self.assertNotEqual(result.returncode, 0)

if __name__ == '__main__':
    unittest.main()
