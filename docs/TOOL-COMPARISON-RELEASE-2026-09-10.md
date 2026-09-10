# Optional interview-tool comparison — release validation

Status: implementation and verification in progress. Production still serves
the prior [six-question release](FEEDBACK-RELEASE-2026-09-10.md).

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

Before promotion, record strict validation, draft/save/reload/edit behavior,
old-client compatibility, idempotency, clearing, export/deletion, private
suggestions and aggregate denominators. Validate the additive migration on a
fresh isolated backup restore, then stage the exact committed image and paired
web preview. Record final artifact identifiers, cleanup and production evidence
below before describing this extension as deployed.

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

## Implementation checks

All 94 web tests, full lint, TypeScript and the static export passed. Focused
real-PostgreSQL race suites cover storage, in-memory parity and HTTP feedback
validation; every API package compiles. The final migration hash matches the
successful isolated restore rehearsal. Deployment and browser verification are
pending and will be recorded after promotion.
