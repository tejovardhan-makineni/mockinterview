# Microphone detection and unlimited tester access — release validation

Status: **deployed and verified** on 13 September 2026 at 04:56 UTC.

The device check now accepts a live microphone as ready, with the input meter
separately showing when sound is detected. The speaker test is optional; the
separate voice processing acknowledgment remains required before starting a voice
interview.

A persistent tester registry grants verified matching email addresses unlimited
interview starts and ancillary AI requests, with optional post-interview check-ins.
Authenticated, verified administrators can list, add and remove testers through
`/api/v1/admin/testers`; the operator CLI supports the same actions. Membership
does not grant an administrator role. Email verification, current policies, voice
acknowledgment, authentication throttles and one-active-interview integrity remain
enforced. See [tester access operations](TESTER-ACCESS.md) for API details.

## Backup and migration rehearsal

The actual application-only production backup was created at
`2026-09-13T04:32:28Z`: 156,810 bytes, SHA-256
`df7fd0a588b15fcc8a6d85c6cdb126422f9499f0308efa93c29fc47fc53516b1`.
All 19 table-data archive entries were readable. The archive was restored into an
isolated local PostgreSQL database and migration `0012_testers.sql` applied
successfully. The rehearsal completed at `2026-09-13T04:38:35.394377Z` and preserved
16 users, 38 sessions, 27 reports and 821 transcript turns. The backup baseline had
no active sessions, pending jobs or feedback responses. No tester entries were
created by the migration. The restricted backup remains outside Git; no shared
Cloud SQL instance restore occurred.

## Validation completed

All 110 web tests, lint, TypeScript and static export passed. The full API race
suite passed against isolated PostgreSQL, together with Go vet/build and corpus
validation. Protected PR [#26](https://github.com/tejovardhan-makineni/mockinterview/pull/26)
passed required CI and CodeQL checks. Merge commit
`42565aaa11ccee26b4321363269feb0523ba67f1` has the identical source tree to the build
commit recorded below.

Isolated staging checks exercised authenticated list/add/remove/re-add requests,
email normalization, administrator and verification guards, unlimited access with
existing cooldown and pending-feedback records, and restoration of the standard
limits after removal. Browser verification at `2026-09-13T04:51:06.244939Z` used an
authenticated disposable staging tester with the real staging API and synthetic
Web Audio input. Microphone input was detected, the start button became enabled
after voice acknowledgment, and no speaker-test acknowledgment was needed. Network
responses were not mocked. These checks made no paid provider requests or email
sends; they did not start a production interview or change production history.
All disposable staging users, sessions, jobs and tester entries were removed;
the two pre-existing usage markers were preserved.

## Release artifacts

| Artifact | Recorded value |
|---|---|
| API and web build source | `f76e2435b4df8f61063627411a5426cca4dfaad9` |
| Cloud Build | `5ace0534-8d25-4e28-b189-6be82c63a4f0` |
| Immutable API image | `sha256:08c379933870dcee4e8e7411bdf4bee670c9d58989af74eede9afa6dfad129d4` |
| Tested staging API | `mockinterview-api-staging-00014-wup` |
| Tested staging web | `3f0df8f81a269272` |
| Production API | `mockinterview-api-00048-lad` — 100% traffic |
| Production Firebase version | `0eff85b22b1957a1` |
| Firebase live release | `1789275315170000` |
| Web promotion (UTC) | `2026-09-13T04:55:15.170Z` |
| Final public verification (UTC) | `2026-09-13T04:56:49.483794Z` |

Production reuses the tested staging image without rebuilding; its
readiness reports the expected source and non-stub Gemini configuration. Runtime
configuration was preserved. The exact immutable `launch-production` web version
was promoted through the Firebase Hosting release API, equivalent to
`hosting:clone`, after the CLI promotion encountered an authentication-refresh
timeout. No web rebuild occurred. The production preview targets the stable
production API; `launch-candidate` targets the isolated staging API. Both exports were
built from the recorded committed source. The web does not embed a guaranteed Git
marker. Documentation-only commits do not change these build-source identifiers.

Final public checks passed for readiness, expected API traffic/source, CORS,
unauthenticated `GET`/`POST`/`DELETE` tester-management rejection (`401`), and exact
preview/live HTML and setup JavaScript identity. The served assets contain both
the microphone fix and tester access support. Production counts remain 16 users,
38 sessions, 27 reports and 821 transcript turns, with zero pending jobs and
migration 0012 applied. The two requested tester addresses were added through the
operator CLI: one verified account has active access, and one awaits email
verification and policy acknowledgment. Neither received an administrator role.
No account, interview, paid provider call or email was created for production
verification.

## Rollback and limits

The paired rollback target is API `mockinterview-api-00046-riq` and Firebase web
version `2a28ff1f89e667da`. Reverting both restores the prior microphone flow and
standard hosted quotas/check-in gate for all accounts, including testers. Preserve
additive migration 0012 and the tester registry so a subsequent forward deployment
can restore access. The previous release still supports the optional comparison
and six-question feedback instrument. Do not restore the shared SQL instance for
a routine binary rollback.

Current terms/privacy versions remain `2026-09-10.1`; public copy clarifies the
tester exception without marking existing users verified or policy-accepted.
This release verifies microphone readiness and tester access, and does not repeat
paid end-to-end interview/scoring acceptance. The [initial real interview
acceptance](RELEASE-VALIDATION-2026-09-09.md), [comparison release](TOOL-COMPARISON-RELEASE-2026-09-10.md)
and [legal assessment](LEGAL-READINESS-2026-09-10.md) retain their historical scope.
See [operations](OPERATIONS.md) and the [release runbook](RELEASE-RUNBOOK.md).
