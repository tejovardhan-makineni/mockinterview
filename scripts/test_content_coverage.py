#!/usr/bin/env python3
"""Prevent shared counts or unfilled worksheets from becoming review claims."""
import unittest
from content_coverage import audit, review_packet


class CoverageTest(unittest.TestCase):
    def test_cross_tagged_question_counts_once_as_primary(self):
        result = audit([
            {'id': 'shared', 'areas': ['career_foundations', 'medicine', 'law'], 'difficulty': 'senior'},
            {'id': 'clinical', 'areas': ['medicine', 'nursing'], 'difficulty': 'entry', 'role_track': 'individual_contributor'},
        ], ['career_foundations', 'medicine', 'law', 'nursing', 'pharmacy'])
        rows = {row['area']: row for row in result['areas']}
        self.assertEqual((rows['medicine']['primary'], rows['medicine']['shared'], rows['medicine']['listed']), (1, 1, 2))
        self.assertEqual(rows['medicine']['primary_levels'], {'entry': 1})
        self.assertFalse(rows['medicine']['advanced_specialist'])
        self.assertEqual(rows['law']['primary'], 0)
        self.assertEqual(rows['pharmacy']['listed'], 0)
        self.assertEqual(sum(row['primary'] for row in rows.values()), 2)
        self.assertEqual(result['review_status'], {'preview': 2})

    def test_review_requires_provenance_and_never_claims_calibration(self):
        q = {'id': 'management', 'areas': ['management'], 'difficulty': 'director', 'role_track': 'management', 'review_status': 'reviewed'}
        self.assertEqual(audit([q], ['management'])['areas'][0]['practitioner_reviewed'], 0)
        q['provenance'] = {'reviewer': 'Fictional test reviewer', 'reviewed_at': '2026-10-04'}
        self.assertEqual(audit([q], ['management'])['areas'][0]['practitioner_reviewed'], 1)
        packet = review_packet(q)
        self.assertEqual(packet['practitioner_review']['disposition'], 'pending')
        self.assertIsNone(packet['practitioner_review']['reviewer'])
        self.assertEqual(packet['calibration']['status'], 'not_run')
        self.assertEqual(packet['calibration']['independent_reviewers'], [])


if __name__ == '__main__':
    unittest.main()
