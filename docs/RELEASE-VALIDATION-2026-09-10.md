# Policy and privacy release validation — 2026-09-10

**The policy, privacy-control and third-party-notice update is deployed.**
Production API revision `mockinterview-api-00041-cic` serves 100% of traffic.
Firebase version `b8a9451c163cb83d` was cloned from the tested production preview
and verified live. This document records the delta after the public-beta launch.
The [previous release record](RELEASE-VALIDATION-2026-09-09.md) separately records
the successful production interview acceptance and its limitations. Passing
these checks does not establish legal compliance or error-free interviews.

## Artifact and rollout record

| Field                                       | Confirmed value                                                                                                        |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| API build source                            | `58280bab2d55c1047c7e388ba72c1ddefe51befe`                                                                             |
| API image digest                            | `sha256:d38fdc7583f67602994bc93f4541f731be1810d168bf50dceef3f1b6220af48e`                                              |
| Cloud Build                                 | `31e8d60b-39fc-489f-b579-d925c97cca93` — SUCCESS; finished `2026-09-10T08:52:03.285463Z`                               |
| Staging API revision                        | `mockinterview-api-staging-00005-cor`                                                                                  |
| Staging web source/version                  | `b6f5756b97fef2dc3aae15d57650d9e5b9c98111` / `11cdb49cee568add`                                                        |
| Production API revision                     | `mockinterview-api-00041-cic` — 100% traffic                                                                           |
| Production web source                       | `061b56bc6b26ab33baf092a9679f123a60b92764`                                                                             |
| Production Firebase version                 | `b8a9451c163cb83d` — exact tested production preview cloned live                                                       |
| Firebase hosting release                    | `1789031721533000`                                                                                                     |
| Firebase promotion time (UTC)               | `2026-09-10T09:15:21.533Z`                                                                                             |
| Final production verification time (UTC)    | `2026-09-10T09:17:02.886581Z`                                                                                          |
| Production migration/aggregate verification | Migration 0009 present; 15 accounts / 38 sessions / 27 reports / 821 transcript turns preserved                        |
| Previous release rollback references        | API `mockinterview-api-00039-qam`; Firebase version `c8dee48c3e3cb3b9` — assess lost policy safeguards before rollback |

The `api/` tree is identical across `58280bab`, `b6f5756` and `061b56b`
(`a931f506a42fed2bae439d848f0787178baf5246`). The `web/` tree is identical between
the staged and production web sources
(`43a16f42036b1ad1f481cc67c6c69efb72e599e9`), as is `firebase.json`. Thus the
reviewed web changes and API code match despite different build source SHAs.
A later documentation commit is not the image's build source. Follow the
[release runbook](RELEASE-RUNBOOK.md) for recovery.

Both API candidates returned 200 on `/health`, `/ready` and
`/api/v1/legal-policy`. Readiness reported the exact API source, Gemini and
`llm_stub: false`; this is configuration/readiness evidence, not a paid model
request. The policy response reported minimum age 18, hosted enforcement and
terms/privacy versions `2026-09-10`. Runtime configuration, secret references
and mail configuration were preserved; an absent unused SMTP setting and an
empty one were treated equivalently in the comparison.

## Code, tests and staged controls

