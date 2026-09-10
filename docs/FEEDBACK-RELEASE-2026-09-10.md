# Required interview feedback — release validation

This update adds the `post-interview-v1` product check-in and private metrics.
It is live at [mockinterview.live](https://mockinterview.live). The paired
API/website rollout was verified at `2026-09-10T16:20:56.728822Z` after automated,
staging browser/API, backup-restore and deletion checks passed.
The earlier [policy release](RELEASE-VALIDATION-2026-09-10.md) remains a separate
record; this update does not certify interview accuracy or legal compliance.

## Deployed artifacts

| Field | Verified value |
| --- | --- |
| API and web build source | `13a7619ffa9583e8cfe1bfe88bf68c1284ddd759` |
| Protected implementation PR | [#22](https://github.com/tejovardhan-makineni/mockinterview/pull/22), squash commit `adf2a8d1f5cda3d0e1308b589f594f3f367b9330` |
| Cloud Build | `a26db7c2-9964-482a-aa55-7a81bdd9a5cb` |
| API image digest | `sha256:7c005eb8d5c900aafe2233b9ad98646c6bf1d05836ac2e2dc7dba3105cfdc114` |
| Staging API | `mockinterview-api-staging-00010-jup` — 100% traffic |
| Production API | `mockinterview-api-00044-sib` — 100% traffic |
| Staging Firebase preview | `launch-candidate`, version `282e8910af606b94` |
| Production Firebase preview and live | `launch-production`, version `4fde692b40426e74` |
| Firebase live release | `1789057224552000` |
| Firebase promotion time | `2026-09-10T16:20:24.552Z` |

The exact immutable image was tested in staging and reused in production without
rebuilding. The production-target web preview was cloned to live; the staging
preview targets a different API and was never promoted to production. Both web
builds used isolated `git archive` exports of the recorded source. The web does
not embed a Git SHA; provenance is bound to that build process and the verified
Firebase version. The squash commit has the identical source tree. All six
required CI/security checks and the CodeQL findings gate passed on the build
source before normal protected-branch merge; no bypass was used.

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

Staging on source `4a4299c8ae542de640e28762073da36640be7baa` also verified the
required form for a synthetic failed interview with no report. Chromium saved
five unable-to-judge answers and an explicit report-unavailable answer with
transcript permission unchecked. HTTP checks at `2026-09-10T16:05:20Z` confirmed
persistence, idempotent retries, separate unrated distributions, private
suggestions, account export and unlocking the next unused reservation. That
reservation was deleted without activation. No provider or mail call was made;
the failed-attempt fixture used a staging-only SQL start/status marker.

Two release findings were addressed before production promotion:

- A caller umask of `077` made archived corpus directories unreadable by the
  non-root container. The first staging revision `00007-moq` failed startup and
  was never promoted. Rebuilding with readable source permissions succeeded;
  the deployment script now normalizes only archive extraction to `022`.
  A direct test under caller umask `077` verified public directories `0755`,
  files `0644`, and the private outer directory still `0700`. Six deployment
  tests and shell syntax validation passed.
- Existing history queries omitted timezone information, displaying a UTC
  timestamp as the viewer's local wall-clock time. Both database and memory
  history paths now return RFC3339 UTC timestamps. PostgreSQL tests using a
  non-UTC database connection and input offset verify the exact instant and
  fractional precision; the store/memory race suites passed.

The final source `13a7619` passed the same-image staging rollout check at
`2026-09-10T16:17:35Z`: the saved response survived, identical retries remained
idempotent, level/unrated metrics and export stayed correct, and history returned
the exact UTC instant. Chromium confirmed the local display changed from the
incorrect `4:00:25 PM` to `9:00:25 AM` in America/Los_Angeles. This final build
also succeeded with caller umask `077` using the hardened archive extraction.

All three disposable staging accounts were deleted through the account API at
`2026-09-10T16:18:11Z`. Responses and sessions cascaded, the metrics returned an
empty cohort with a null completion rate, suggestions were empty and the deleted
tokens returned `401`. Staging was left with zero users, sessions, responses and
scoring jobs; the pre-existing short-lived eligibility ledger was preserved.
The two local accounts were likewise deleted and their tokens rejected. Owned
local test services and PostgreSQL were stopped and removed; revoked fixture
credential files were deleted. The private production backup is preserved.

Final public checks confirmed the expected API revision at 100%, image/source,
`/health`, `/ready`, current policies, feedback, history, report, admin
and account web routes, security headers, exact CORS allowlist and rejection of an
untrusted origin. Unauthenticated feedback/admin requests returned `401`.
License notices and the replacement font hash matched. Registration without
policy declarations returned `403` without creating an account or sending mail.
The production retention worker completed at `2026-09-10T16:18:22Z`.
No production test account, provider request or email was created for this update.

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

Production aggregate checks after promotion still showed 15 users, 38 sessions,
27 reports and 821 transcript turns, with zero pending jobs or active sessions.
Migration 0010 is applied. All 38 existing sessions retain the empty version;
there are zero production survey responses and zero legacy obligations at this
verification snapshot. This is preservation evidence, not user-research data.

## Rollout and limits

Use the [release runbook](RELEASE-RUNBOOK.md) for committed-source candidate
builds, isolated staging checks, the paired API/web promotion and rollback.
Terms/privacy version `2026-09-10.1` explains required product feedback. Publish
the matching API and notice/form build together; preserve the additive migration
on rollback so saved responses survive. The prior paired rollback target is API
`mockinterview-api-00041-cic` and Firebase version `b8a9451c163cb83d`. A binary
rollback disables the new check-in flow; coordinate both artifacts and preserve
the additive database schema. Unpromoted intermediate candidates are not the
rollback target.

The existing maintainer account remains unverified with the `user` role. It
must complete email verification and then receive an authorized UUID-based
administrator grant before using the private dashboard. No verification or role
bypass was applied; public practice does not depend on that owner action.

Required product feedback is not research consent or permission to publish a
quotation. These self-report items are unvalidated, and mandatory completion can
bias results. No learning-gain, grading-accuracy or job-readiness claim follows
from these metrics. The [legal assessment](LEGAL-READINESS-2026-09-10.md)'s owner,
audience, lawful-basis, rights, provider/transfer, retention and content-provenance
decisions remain open.
