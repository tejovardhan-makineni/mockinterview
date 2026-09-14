#!/usr/bin/env python3
"""Check scaffold isolation, schema metadata, format linking and overwrite safety."""
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]

class CareerCoverageTest(unittest.TestCase):
    def test_new_professions_have_specialist_progression(self):
        questions = [json.loads(path.read_text()) for path in (ROOT / 'api/data/corpus').glob('*.json')]
        new_professions = '''cybersecurity it_support quality_assurance project_management
            business_operations accounting customer_support retail_hospitality supply_chain
            skilled_trades public_service social_work research creative_communications'''.split()
        for profession in new_professions:
            with self.subTest(profession=profession):
                # Shared career/behavioral scenarios must not disguise shallow specialist coverage.
                specialist = [q for q in questions if q['areas'][0] == profession]
                self.assertGreaterEqual(len(specialist), 2)
                self.assertTrue(any(q['difficulty'] in ('entry', 'junior') for q in specialist))
                self.assertTrue(any(q['difficulty'] in ('mid', 'senior', 'staff') for q in specialist))
                for question in specialist:
                    self.assertEqual(question['schema_version'], 1)
                    self.assertTrue(question['reference']['facts'])
                    self.assertTrue(question['reference']['probes'])
                    self.assertTrue(question['learning_drills'])
                    for dimension in question['rubric']:
                        self.assertTrue({'0', '2', '4'} <= dimension['anchors'].keys())
                        self.assertEqual(len(set(dimension['anchors'].values())), len(dimension['anchors']))

    def test_career_foundations_are_available_to_every_profession(self):
        schema = json.loads((ROOT / 'api/data/schemas/scenario-v1.schema.json').read_text())
        professions = set(schema['properties']['areas']['items']['enum'])
        questions = [json.loads(path.read_text()) for path in (ROOT / 'api/data/corpus').glob('career-*.json')]
        self.assertTrue(questions)
        for question in questions:
            with self.subTest(question=question['id']):
                self.assertEqual(question['areas'][0], 'career_foundations')
                self.assertEqual(set(question['areas']), professions)
                self.assertTrue(question['learning_drills'])

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
