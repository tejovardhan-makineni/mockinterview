# Release validation checkpoint — 2026-09-10

**The public beta is deployed.** Final API revision `mockinterview-api-00039-qam`
serves 100% of production traffic, and Firebase version `c8dee48c3e3cb3b9` is live.
Public health/readiness, route, asset, security-header, CORS and catalog checks
passed. Production interview acceptance also **passed**, including signup,
verification, a real AI text interview, exact saved evidence/report, history,
feedback, export and quota enforcement. Test-account cleanup also passed, with
production data counts restored and quota records retained. Public-beta
limitations remain listed below.

| Deployed release field | Value |
|---|---|
| API build source | `fd60df42be9c8f3c804f77239d30762bb4c68402` |
| Web build source | `45432972e5c7163e7eadf0f9cbb95306504dd6d9` |
| Production API revision | `mockinterview-api-00039-qam` — 100% traffic |
| API image digest | `sha256:1a0846ac334e8b31b8c9a8e0a503dd17465f05aad90d5b0ae20a2ee3e433c906` |
| Cloud Build | `325e19de-9aff-47ec-a319-f123f4b3d392` |
| Firebase version | `c8dee48c3e3cb3b9` |
| Firebase hosting release | `1789027056695000` |
| Firebase promotion time (UTC) | `2026-09-10T07:57:36.695Z` |
| Production interview acceptance | **PASSED** |

The native-close and password-reset confirmation fixes merged in PR #16 as
`79bdfcd`; PR #17 merged as `4543297` and adds private, allowlisted scoring diagnostics,
prevents invalid-assessment automatic retries and removes hosted administrator
quota exemptions. PR #18 merged as `fd60df4`, adding verification/rate guards to
paid resume parsing, verification before scoring legacy unfinished attempts and
private resume-error diagnostics. The earlier preview identifiers below are
checkpoint evidence; the actual promoted release is identified above.

The `web/` and `firebase.json` trees compare identically between `4543297` and
`fd60df4`. The tested `4543297` web export can therefore be reused alongside the
new API. The final operations/documentation commit must be distinguished from
the actual API and web build SHAs: operational helper and document changes do
not mean the runtime was rebuilt from that later commit.

Follow the [release runbook](RELEASE-RUNBOOK.md) for promotion and rollback. This
record is not a guarantee that there are no bugs or that every public-beta
validation task is complete.

The earlier [audit](AUDIT-2026-09-09.md),
[improvement plan](IMPROVEMENT-PLAN.md),
[deployment assessment](DEPLOYMENT-UPDATE-PLAN.md) and
[launch assessment](LAUNCH-READINESS.md) describe the pre-implementation state.
Their 137-scenario baseline is historical. The implemented catalog has **143
scenarios**, including six new original preview scenarios and five reusable
format definitions. Content remains a community preview pending practitioner
review and independent scoring calibration.

## Source publication and enforced checks

The initial cleaned release source was committed as
`d610c7195aa4cff416b4e8206da35df5e384d1db` after removing seven legacy avatar binary
paths from all published Git history. Filtering did not change that release's
working tree. A complete private Git bundle was verified first.