The API source passed all six required checks in
[CI](https://github.com/tejovardhan-makineni/mockinterview/actions/runs/34457010240)
and [Security](https://github.com/tejovardhan-makineni/mockinterview/actions/runs/34457010288).
The final notices/font commit also passed all six required checks and the
CodeQL gate in
[CI](https://github.com/tejovardhan-makineni/mockinterview/actions/runs/34459153437)
and [Security](https://github.com/tejovardhan-makineni/mockinterview/actions/runs/34459153400),
with zero open alerts at that checkpoint.
[PR #20](https://github.com/tejovardhan-makineni/mockinterview/pull/20) merged as
`061b56bc6b26ab33baf092a9679f123a60b92764`. Local validation passed the full Go
race suite with isolated PostgreSQL and corpus/content/deployment checks. The
fresh final web build passed 61 web tests, five standalone notices/font tests,
lint and a static production build generating 21 pages.

| Control                        | Evidence and boundary                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Adult/current policy assertion | Registration rejects missing, false and stale declarations before creating a hosted account. Existing users can authenticate and explicitly acknowledge current versions. PostgreSQL tests cover atomic persistence, preservation of the original adult timestamp, changed-version acceptance and export. An assertion is not independent age verification.                 |
| Hosted AI admission            | Route tests cover paid actions, WebSocket tickets and direct live entry; unacknowledged accounts cannot call providers. Forged session configuration cannot create trusted declaration markers. Local mode retains its existing setup path.                                                                                                                                 |
| Continued account rights       | History, export, recovery and deletion remain available without accepting new terms or passing paid-feature eligibility. Owner-scoped resume deletion removes uploads and standalone reviews, including detached reviews, while preserving interview history. Tests cover owner isolation and idempotence.                                                                  |
| Voice and personal Gemini keys | New hosted voice attempts require the processing acknowledgment. Gemini personal-key validation, new attempts and replacement require an explicit paid-project declaration. Replacement does not retain a separate declaration timestamp; eligibility is not independently verified. Existing voice reconnects retain their compatibility path after account policy review. |
| Queued feedback                | Worker tests reject unacknowledged legacy jobs before a provider request, while honoring prior valid policy acknowledgments for already queued work after a document-version change. Existing report retrieval remains available.                                                                                                                                           |
| Retired behavioral ingestion   | The legacy endpoint returns 410 before reading the submitted body or storing gaze/expression-shaped samples. This release adds no camera analysis, voice identification or sensitive-trait scoring.                                                                                                                                                                         |

On the isolated staging revision, a controlled synthetic legacy account received
`403 policies_required` from resume upload/review/match, provider validation and
session creation. Authentication, export and history returned 200; resume
deletion returned 204 before acknowledgment. False/stale acknowledgment was
rejected. Current acknowledgment and exported policy metadata passed. Missing
Gemini billing declaration and missing voice notice acknowledgment each returned
400 before session reservation. No session or provider request was created.
Normal account deletion succeeded, the old authentication token returned 401,
and staging returned to zero users. Only synthetic fixture data was used.

The hosted Gemini key's parent project had active billing according to a
read-only provider metadata check, with zero paid requests. That observation
does not verify a user's BYOK project, accept provider contracts or prove every
provider processing/retention condition.

## Backup and migration rehearsal

A fresh application-only custom PostgreSQL backup was taken at
`2026-09-10T08:48:16Z`. Its archive listing verified 18 table-data entries;
the 150,007-byte archive's SHA-256 was
`25f2af2a6362fbc379a6a92ce986812c8691c1b28a2453bee9e1c976896452b7`.
The restricted archive remains outside Git. No shared-instance restore was
performed.

The exact fresh backup was restored into a separate local database and migration
0009 was applied with development/stub configuration. Aggregate checks preserved
15 accounts, 38 sessions, 27 reports and 821 transcript turns. All 15 existing
accounts remained unacknowledged; no adulthood or policy acceptance was
backfilled. The baseline had zero pending/running scoring jobs and zero active
sessions. The disposable restored database was removed after verification, and
the rehearsal made no provider requests or transcript-content exports.

Migration 0009 is additive and leaves the previous binary's columns intact.
Rolling back the old binary would still remove the new enforcement and break
new policy endpoints/registration fields. Coordinate API and web rollback and
assess the lost safeguards; schema compatibility is not policy equivalence.

## Production verification

At the recorded final check, the stable API served the new revision at 100%
traffic and reported the expected real-provider source/configuration on health
and readiness. The hosted policy endpoint reported the current versions and
minimum age. Migration 0009 was present. Aggregate counts remained 15 accounts,
38 sessions, 27 reports and 821 transcript turns, with zero pending/running jobs,
zero active sessions, no unexpected fixture account and zero policy
acknowledgments. All 15 prior accounts must make their own declarations; no
acceptance was fabricated. A `retention_completed` event from the new revision
was observed at `2026-09-10T08:56:01.587130123Z`; this confirms that observed run,
not every future cleanup or external backup/provider deletion.

Five approved production/Firebase/preview origins received their matching CORS
allow-origin header; an untrusted origin received none. Public routes, security
headers, the license notice and replacement-font bytes were checked. The served
notice SHA-256 was
`7788310b24af45b48e314db6c292a18d680442ece5116a1457116d67632a964f`;
the served font matched the independently tested hash below. Firebase metadata
confirmed that the tested production preview was cloned unchanged to the live
version recorded above.

## Browser and redistributed-asset evidence

Local browser checks verified deliberate signup choices and synthetic resume
deletion, including clearing the displayed resume/review state. The actual
hosted staging preview then verified that a legacy account could view history
before agreement; both declarations started unchecked and one alone could not
submit. Acceptance saved the server versions/timestamps and preserved Senior
difficulty and a 15-minute setup choice through policy review. Voice disclosure
started unchecked with interview start disabled; the text alternative needed no
microphone permission. The personal Gemini billing declaration was unchecked,
the unsupported Meta option was absent and the footer license link worked.
The synthetic staging account was deleted normally, its token was revoked, and
staging returned to zero users and sessions. These checks sent no mail or model
requests.

After promotion, Chrome on the actual `mockinterview.live` signup page showed
both declarations unchecked and Create account disabled. No account was created.
The separate production HTTP test rejected registration without declarations
with 403, without mail or provider calls. No individual production records or
actual interview content are part of this document.

The notice generator preserves actual installed production-dependency license
texts, compiled sidecars and editor/font attributions. Version-pinned upstream
supplements retain source URLs and SHA-256 provenance. Tests cover deterministic
output, missing-text reporting, changed supplement hashes, incomplete installs
and complete React, Monaco and Excalidraw license texts. The generated file is
served at `/third-party-notices.txt` and regenerated by the existing vendor-asset
hook. The inventory is deliberately broader than the browser bundle: the
remaining native libvips full-text warning concerns a build/server library that
Firebase static hosting does not distribute. It is not a general clearance for
redistributing native dependencies.

The served legacy Liberation font was replaced with official OFL Liberation Sans
2.1.5 while retaining Excalidraw family 9 and the existing URL. The original TTF,
complete license, reproducible Node converter and hash manifest are retained in
`web/licenses/liberation-sans-2.1.5/`. The final 169,648-byte WOFF2 SHA-256 is
`8735a5218d55ca4a6b6131c3a5fef598b5d68f291de6bcd5a294fb022d86fd04`.
An independent decoder verified all 19 original SFNT tables byte-for-byte, and
repeated conversions matched. A separate temporary HeadlessChrome 152 profile
successfully loaded the exact font with `FontFace`, rendered canvas text and
decoded/rendered an SVG containing the embedded font. The fixture and browser
were closed afterward. Tests verify the copied hash/legacy path and reject
corruption or an unreviewed Excalidraw upgrade.

This font is not pixel-identical to the old version. All 95 printable ASCII
advances and vertical metrics match; two non-ASCII advances differ and four
previous codepoints use fallback. Outlines, hinting and kerning may differ.
Detailed evidence and limitations are in the source manifest; no full browser
matrix or accessibility certification is claimed.

## Prior acceptance and unresolved owner work

The catalog remains 143 scenarios; one teamwork prompt now explicitly describes
adult graduate students. This delta does not change the director prompts,
scoring rubric/evidence validation or native provider transport. Its changes
add eligibility and privacy controls around those paths. The previous release's
real production text acceptance and bounded native close/reconnect/report
evidence remain in the [previous acceptance record](RELEASE-VALIDATION-2026-09-09.md).
No additional paid interview was run for this policy update. That evidence is
not a fresh all-mode test of these final deployed artifacts. Human microphone
VAD, long sessions, production load, broad browser/device coverage and independent
scoring calibration remain outside the established checks.

The [legal assessment](LEGAL-READINESS-2026-09-10.md) and
[privacy operations](PRIVACY-OPERATIONS.md) retain owner decisions that code
cannot supply: actual operator identity/location and intended audience; lawful
bases and sensitive-data handling; applicable regional representation and
assessment requirements; provider contracts/transfers and generated-audio
marking; operational retention, rights and incident procedures; older corpus
rights, branding and participant-based accessibility review. No regulator
registration, contract acceptance, trademark clearance or universal legal
certification is implied by this release.

The tested software update is live; the unresolved owner/legal work above
remains open. Credentials, account identifiers, action links, individual records
and detailed private evidence remain outside Git.
