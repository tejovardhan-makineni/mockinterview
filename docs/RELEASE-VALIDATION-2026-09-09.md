# Implementation validation — 2026-09-09

**Status at this checkpoint:** the improved application is implemented and has
been tested locally. The cleaned source repository is now public and an
unauthenticated mirror clone was verified. Production still serves the previous
release. Production mail configuration and delivery verification are pending.
This document records completed checks; it is not a claim that deployment or
every launch gate is complete. Follow
  [the release runbook](RELEASE-RUNBOOK.md) for the remaining release procedure.

The earlier [audit](AUDIT-2026-09-09.md),
[improvement plan](IMPROVEMENT-PLAN.md),
[deployment assessment](DEPLOYMENT-UPDATE-PLAN.md) and
[launch assessment](LAUNCH-READINESS.md) describe the pre-implementation state.
Their 137-scenario baseline is historical; the implemented catalog has **143
scenarios**, including six new original preview scenarios and five reusable
format definitions.

## Local checks completed

- The final Go race suite passed with real PostgreSQL. Frontend checks cover 55
  tests, lint and TypeScript; static export produces all 20 pages. JavaScript
  dependency audits found no vulnerabilities. `govulncheck` found no reachable
  vulnerabilities or affected imported packages; one advisory remains in an
  unused dependency-module package.
- Public HTTP/WebSocket smoke passed against the final local API, including
  verification, readiness, acknowledged deduplication, silent reconnect, fixed
  deadlines, exact workspace persistence, durable scoring, repeated finish,
  private-field exclusion in exports and rating-only feedback.
- Browser checks covered catalog/setup/sign-in, text without media permissions,
  final notes in the report, optional feedback, and a 390-pixel report layout
  without horizontal overflow. A static build restored an actual Excalidraw scene
  after reload. Monaco and its assets loaded without console errors; native
  editor typing was not supported by the automation bridge, so the accessible
  plain-text coding path was used to verify saved code and finish.
- Static browser checks applied the Firebase security headers, with only the
  local HTTP/WebSocket API origins added to `connect-src` for the test. Actual
  Firebase preview origins and production CSP still need deployment verification.
- GitHub workflow syntax passed Actionlint. Release-file and original full-history
  Gitleaks scans found no secrets. Later publication and history-cleanup results
  are recorded separately when complete.
- Corpus validation loads all 143 scenarios. It checks the versioned format
  contract, required metadata, conditional facts/probes, rubric bounds and
  compatibility. Context fixtures confirm private authored material reaches the
  director without entering public summaries.
- Focused Go tests and race tests passed for auth, configuration, corpus,
  director/live, packs and scoring. The API handler suite also passed. Coverage
  includes token revocation races, single-use recovery actions, password-change
  invalidation, evidence citations, canonical rubric weights, missing evidence,
  complete transcript handling, short-station timing and pack variation.
- A clean-directory `npm ci` completed successfully. It emitted existing React
  peer-dependency warnings in Excalidraw's older transitive Radix packages; those
  warnings are not proof of a runtime defect or of compatibility.
- Scaffolder tests, deployment-helper tests, shell syntax, Python syntax and
  `git diff --check` passed. Deployment tests use simulated HTTP responses and
  confirm staging isolation, explicit-only password rotation, paginated monitoring
  reconciliation and changed notification routing. They do not deploy resources.
- Docker Compose configuration validates. A full local container startup was
  not completed in this check because the Docker daemon was stopped. The API and
  real-provider tests instead used an existing local PostgreSQL service.

CI now provisions PostgreSQL and runs Go race tests, deterministic corpus and
deployment-tool fixtures, web lint/tests and a real-API static export. Real paid
provider checks are deliberately separate from CI. A workflow definition is not
evidence of a successful GitHub run; inspect the actual run for the release commit.

## Source publication

The release source was committed as `d610c7195aa4cff416b4e8206da35df5e384d1db`
after removing seven legacy avatar binary paths from all published Git history.
The release tree itself was unchanged by filtering. A complete private Git
bundle was verified before filtering; the production application database also
has a separate private backup.

GitHub retained an old pull-request reference in the existing private repository.
To avoid making that reference public, the original repository was retained as a
private archive and an independent repository with the cleaned history was
published at the original URL. An unauthenticated mirror clone contained none of
the seven binaries across its advertised branches and tags. No private Codex
capture references were published.

