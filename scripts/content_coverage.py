#!/usr/bin/env python3
"""Audit primary specialist coverage separately from shared discovery matches.

This reads source content only. Counts and complete rubrics do not establish
practitioner review, scoring calibration or hiring validity.
"""
import argparse
from collections import Counter
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LEVELS = ('entry', 'junior', 'mid', 'senior', 'staff', 'principal', 'manager',
          'senior_manager', 'director', 'vp', 'executive')


def audit(questions, areas):
    rows = []
    for area in sorted(areas):
        primary = [q for q in questions if q['areas'][0] == area]
        shared = [q for q in questions if area in q['areas'][1:]]
        levels = Counter(q['difficulty'] for q in primary)
        rows.append({
            'area': area, 'primary': len(primary), 'shared': len(shared),
            'listed': len(primary) + len(shared),
            'primary_levels': {level: levels[level] for level in LEVELS if levels[level]},
            'primary_role_tracks': dict(sorted(Counter(q.get('role_track', 'unspecified') for q in primary).items())),
            'practitioner_reviewed': sum(q.get('review_status') == 'reviewed' and
                                        bool(q.get('provenance', {}).get('reviewer')) and
                                        bool(q.get('provenance', {}).get('reviewed_at')) for q in primary),
            'accessible_specialist': bool(levels['entry'] or levels['junior']),
            'advanced_specialist': any(levels[level] for level in LEVELS[3:]),
        })
    return {
        'scenario_count': len(questions), 'area_count': len(rows),
        'review_status': dict(sorted(Counter(q.get('review_status', 'preview') for q in questions).items())),
        'authored_levels': {level: sum(q['difficulty'] == level for q in questions) for level in LEVELS},
        'areas': rows,
        'interpretation': 'Primary means the first authored area, not exclusive relevance. Shared entries retain their own primary specialist. Review status does not imply calibration. Saved attempts retain their original snapshots.',
    }


def review_packet(question):
    """Provide an unfilled author/reviewer worksheet; never invent judgments."""
    return {
        'notice': 'Private author/reviewer material. Contains reference facts and rubric anchors; do not serve to a live candidate. This is a worksheet, not a completed review.',
        'scenario_id': question['id'], 'revision': question.get('revision', 1),
        'question': question,
        'practitioner_review': {
            'reviewer': None, 'reviewed_at': None, 'relevant_experience': None,
            'scope': None, 'findings': [], 'disposition': 'pending',
            'checks': {key: None for key in (
                'task_realism', 'level_and_role_fit', 'fact_consistency',
                'timing_and_accessibility', 'valid_alternatives',
                'rubric_observability', 'conditional_fact_fairness',
                'domain_boundaries', 'provenance')},
        },
        'calibration': {
            'status': 'not_run', 'provider_and_model': None,
            'held_out_response_ids': [], 'independent_reviewers': [],
            'dimension_ratings_and_evidence': [], 'disagreements': [],
            'failure_cases': [], 'decision_and_limits': None,
        },
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=ROOT)
    parser.add_argument('--json', action='store_true', help='Emit public coverage metadata only.')
    parser.add_argument('--review-packet', metavar='SCENARIO_ID', help='Emit a PRIVATE, unfilled reviewer worksheet including reference material.')
    args = parser.parse_args()
    questions = [json.loads(path.read_text()) for path in sorted((args.root / 'api/data/corpus').glob('*.json'))]
    if args.review_packet:
        matches = [q for q in questions if q['id'] == args.review_packet]
        if not matches:
            parser.error('scenario ID not found; no packet generated')
        print(json.dumps(review_packet(matches[0]), indent=2, ensure_ascii=False))
        return
    schema = json.loads((args.root / 'api/data/schemas/scenario-v1.schema.json').read_text())
    result = audit(questions, schema['properties']['areas']['items']['enum'])
    if args.json:
        print(json.dumps(result, indent=2, ensure_ascii=False))
        return
    print(f"{result['scenario_count']} scenarios across {result['area_count']} areas")
    print('Area | Primary specialist | Shared matches | Authored primary levels | Practitioner reviewed')
    for row in result['areas']:
        levels = ', '.join(f'{level}:{count}' for level, count in row['primary_levels'].items())
        print(f"{row['area']} | {row['primary']} | {row['shared']} | {levels} | {row['practitioner_reviewed']}")
    print(result['interpretation'])


if __name__ == '__main__':
    main()