Because GitHub retained an old pull-request reference in the existing private
repository, that repository was kept as a private full-history archive. An
independent repository with cleaned history was made public at
[the original project URL](https://github.com/tejovardhan-makineni/mockinterview).
An unauthenticated mirror clone contained none of the seven binaries across its
advertised branches and tags. No private Codex capture references were published.

Private vulnerability reporting, Dependabot security updates, secret scanning
and push protection are enabled. The source includes contribution instructions,
format and issue templates, local setup guidance, conduct/support contacts and
CI/security workflows. At this checkpoint, GitHub reports zero open CodeQL
alerts and zero open Dependabot alerts. These are point-in-time results, not
assurances about future advisories.

The active [main ruleset
22734659](https://github.com/tejovardhan-makineni/mockinterview/rules/22734659)
requires pull requests, resolved review threads, linear history and these six
successful checks: API (Go), Web (Next.js), Dependency audit, Secret scan,
CodeQL (go), and CodeQL (javascript-typescript). Its separate CodeQL gate rejects
security alerts and analysis errors/warnings. The checks must be current with
the base branch; force pushes and deletion are blocked. No bypass actors are
configured. The ruleset does not require an approving human review, so it should
not be described as independent human review enforcement.

Actual Ubuntu-hosted runs passed for candidate `2152328`:
[CI](https://github.com/tejovardhan-makineni/mockinterview/actions/runs/34444534458)
and [Security](https://github.com/tejovardhan-makineni/mockinterview/actions/runs/34444534390).
[PR #16](https://github.com/tejovardhan-makineni/mockinterview/pull/16), containing
the graceful voice-close and password-reset confirmation fixes, passed all six
checks and the CodeQL gate before merging at 07:08:26 UTC. The merge commit
`79bdfcd` also has successful
[CI](https://github.com/tejovardhan-makineni/mockinterview/actions/runs/34448487375)
and [Security](https://github.com/tejovardhan-makineni/mockinterview/actions/runs/34448487381)
runs. The Web job reports **57 tests across 11 files** passing, with lint and
the production static build successful. These links identify tested source;
they do not identify a production deployment.

[PR #17](https://github.com/tejovardhan-makineni/mockinterview/pull/17) passed all
six required checks and CodeQL before merging at 07:40:31 UTC as
`45432972e5c7163e7eadf0f9cbb95306504dd6d9`:
[CI](https://github.com/tejovardhan-makineni/mockinterview/actions/runs/34450958710)
and [Security](https://github.com/tejovardhan-makineni/mockinterview/actions/runs/34450958741).
Final source builds and production promotion are recorded separately; these
passing pull-request checks do not claim that deployment occurred.

[PR #18](https://github.com/tejovardhan-makineni/mockinterview/pull/18) passed all
six required checks and CodeQL before merging at 07:49:23 UTC as
`fd60df42be9c8f3c804f77239d30762bb4c68402`:
[CI](https://github.com/tejovardhan-makineni/mockinterview/actions/runs/34451670146)
and [Security](https://github.com/tejovardhan-makineni/mockinterview/actions/runs/34451670037).
Its post-merge
[CI](https://github.com/tejovardhan-makineni/mockinterview/actions/runs/34451907018)
and [Security](https://github.com/tejovardhan-makineni/mockinterview/actions/runs/34451907116)
also passed. The corresponding API and equivalent tested web artifact were then
promoted as recorded above.

## Local implementation checks

- Go race tests passed with real PostgreSQL, including auth, lifecycle,
  persistence, live transport, corpus and scoring checks. Coverage includes
  token revocation races, single-use recovery actions, password-change
  invalidation, acknowledged deduplication, fixed deadlines, repeated finish,
  durable scoring, canonical rubric weights, complete transcripts and evidence
  citations. The API handler suite also passed.
- The final paid-route checks confirm that an unverified hosted resume upload
  makes no model call and saves no resume, verified uploads use the shared
  30-request/hour bucket, and an unverified legacy unfinished attempt cannot
  queue scoring. Verification still permits the saved attempt to finish, and
  history remains readable. Resume parse/review/match failures log only fixed
  category/route fields and return generic errors; private marker tests cover
  both logs and responses. Local verification bypass remains intact.
- Health routing exposes `/health` and `/ready`, retaining the original `z`
  aliases. Liveness remains available during dependency failure; readiness
  returns 503 on database failure. Deployment probes and monitoring use the new
  paths. The no-traffic candidate and final production service both passed these
  endpoints; `/ready` identifies source `fd60df4` with a non-stub provider.
- Node 22.23.2/npm 10.9.8 regenerated the portable lockfile after actual Ubuntu
  CI exposed missing optional dependency entries. A fresh directory passed
  `npm ci`, unit tests, lint and production export. Actual Ubuntu CI subsequently
  passed. Static export produces all 20 pages. Existing React peer warnings from
  Excalidraw's older transitive Radix dependencies are not evidence of a runtime
  defect or a promise of compatibility.
- JavaScript dependency audits report no vulnerabilities. `govulncheck` found
  no reachable vulnerabilities or affected imported packages in the recorded
  local run; an advisory reported only for an unused dependency-module package
  was distinguished from reachable application code. Current dependency and
  CodeQL gates pass as linked above.
- Corpus validation loads all 143 scenarios and checks the versioned format
  contract, required metadata, conditional facts/probes, rubric bounds and
  compatibility. Context fixtures confirm private authored information reaches
  the director without appearing in public summaries. Fixtures cover
  short-station timing and pack variation.
- Actionlint, release-file and original full-history Gitleaks scans,
  scaffolder/deployment-helper tests, shell/Python syntax and diff checks passed.
  Deployment tests use simulated HTTP responses to check staging isolation,
  explicit password rotation, paginated monitoring reconciliation and changed
  notification routing; those tests do not themselves deploy resources.
- Docker Compose configuration validates. A full local container startup was
  not completed because the local Docker daemon was stopped. Real database and
  provider checks used the existing local PostgreSQL service instead.

## Browser and isolated hosted staging checks

Browser checks covered catalog, setup, sign-in, device/text selection, interview
history, final notes in the report and optional feedback. A report at a
390-pixel viewport had no horizontal document overflow. The static build
restored an actual Excalidraw scene after reload. Monaco and its local assets
loaded without console errors. A later native-editor test entered **136
characters of code using actual coordinate-based browser input**; the code
persisted exactly and reached scoring. The accessible plain-text alternative
was also checked. This supersedes the earlier checkpoint's Monaco-input
automation limitation.

Local static browser checks applied the Firebase security headers with only
the local API origins added for that test. The operator subsequently exercised
the actual Firebase preview and isolated staging API. The exact `79bdfcd` previews passed asset, export and security-header checks.
The promoted public routes, assets and security headers were subsequently
checked against the deployed artifacts as recorded below.

The hosted staging attempt used synthetic answers and actual Gemini. It
produced native audio and transcription and acknowledged typed interruption.
Its first native-close probe failed with “WebSocket closed before expected
event”; this is not recorded as a fully passing voice smoke test. Separate
post-disconnect checks confirmed that the persisted attempt produced a real
report with six dimensions and seven validated citations, retained its
workspace and acknowledged candidate turn, accepted repeated finish, and
rejected a second start with HTTP 429. The operator also checked history,
report/evidence presentation and both interviewer/product feedback controls
through the browser.

PR #16 sends the final save result followed by a WebSocket close frame and a
bounded closing handshake. An in-process synthetic provider regression test
confirmed transcript drain, `saved`, normal close code 1000, provider cleanup
and resumability. Focused native concurrency/race checks passed three repeated
runs during review. A later hosted native check with a synthetic Yahoo account
confirmed **normal close code 1000 and a silent reconnect**.

That hosted check did not pass every harness step: the second reply hit the
private harness's 20-second wait while the response was still streaming. The
first scoring job also failed for an **unknown original cause**. One ordinary
manual retry succeeded, leaving two job attempts and one report. The report had
11 supported citations, including five to the final correction. These outcomes
confirm recovery and saved evidence; they do not establish a completely passing
voice run or explain the first scoring failure.

The subsequent patch records only five fixed failure categories:
`provider_request`, `assessment_invalid`, `evidence_limit`, `timeout` and
`operation`. Logs include job attempt and session identifier for restricted
operator investigation; raw provider errors, output, private evidence and keys
are excluded from the logged/stored diagnostic. Strict citation, dimension and
numeric validation remains in place. Invalid assessments and evidence-size
failures cannot acquire automatic paid retries by including transient-looking
text such as `503` or `timeout`. Provider-transient retries remain bounded.
Hosted administrators now follow the same allowance in Create and Usage as
other hosted accounts; local unlimited practice is preserved. The regression
checks do not retroactively diagnose the earlier Yahoo scoring failure.

## Account mail and private support

The operator verified `mockinterview.live` as a Resend sender domain, with mail
authentication and TLS confirmed. Real hosted account registration and email
verification succeeded. Actual recovery mail from the project's own sender
arrived in the test Gmail Inbox. A Yahoo verification message reached Spam and
was moved manually during the staging test. A later production verification
message reached Inbox in the same mailbox after that manual spam correction.
Neither observation guarantees inbox placement for other users. The recovery test confirmed that the prior JWT returned 401, the old password
returned 401 and the new password authenticated with HTTP 200.

The recovery flow exposed a success-page bug: removing query parameters made a
completed reset appear to be email verification. PR #16 preserves the completed
action independently of the reactive query. Both reset and verify success
tests pass. The final promoted page must retain this behavior in the release
verification.

The first generic own-domain test message went to Gmail Spam despite correct
mail authentication and TLS. The actual reset message went to Inbox. These
observations demonstrate delivery for the tested mailbox, not reliable inbox
placement for every mailbox or provider. Mail reputation and delivery failures
need ongoing observation.

Resend uses its structured recipient field. The optional SMTP fallback delivers
to one parsed envelope recipient and uses the RFC 5322 empty group
`To: Mockinterview candidate:;` rather than reflecting user input in message
headers. Protocol tests cover that behavior; SMTP clients can display the group
instead of the account address. The hosted Resend checks do not constitute
a real-provider SMTP delivery test.

Help, support and conduct guidance provide the confirmed maintainer's private
email contact, including signed-out account access, privacy and conduct
requests, with a build-time support-address override for installations. The
public project has one maintainer, no independent conduct-reporting contact and
no guaranteed response time. In-product feedback remains an additional private
channel for signed-in users. No email was sent merely to publish the contact.

The existing production owner account remains unverified with the `user` role.
The owner must confirm the intended administrative account and complete email
verification before an authorized operator grants admin access for feedback
triage. Email verification alone does not grant that role. No admin role,
verification bypass or quota reset was applied during launch. This remaining
owner action does not block public beta availability; history, export and account
recovery remain accessible.

## Backups, migration rehearsal and database role hardening

The earlier isolated restore rehearsal restored a production backup into a
local database and applied the candidate migrations. It retained:

| Record | Count |
|---|---:|
| Users | 15 |
| Sessions | 38 |
| Reports | 27 |
| Transcript turns | 821 |
| Complete sessions | 27 |
| Expired legacy unfinished sessions after migration | 11 |
| Chronological transcript inversions | 0 |

That rehearsal did not restore or replace the shared Cloud SQL instance. It
provides migration-compatibility evidence for that backup, not a guarantee for
all historical data or future migrations.

A fresh pre-migration production backup was created at **2026-09-10 07:04:44
UTC**, with the following verified metadata:

- Custom-format archive, 230,830 bytes; archive listing valid with 68 entries
  and 14 table-data entries.
- SHA256: `0f578a7eb99400f5c49e825e0f571c1a3292a90886307a59e09e44750ee7be01`.
- Read-only counts: 15 users, 38 sessions, 27 reports and 821 turns. Eleven
  legacy open statuses had no activity in the preceding 24 hours; the newest
  recorded activity was August 6.
- Dump, verification metadata and table-of-contents records are private with
  mode 0600. **This fresh backup was not restored in a new rehearsal.**

The guarded app-role hardening was applied after its rollback rehearsal.
`CREATEROLE`, `CREATEDB` and `cloudsqlsuperuser` membership were removed while
preserving credentials and application-object ownership. A new connection
verified reads, writes, identity sequences and schema DDL in a rolled-back
disposable-table transaction. The previous production API remained healthy on
its ping and database-backed authentication check. The
[role-hardening record](DATABASE-ROLE-HARDENING.md) explains the remaining DDL
permissions and why these changes do not establish absolute isolation from
other applications' `PUBLIC` grants. A no-traffic `79bdfcd` production candidate
subsequently applied migration versions 6 through 8 and passed `/ready` and
`/health`. Counts remained 15 users,
38 sessions, 27 reports and 821 turns. The old revision retained 100% of public
traffic, and live Firebase remained unchanged. Applying these additive
migrations is distinct from promoting the new application.

## Production promotion and public checks

Cloud Build `325e19de-9aff-47ec-a319-f123f4b3d392` successfully built API source
`fd60df4` into the immutable image recorded above. Staging revision
`mockinterview-api-staging-00004-4kl` passed health/readiness. Production
`mockinterview-api-00039-qam` passed as a no-traffic candidate and was then promoted
to 100% traffic. The web export from `4543297`, staging version `49d3661208e89f45`,
was promoted from the reviewed preview as live Firebase version
`c8dee48c3e3cb3b9`, release `1789027056695000`, at 07:57:36.695 UTC. Exact
comparison confirmed `web/` and `firebase.json` unchanged in API source
`fd60df4`; no web rebuild was needed.

The public smoke checked **17 HTML routes and eight JavaScript chunks**,
including their security headers. All four public host aliases served the new
landing page. The catalog exposed 143 safe preview summaries, and production
`/ready` identified `fd60df4` with the non-stub provider. Production CORS allowed
these five exact origins and omitted access-control approval for an untrusted
origin:

- `https://mockinterview.live` — primary website
- `https://www.mockinterview.live`
- `https://mockinterview-web.web.app`
- `https://mockinterview-web.firebaseapp.com`
- `https://mockinterview-web--launch-production-dnxl08u1.web.app`

Before the production acceptance interview, read-only database counts remained
15 users, 38 sessions, 27 reports and 821 turns, with zero scoring jobs. New
revision logs for **07:57:00–07:59:59 UTC** contained zero errors, HTTP 5xx or
scoring failures. This is a short observation window, not a load or long-term
reliability result. Production interview acceptance and completed test-account
cleanup results follow.

### Production interview acceptance — passed

The operator used Chrome on the `www` hostname to register a controlled test
account that had not existed in production. Its own-domain verification mail
arrived in the test Yahoo Inbox, following the earlier manual spam correction
in that mailbox. The verification action on the canonical apex succeeded and
removed the action token from the URL. Six paid routes returned 403 before
verification without making paid calls.

The operator selected text mode and an eight-minute limit, then finished after
about two minutes through the browser UI with four synthetic candidate answers.
The actual model revealed authored conditional facts in response to specific
questions and probed customer recovery. This was a short controlled text check,
not a human microphone or full-duration interview study.

- Scoring completed on the first job attempt: **one job, one attempt and one
  report**, with six rubric dimensions and 14 exact supported citations, two
  referencing the final answer. No scoring failure or retry occurred in this
  production acceptance attempt.
- All nine transcript turns and four unique candidate answers matched the
  immutable scoring input. The final answer had 574 characters. The final note
  had 240 characters and workspace revision 2; it also matched the frozen input.
- Repeated finish returned 200. A new start returned 429. The 24-hour and
  seven-day eligibility times matched the recorded start
  `2026-09-10T08:01:11.442764Z`: September 11 and September 17 at the same UTC
  time, respectively.
- History showed the completed attempt with its Review action. The operator
  submitted separate interviewer and product feedback through the UI; both
  rows were persisted with optional diagnostics and transcript sharing off.
  The account export excluded private credential/internal fields.
- Pre-existing data remained unchanged at 15 users, 38 sessions, 27 reports and
  821 turns. The controlled test alone temporarily raised totals to 16 users,
  39 sessions, 28 reports and 830 turns. The verified cleanup below restored the
  original counts.

### Test-account cleanup — passed

Both controlled staging accounts were deleted through the account API with HTTP
204; their former JWTs returned 401. Checks across 16 private-data tables found
no remaining test-account data. Exactly two staging quota records and their
original timestamps remained.

The production test account deletion returned 204 and its former JWT returned
401. Its user, session, report, scoring job, nine transcript turns, six score rows,
two workspace records and two feedback rows were absent afterward. Production
returned to **15 users, 38 sessions, 27 reports and 821 turns**, with zero pending
scoring jobs. The minimal test quota record retained its original
`2026-09-10T08:01:11.442764Z` start time, so deletion did not reset eligibility.
Pre-existing user data was preserved.

Seven temporary test-authentication credential files were removed after the
cleanup proof. Private backups and the operational evidence were
preserved. Only the explicitly controlled test accounts were deleted; the
existing owner account was preserved.

### Earlier staging and migration checkpoints

The earlier `79bdfcd` checkpoint produced a successful Cloud Build
`fc856faf-736d-493d-af63-ddab0df7f367` and image
`sha256:eeb48ed5fc41eb9463b9b11149c823fd1c4205a70354a7930919a95ab1013329`.
The staging API revision was `mockinterview-api-staging-00003-mcp`; staging web
version `728e2d1b85227118` and production-target preview `3b707ba598f5bb91` were
built from that exact source using Node 22.23.2. Both previews passed static
export, asset and security-header checks.

No-traffic production revision `mockinterview-api-00038-not` used the same
source/image, five pinned secret versions, the app runtime service account,
minimum one instance and background CPU. It passed health and readiness.
Previous revision `mockinterview-api-00037-zsd` remained at 100% traffic. These
are historical checkpoint artifacts. They were superseded by the final
`fd60df4` release recorded above.

## Monitoring delivery

The operator's temporary policy test generated three regional monitoring
messages that reached the owner's Inbox around **07:02 UTC**. The temporary
policy was then deleted, and a subsequent lookup returned 404. The real
application policies remain active. This confirms the tested notification
route reached the owner; it does not simulate every outage condition or prove
future delivery. After promotion, actual reconciliation updated the existing
API uptime check to `/ready` and web check to `/`. Both use a 300-second period,
10-second timeout, USA regions and valid TLS, with the enabled owner notification
channel. All three policies are enabled, including the unchanged production-only
scoring-failure threshold.

Reconciliation exposed a helper update bug: an immutable monitored-resource
field was included in the PATCH. The operational helper now omits that field;
six deployment-helper regression tests passed and actual reconciliation then
succeeded. This change does not alter the deployed API or web artifacts.

The log metric `logging.googleapis.com/user/mockinterview_scoring_failures` and
its alert are also installed. Labels are restricted to fixed category and service
name. The alert sums production `mockinterview-api` failures over 900 seconds,
excludes staging and triggers above two events: three or more failed attempts in
15 minutes. It routes to the tested owner channel. No artificial scoring failure
or paid provider request was generated to trigger it. **The new scoring signal
has not yet been production-trigger tested**; delivery of uptime notifications
verifies the route only. [Operations](OPERATIONS.md#scoring-failures) records the
manual metric/policy setup and how to reproduce it on another host.

## Actual local Gemini checks and their limits

Earlier controlled provider checks ran on September 9 Pacific time (September
10 UTC), using disposable local PostgreSQL schemas, synthetic accounts,
fictional scenarios and typed answers. Provider keys were held in process
memory; no key, authentication token, microphone recording or camera recording
was saved in the test evidence. Received audio was counted in memory. Each
test account/schema and API process was removed afterward.

Reasoning/scoring used `gemini-2.5-flash`; native audio used
`gemini-2.5-flash-native-audio-preview-12-2025`. Those earlier local checks made
about nine successful generation/connection requests and two rejected
diagnostic requests, with provider runs totaling under five minutes. These are
counts for that earlier bounded run only, not totals for subsequent hosted
checks or a measured currency cost.

The initial text kickoff had no content turns and was rejected by Gemini. The
fixed director sends an explicit format-specific kickoff, covered by a
regression test. In the successful AI-output critique interview, the model
identified itself as AI, supplied authored non-randomization and missing-revenue
facts and asked a relevant channel-mix follow-up. The report cited the
candidate's correction from a percentage-point error to a two-point/20%-relative
change. All six rubric dimensions returned supported citations. The synthetic
3.17/4 result is an example, not a calibration result.

Earlier local native checks observed audio/output transcription, typed
interruption, zero unsolicited audio packets during the reconnect check, an
unchanged deadline and the final acknowledged answer saved once. A real report
persisted with supported quotations and a synthetic 3.0/4 result. A short
in-flight interviewer transcript fragment remained after the typed answer. It
did not lose the answer or block the report, but partial speech around
interruption still needs observation. The later hosted close failure and PR #16
fix are recorded separately above.

No check in this record establishes microphone voice activity detection with
human speech, long-session reliability, camera behavior across devices,
comprehensive browser/provider coverage, outage behavior under production
load, human usability-study results, or independently calibrated scoring.

The opt-in reproduction tools remain `scripts/run-gemini-smoke.py` and
`scripts/smoke-gemini.mjs`. Their runner requires local PostgreSQL, Go, Node 22
and `psql`, creates an isolated schema, runs on port 8083 and removes its schema
and process. Supply `GEMINI_API_KEY` through the process environment, or
explicitly choose your Secret Manager project/secret with `--project` and
`--secret` using `gcloud`. These scripts make billable calls, reject remote API
targets and must not be repurposed for real user data. `SMOKE_ONLY=voice` limits
a run to the native path.

## Remaining acceptance and public-beta limitations

The application is deployed; production interview acceptance and test-account
cleanup passed. The remaining owner action is to confirm and verify the intended
administrative account before its stored role is granted by an authorized
operator. Public beta availability does not depend on that action. Later
operations/documentation commits or tags do not change the separately identified
runtime builds unless new artifacts are built and promoted.

Human microphone/browser coverage, long-session behavior, production load,
independent human usability review, all-143-scenario practitioner review and
scoring calibration, and a full local Compose boot remain outside the completed
validation. These are public-beta limitations, not passed gates. The hosted
streaming timeout and recovered unknown scoring failure remain part of this
record despite the successful deployment.