Private vulnerability reporting, Dependabot security updates, secret scanning and
push protection are enabled. The repository includes contribution and format
templates, conduct/support guidance, dependency updates and CI/security workflows.
GitHub-hosted checks and branch protection must be verified against their actual
results before declaring the source release gate complete.

## Restored production-backup rehearsal

The release operator restored a fresh production backup into an isolated local
database and applied the final migrations. The reported retained counts were:

| Record | Count |
|---|---:|
| Users | 15 |
| Sessions | 38 |
| Reports | 27 |
| Transcript turns | 821 |
| Complete sessions | 27 |
| Expired legacy unfinished sessions | 11 |
| Chronological transcript inversions | 0 |

This was an isolated restore rehearsal. Production data was not migrated by this
test, and no shared Cloud SQL instance was restored or replaced. The rehearsal
provides evidence for migration compatibility with the current backup, not a
guarantee for every historical dataset or future migration.

## Actual Gemini checks

The provider checks ran during the evening of September 9, Pacific time
(September 10 UTC), using a disposable local PostgreSQL schema for each run,
synthetic accounts, fictional scenarios and typed answers. The Gemini secret was
read into process memory; no key, authentication token, microphone recording or
camera recording was saved. Received audio was counted in memory. Each test
account/schema and API process was removed after the run.

Reasoning/scoring used `gemini-2.5-flash`; native audio used
`gemini-2.5-flash-native-audio-preview-12-2025`. The bounded checks used about nine
successful generation/connection requests and two rejected diagnostic requests,
with provider runs totaling less than five minutes. These are request counts,
not a measured currency cost or token-cost estimate.

**Text interview passed after a discovered startup fix.** The initial request
had no content turns, which Gemini rejected. The director now sends an explicit
format-specific kickoff and has a regression test. In the successful AI-output
critique interview, the model identified itself as AI, supplied the authored
non-randomization and missing-revenue facts, and asked a relevant channel-mix
follow-up. The saved real report cited the candidate's late correction from a
percentage-point error to a two-point/20%-relative change. All six rubric
dimensions were returned with supported citations. The synthetic result was
3.17/4; this is an example outcome, not a calibration result.

**Native audio interview passed after recovery fixes.** The first run exposed
missing `saved` acknowledgment on a native close, unsolicited reconnect speech
and ordering around typed interruption. The native transport now drains final
transcript writes before acknowledgment, restores a pending interviewer turn
silently and sends typed replies through realtime input. The final incident
scenario check observed audio and output transcription, a typed interruption
signal, zero unsolicited audio packets during the reconnect check, an unchanged
deadline, and the final acknowledged answer saved exactly once. The real report
persisted with supported quotations, including the late correction, and a
synthetic result of 3.0/4.

The interruption check did leave a short in-flight interviewer transcript
fragment after the typed answer. It did not lose the answer or block the report,
but partial speech around interruption still deserves monitoring. The checks did
not exercise actual microphone input, voice activity detection with human speech,
camera permissions, long sessions, every browser, every provider or provider
outages under production load. The model's ratings and coverage estimates still
need practitioner review and independent calibration.

## Reproduce the controlled provider check

The opt-in scripts are `scripts/run-gemini-smoke.py` and
`scripts/smoke-gemini.mjs`. The runner requires a local
`mockinterview_launch_test` database reachable through `/tmp`, owned by the local
role, plus Go, Node 22 and `psql`. It builds the API, creates a random isolated
schema, runs the test on port 8083 and removes the schema and process afterward.

Provide `GEMINI_API_KEY` through your process environment, or explicitly select
your own Secret Manager project using `--project YOUR_PROJECT --secret YOUR_SECRET`.
The latter requires `gcloud`. Running the scripts makes billable provider calls.
`SMOKE_ONLY=voice` skips the text case when retesting a native-only change. These
scripts reject remote API targets and must not be repurposed for real user data.

## Release work still required at this checkpoint

Configure and verify production mail, deploy and test the exact committed
candidate, confirm preview CORS and browser flows, verify alert delivery, promote
the tested API/web versions and check the public application. Complete the
authorized history cleanup and secret review, then publish and verify an anonymous
clone and private vulnerability reporting. Update this checkpoint after those
actions actually succeed. Content remains a community preview while practitioner
review and scoring calibration are pending.
