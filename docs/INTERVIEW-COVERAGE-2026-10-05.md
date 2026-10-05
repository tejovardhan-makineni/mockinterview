# Interview coverage expansion — implementation record

Date: October 5, 2026. Source implementation; **not a production deployment record**.

## Delivered

The source catalog now contains **262 scenarios, 41 career areas, seven families
and 38 practice paths**. This adds **77 scenarios and 15 paths** to the audited
185-scenario/23-path catalog:

- 18 management scenarios in seven paths: First-Time Manager, Experienced People
  Manager, Engineering Manager, Senior Manager, Director Leadership, Vice
  President and Executive Leadership.
- 24 scenarios and eight paths for Pharmacy, Dentistry, Allied Health & Therapy,
  Veterinary, Architecture, Manufacturing & Industrial Quality, Aviation
  Operations, and Agriculture & Food Production. Each has entry, mid and senior
  individual-contributor work.
- 33 scenarios deepen existing areas: 21 senior, 11 junior and one mid-level QA
  exercise. Every specialist profession outside the management/foundations areas
  now has at least three primary scenarios, including accessible entry/junior
  practice and an advanced senior/staff/principal scenario.
- Two principal IC exercises cover cross-team technical migration and experiment
  measurement governance. These distinguish technical influence from authority
  over other teams' staffing or product decisions.

All 262 are **preview**. No practitioner review or scoring calibration was
performed or implied. Independent AI-assisted content review corrected effort
units, conditional-fact ambiguity, fictional security authority and consent
wording; that is author QA, not professional validation.

Role track is independent of level. Scenarios and session settings support
individual contributor, management and executive scope; seniority supports entry,
junior, mid, senior, staff, principal, manager, senior manager, director, VP and
executive. Track-specific UI choices preserve authored pack defaults and saved
settings. Custom planning receives the selected role before generating stages
and a rubric. Adapting a template retains its authored task/rubric and is labeled
accordingly. A staff or principal engineer is not assumed to manage people.

Catalog cards and the role filter use explicit authored scope. Missing legacy
scope stays unspecified. The profession panel separates primary and shared
counts. A scenario discovered under a secondary profession retains its original
specialist and task. The MBA goals interview is now primarily Career Foundations,
with no inferred IC role. Shared career exercises remain available to new areas.

Frozen scenario loading was repaired to decode into a fresh object. Older
snapshots no longer inherit new optional metadata from today's catalog, and
reports retain the original saved title. Existing scenario/pack metadata edits
increment revisions. There is no database migration or change to saved records.

The bundled demo exports the complete public catalog and all 38 paths. Round
resolution honors pinned scenarios, otherwise matches domain, workspace,
profession and compatible role scope, preferring the authored level. Missing
or incompatible paths fail explicitly instead of selecting unrelated work.

## Coverage

Counts below are authored primary entries versus additional shared matches.
The same scenario can be useful in multiple areas; shared matches are not
additional specialist scenarios. This remains a finite practice bank, not all
possible occupations, disciplines, sub-specialties or role/level combinations.

| Area | Primary | Shared | Authored primary levels |
| --- | ---: | ---: | --- |
| accounting | 3 | 23 | entry, mid, senior |
| agriculture | 3 | 23 | entry, mid, senior |
| allied_health | 3 | 23 | entry, mid, senior |
| architecture | 3 | 23 | entry, mid, senior |
| aviation | 3 | 23 | entry, mid, senior |
| business_operations | 3 | 23 | entry, senior, manager |
| career_foundations | 24 | 0 | entry, junior, mid, senior |
| civil_engineering | 5 | 24 | junior, mid, senior |
| consulting | 5 | 25 | junior, mid, senior |
| creative_communications | 3 | 23 | entry, mid, senior |
| customer_support | 3 | 23 | entry, mid, senior |
| cybersecurity | 3 | 23 | entry, mid, senior |
| data_science | 8 | 55 | junior, mid, senior, principal |
| dentistry | 3 | 23 | entry, mid, senior |
| education | 3 | 23 | entry, mid, senior |
| electrical_engineering | 5 | 24 | junior, mid, senior |
| engineering_management | 3 | 23 | manager |
| finance | 5 | 24 | junior, mid, senior |
| human_resources | 4 | 23 | junior, mid, senior |
| it_support | 3 | 23 | entry, mid, senior |
| law | 9 | 24 | junior, mid, senior |
| management | 15 | 26 | manager, senior_manager, director, vp, executive |
| manufacturing | 3 | 23 | entry, mid, senior |
| marketing | 3 | 23 | junior, mid, senior |
| mechanical_engineering | 4 | 24 | junior, mid, senior |
| medicine | 10 | 24 | entry, mid, senior |
| nursing | 5 | 24 | entry, mid, senior |
| pharmacy | 3 | 23 | entry, mid, senior |
| product_management | 5 | 25 | junior, mid, senior |
| project_management | 3 | 23 | entry, senior, manager |
| public_service | 3 | 23 | entry, senior, manager |
| quality_assurance | 3 | 23 | junior, mid, senior |
| research | 3 | 23 | entry, mid, senior |
| retail_hospitality | 3 | 23 | entry, senior, manager |
| sales | 3 | 24 | junior, mid, senior |
| skilled_trades | 3 | 23 | entry, mid, senior |
| social_work | 3 | 23 | entry, mid, senior |
| software_engineering | 76 | 28 | junior, mid, senior, staff, principal |
| supply_chain | 3 | 23 | entry, mid, senior |
| ux_design | 4 | 23 | junior, mid, senior |
| veterinary | 3 | 23 | entry, mid, senior |

Reproduce this table with `make content-audit` or
`python3 scripts/content_coverage.py --json`. The private reviewer packet command
and separate human review/calibration steps are in [CONTENT-REVIEW.md](CONTENT-REVIEW.md).
All new scenarios have conditional facts, concrete rubric anchors, alternative
solutions, correction probes, learning drills and context/example fixtures.
The fixtures are author-created examples rather than observed model performance.

## Verification

- All 262 scenarios load and validate; source schemas and format references are
  checked separately. Pack resolution checks cover all 38 paths.
- Full Go tests with the race detector, Go vet and API build passed.
- All 236 web tests, TypeScript, ESLint and production static export passed with
  Node 22. All 125 v1 scenarios passed JSON Schema validation.
- Python scaffold, progression, coverage-audit and deployment fixtures passed.
- A local deterministic-provider management interview completed through public
  HTTP/WebSocket contracts: authored role/level persistence, answer deduplication,
  workspace save, silent reconnect without extending the deadline, report,
  idempotent finish, private export and synthetic-account cleanup.
- Browser inspection confirmed the 262-scenario catalog, primary/shared counts,
  separate management/director filters, all 38 paths, director setup defaults
  and the senior pharmacy round's authored IC/senior scope and duration.

No paid-provider conversation, human microphone session, clinician assessment,
human scoring calibration or production deployment was performed in this pass.
A deterministic smoke checks application wiring, not AI response quality. The
standard repository CI, security, desktop and release gates remain applicable.
Deploy matching API and web artifacts together; an old API rejects the new
role/level fields. Verify production identity and catalog counts after promotion.
