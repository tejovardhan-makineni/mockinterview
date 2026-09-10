# Required interview feedback — release validation

This update adds the `post-interview-v1` product check-in and private metrics.
Local implementation, automated validation, browser checks and a backup restore
have passed. Staging and production deployment are pending at this commit.
The earlier [policy release](RELEASE-VALIDATION-2026-09-10.md) remains a separate
record; this update does not certify interview accuracy or legal compliance.

## Behavior

New started attempts require six answers after they finish, including unsuccessful
or unscored attempts, before the next interview can start. Each item accepts
“Unable to judge”; the report item also accepts unread/unavailable responses.
Reports, existing-session access, recovery, export and deletion remain available.
No old attempt or unused reservation acquires a retroactive requirement.
Comments and transcript inspection permission are optional and initially unset.
The subject wording covers the current 143 scenarios across 35 domains.

Responses are owner-scoped, editable and idempotent, with one row per session.
They are included in account export and cascade on session/account deletion.
The administrative dashboard shows full-window aggregate counts, distributions,
rated/unrated denominators and separate paginated optional suggestions. It checks
the current stored role; the release does not grant any real account access.
See the [questionnaire](BETA-FEEDBACK-QUESTIONNAIRE.md) and
[metric definitions](FEEDBACK-METRICS.md).

## Automated and browser validation

- The complete Go race suite passed against isolated PostgreSQL 16.14. Focused
  coverage includes 205 eligible attempts (103 responses), concurrent admission
  and response writes, ownership, strict validation, Unicode comment limits,
  frozen subject metadata, export/deletion, pagination and current-role access.
- Admission reads active and pending status in one database snapshot. Started
  active/interrupted/ending attempts remain blocking across their deadline until
  the worker advances them. Activation rechecks outstanding feedback; started
  reconnects remain available. Regression tests cover these timing boundaries.
- All 74 web tests, lint, TypeScript and static export passed. The final account
  disclosure and CSV cohort-metadata refinement passed 14 focused tests, targeted
  lint and TypeScript afterward. Five dependency/asset notice tests passed.
- Chromium exercised local PostgreSQL with the actual API and deterministic LLM
  stub: six unchecked options, coding and behavioral subject wording, report and
  history access before submission, all-unrated answers, failed-save preservation
  and retry, persistence after reload, next-interview access and a complete text
  start/answer/finish flow. A pending setup gate blocked another attempt, and
  returning from the standalone form preserved Senior and 15-minute choices.
- The ordinary account was denied the admin view; a disposable administrator
  showed two responses, correct missing-rating treatment and the optional
  suggestion. HTTP checks confirmed unchanged timestamps on identical retries,
  first-submission time on edits, no duplicate response count, `target_level`
  grouping, account export and administrator-only endpoints.

The local browser/API check was recorded at `2026-09-10T15:49:56Z`. It used two
disposable accounts and fictional data. One initial coding fixture used a local
SQL start marker; the behavioral interview traversed the normal browser/relay
start path. No paid provider or email-delivery request was made. This is bounded
feedback-flow validation, not a new cross-browser or all-scenario calibration.

## Database protection

Migration `0010_interview_feedback.sql` adds a default-empty session version and
the dedicated response table, ownership/deletion constraints and indexes. The
default preserves the legacy exemption.

A fresh application-only production backup was created at
`2026-09-10T15:37:53Z`: 150,322 bytes, SHA-256
`899b89033fb50f319bf12e9328fcca47310cbc37aa023617635fc8c4bb49e609`.
Its 18 table-data archive entries were verified. The actual archive was restored
to a new isolated local database, migration 0010 was applied, and counts remained
15 users, 38 sessions, 27 reports and 821 transcript turns, with zero active
sessions/pending jobs. All 38 old sessions retained an empty feedback version;
no feedback response or legacy obligation was manufactured. The restored test
database was removed. The restricted backup is retained outside Git; no shared
Cloud SQL instance restore was performed.

## Rollout and limits

Use the [release runbook](RELEASE-RUNBOOK.md) for committed-source candidate
builds, isolated staging checks, the paired API/web promotion and rollback.
Terms/privacy version `2026-09-10.1` explains required product feedback. Publish
the matching API and notice/form build together; preserve the additive migration
on rollback so saved responses survive.

Required product feedback is not research consent or permission to publish a
quotation. These self-report items are unvalidated, and mandatory completion can
bias results. No learning-gain, grading-accuracy or job-readiness claim follows
from these metrics. The [legal assessment](LEGAL-READINESS-2026-09-10.md)'s owner,
audience, lawful-basis, rights, provider/transfer, retention and content-provenance
decisions remain open.
