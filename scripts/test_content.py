#!/usr/bin/env python3
"""Check scaffold isolation, schema metadata, format linking and overwrite safety."""
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]

class CareerCoverageTest(unittest.TestCase):
    def test_each_specialist_area_has_accessible_and_advanced_authored_work(self):
        questions = [json.loads(path.read_text()) for path in (ROOT / 'api/data/corpus').glob('*.json')]
        schema = json.loads((ROOT / 'api/data/schemas/scenario-v1.schema.json').read_text())
        for area in schema['properties']['areas']['items']['enum']:
            if area in ('career_foundations', 'management', 'engineering_management'):
                continue
            with self.subTest(area=area):
                primary = [q for q in questions if q['areas'][0] == area]
                self.assertGreaterEqual(len(primary), 3)
                self.assertTrue(any(q['difficulty'] in ('entry', 'junior') for q in primary))
                self.assertTrue(any(q['difficulty'] in ('senior', 'staff', 'principal') for q in primary))

    def test_management_paths_use_management_tasks_not_relabelled_coding(self):
        questions = {q['id']: q for path in (ROOT / 'api/data/corpus').glob('*.json') for q in [json.loads(path.read_text())]}
        for path_id in ('first-time-manager-practice', 'experienced-manager-practice',
                        'engineering-manager-practice', 'senior-manager-practice',
                        'director-leadership-practice', 'vice-president-practice',
                        'executive-leadership-practice'):
            with self.subTest(path=path_id):
                pack = json.loads((ROOT / 'api/data/packs' / (path_id + '.json')).read_text())
                self.assertGreaterEqual(len(pack['rounds']), 3)
                self.assertEqual(len({r['question_id'] for r in pack['rounds']}), len(pack['rounds']))
                for rd in pack['rounds']:
                    q = questions[rd['question_id']]
                    self.assertIn(q['role_track'], ('management', 'executive'))
                    self.assertIn(q['areas'][0], ('management', 'engineering_management'))
                    self.assertEqual(rd['role_track'], q['role_track'])
                    self.assertEqual(rd['difficulty'], q['difficulty'])
                    self.assertTrue(q['reference']['facts'])
                    self.assertTrue(q['reference']['fair_alternatives'])
                    self.assertEqual(q['review_status'], 'preview')

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
