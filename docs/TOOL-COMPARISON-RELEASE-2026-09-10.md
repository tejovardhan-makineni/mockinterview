# Optional interview-tool comparison — release validation

Status: **deployed and verified** on 10 September 2026 at 16:52 UTC. This
extends the prior [six-question release](FEEDBACK-RELEASE-2026-09-10.md).

This additive extension asks about other tools tried, a balanced experience
comparison and optional free text. The six required questions, interview gate,
quotas and existing research/transcript permissions are unchanged. The section
can be skipped or cleared. It is versioned as `tool-comparison-v1`, separately
from `post-interview-v1`. See the [questionnaire](BETA-FEEDBACK-QUESTIONNAIRE.md)
and [metric definitions](FEEDBACK-METRICS.md).

Migration 0011 adds a nullable comparison field. Older binary writes must preserve
it, older client omission must preserve it and explicit null must clear it.
There is no retroactive response or inferred prior-tool experience. The existing
application backup and all prior private history backups must be retained.

## Backup and migration rehearsal

A fresh application-only production backup was created at
`2026-09-10T16:36:12Z`: 154,777 bytes, SHA-256
`797b7e9b6302dd77181634dc311eb9a4e0b8f02317ecaf7e908a1795edb0ac69`.
All 19 table-data archive entries were readable. The actual archive was restored
to a new isolated local PostgreSQL database and migration `0011_tool_comparison.sql`
applied successfully. The rehearsal database was removed afterward. Counts
remained 15 users, 38 sessions, 27 reports, 821 transcript turns and zero feedback
responses, active sessions or pending jobs. No comparison was manufactured.
The restricted backup remains outside Git; no shared Cloud SQL restore occurred.

## Validation completed

All 94 web tests, full lint, TypeScript and static export passed. The full API
race suite passed against isolated PostgreSQL, together with `go vet ./...`.
The final migration hash matches the successful backup restore rehearsal.
Protected PR [#24](https://github.com/tejovardhan-makineni/mockinterview/pull/24)
passed CI, dependency and secret checks and both CodeQL language scans. Its
squash commit `8811591b52d49c0c75fe5090e3f10ac8dfa38cf0` has the identical source
tree to the tested build commit below.

The isolated staging API and Chrome preview checks verified:

- Six initially unanswered required questions and an optional section without defaults.
- Typed tool names and details, conditional clearing on No, saved summary after reload,
  independent rating clearing, full-section clearing and cancel restoring saved data.
- Identical retries preserving timestamps, older-client omission preserving saved
  comparison, explicit null clearing it and first-submission time staying stable.
- Separate pending, omitted, No and Yes denominators; an empty rated denominator
  returns null. Comparison-only suggestions appear without a general comment.
- Owner export includes the comparison; unauthorized owner/admin access is rejected.
  Aggregate JSON and the separate CSV exclude tool names and details.
- Account deletion removes saved comparison/session data and rejects deleted tokens.
  All four disposable staging accounts, three sessions and three responses were
  removed. No scoring jobs, model requests or email sends were created by these checks.

## Published artifacts

| Artifact | Verified value |
|---|---|
| API and web build source | `7446dc6280bfe56ecf9f27c257b110c1359e970e` |
| Cloud Build | `f15d144d-5437-487b-a15e-91490d3f4467` |
| Immutable image | `sha256:8456cbb4e16592b82d605da4d7affb0c936a9855c8f7bfe79ba42c9061290647` |
| Tested staging API | `mockinterview-api-staging-00012-xar` |
| Tested staging web | `02b1df5072b02b3d` |
| Production API | `mockinterview-api-00046-riq` — 100% traffic |
| Production Firebase version | `2a28ff1f89e667da` |
| Firebase live release | `1789059111801000` |
| Web promotion (UTC) | `2026-09-10T16:51:51.801Z` |
| Final public verification (UTC) | `2026-09-10T16:52:34.462960Z` |

Production reuses the tested staging image without rebuilding. The paired
`launch-production` web preview targets the stable production API and was cloned
to live without rebuilding; `launch-candidate` targets the isolated staging API.
The client has no guaranteed embedded Git marker: provenance is the exact-source
archive build plus verified preview/live version and downloaded-byte identity.
Documentation-only commits do not change these build-source identifiers.

Public checks passed for readiness and source identity, non-stub configuration,
unchanged terms/privacy `2026-09-10.1`, CORS, unauthenticated private-route rejection,
public routes and security headers, notices and the replacement font hash.
Runtime settings and pinned secret references match the prior configuration.
A scoped read-only aggregate query confirmed migration 0011, its JSONB check
constraint/index and all application counts unchanged from backup. The 38 legacy
interviews remain exempt and no feedback or comparison records were manufactured.
The new revision logged retention completion at `2026-09-10T16:48:46.197913179Z`.
No production account, model call or email was created for this release check.

## Rollback and limits

The prior paired target is API `mockinterview-api-00044-sib` with Firebase
`4fde692b40426e74`. Reverting both removes the optional comparison UI/metrics
while retaining the required six-question check-in. Keep additive migration 0011
and saved responses; do not restore the shared SQL instance for a binary rollback.
Older writes preserve comparison data. Rehearsal and history backups remain
private outside Git, along with sanitized validation evidence.

This verifies the comparison feature and deployment; it does not establish
interview/scoring calibration or general legal clearance. Owner verification and
an authorized administrator grant are still needed for owner dashboard access.
See [operations](OPERATIONS.md) and the [legal assessment](LEGAL-READINESS-2026-09-10.md)
for the remaining beta and owner decisions.
