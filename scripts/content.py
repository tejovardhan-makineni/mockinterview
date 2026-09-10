#!/usr/bin/env python3
"""Scaffold original scenario/format drafts without touching the live catalog."""
import argparse
import json
import re
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parents[1]

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('kind', choices=['new-scenario', 'new-format'])
    parser.add_argument('--id', required=True)
    parser.add_argument('--output', type=Path, default=ROOT / 'scratch/content')
    args = parser.parse_args()
    if not re.fullmatch(r'[a-z0-9]+(-[a-z0-9]+)*', args.id):
        parser.error('id must be kebab-case')
    collection = 'corpus' if args.kind == 'new-scenario' else 'formats'
    template = 'work-sample-reservation-review' if collection == 'corpus' else 'work-sample-defense'
    data = json.loads((ROOT / 'api/data' / collection / (template + '.json')).read_text())
    data['id'] = args.id
    data['revision'] = 1
    data['title' if collection == 'corpus' else 'name'] = args.id.replace('-', ' ').title()
    destination = args.output / collection / (args.id + '.json')
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        parser.error(f'{destination} already exists; no file overwritten')
    if collection == 'corpus':
        data['review_status'] = 'preview'
        data['provenance']['authorship'] = 'Draft copied from the original project example; edit the scenario and attribution before contributing.'
        format_dir = args.output / 'formats'
        format_dir.mkdir(parents=True, exist_ok=True)
        source = ROOT / 'api/data/formats' / (data['format_id'] + '.json')
        target = format_dir / source.name
        if not target.exists():
            shutil.copyfile(source, target)
    destination.write_text(json.dumps(data, indent=2) + '\n')
    print(destination)
    print('Draft only. Edit the scenario, facts, rubric, fixtures and provenance before opening a pull request.')

if __name__ == '__main__':
    main()
