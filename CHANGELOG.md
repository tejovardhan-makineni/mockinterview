# Changelog

Source changes are recorded separately from verified deployments. Dates on older
release records describe the deployments verified by those records, not a claim
that the current source has been deployed.

## 2026-10-05 — Profession depth and management practice

- Expand source content from 185 to 262 scenarios and from 23 to 38 paths.
  Add pharmacy, dentistry, allied health, veterinary, architecture, manufacturing,
  aviation operations and agriculture, plus people and engineering management.
- Add first-time manager, experienced manager, engineering manager, senior manager,
  director, VP and executive paths, with principal-level IC exercises and deeper
  entry/junior and senior coverage across existing professions.
- Separate role track from seniority in discovery, setup, custom planning,
  saved settings and reports. Distinguish primary specialist content from shared
  matches instead of treating every catalog match as specialist depth.
- Preserve frozen legacy scenario metadata rather than inheriting newly added
  fields from current catalog entries. Saved report titles use their snapshot.
- Add a coverage audit, private reviewer worksheets, context examples and a
  practitioner review/calibration protocol. All scenarios remain preview.

Implementation and checks are recorded in
[the coverage record](docs/INTERVIEW-COVERAGE-2026-10-05.md); deployment is separate.

## 2026-10-04 — Open source practice and community

### Project and community

- Introduce an open source project homepage, documentation, get-started guide,
  maintainer page, contribution paths and public release notes.
- Publish GitHub, Reddit and Discord community links. Invite real community
  stories; do not publish invented testimonials or private feedback.
- Change project code and original project scenarios to the MIT license; preserve
  third-party licenses, attribution and historical release records.
- Add a single cross-platform Docker-free local launcher. Default storage is
  explicitly temporary; persistent PostgreSQL and Docker are documented options.

### Practice and feedback

- Set standard funded access to one interview every rolling 24 hours, with Gemini
  2.5 Flash as the configured text/feedback default. Provider availability applies.
- Permit unlimited personal-key starts after provider/model validation, subject
  to provider charges and limits and one active attempt at a time.
- Add free-text custom profession, goal, level, questions and interview structure.
- Add beta applications with a feedback commitment and administrator approval.
- Add private template requests and owner administration.
- Add explicit optional analytics sharing for local web practice when an
  authenticated remote API is configured. Failed optional uploads do not block
  practice. This is not automatic backup or cross-device history sync.

The web app and API are released together after staged validation. Local setup
uses the source launcher; signed desktop installers are not included.

## 2026-09-14 — Interview bank expansion

185 scenarios, seven career families and 23 practice paths, with specialist
interviewer context. [Verified release record](docs/INTERVIEW-BANK-RELEASE-2026-09-14.md).

## 2026-09-13 — Microphone readiness and testers

Device readiness improvements and tester entitlements.
[Verified release record](docs/MICROPHONE-TESTERS-RELEASE-2026-09-13.md).

## 2026-09-10 — Privacy and policy controls

Adult access acknowledgment, policy versions, voice processing notice and data
controls. [Verified release record](docs/RELEASE-VALIDATION-2026-09-10.md).
