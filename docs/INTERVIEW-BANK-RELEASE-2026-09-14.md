# Interview bank expansion — release validation

Status: **deployed to production September 14, 2026**. The live web version was
promoted at **21:31:17.501 UTC**, and the final public API verification completed
at **21:32:16.919267 UTC**. Final release verification was recorded at
**21:34:00 UTC**. The recorded production API revision receives **100% of traffic**.

This release expands the bank from 143 to **185 scenarios**, from 16 to **31 career
areas**, and from six to **23 practice paths**. Seven career families, searchable
profession aliases, separate topic/format filters, and specialist AI interviewer
profiles make the expanded content easier to find and practice. The additions
include first-job, career-change, return-to-work, recruiter-screen, written-response,
panel, and offer conversations, alongside new profession-specific exercises.
Entry/junior coverage grows from ten to 32 scenarios.

Specialists use the existing shared AI runtime with profession-specific guidance.
New question snapshots retain their specialist profile. The content remains a
community preview awaiting practitioner review and scoring calibration; deployment
does not change its review status. The hosted audience remains adults 18 and older.

## Validation completed

The implementation passed the full Go test suite, vet and API build; all **139 web
tests**, ESLint, TypeScript and production static export; runtime validation of
all **185 scenarios** and **23 paths**; and JSON Schema validation of **48 v1
scenarios** and **nine custom formats**. Desktop/mobile catalog inspection and
profession/path filtering were completed during implementation. Pinned-round
setup and session creation are covered by a web test.

Protected PR [#29](https://github.com/tejovardhan-makineni/mockinterview/pull/29)
passed all six CI/security checks before merge. The source commit and merge
commit below have identical complete Git trees, verified by an empty tree diff
before these release-documentation updates.

The staging candidate, production candidate, and public production API each
passed the **29 public GET checks**: readiness and exact API release identity,
non-stub configuration, all expected scenario/profession/path IDs, seven families,
complete public specialist metadata, and exclusion of private reference answers
and interviewer instructions. Each returned **185 scenarios, 31 career areas,
seven families, and 23 paths**. All **92 path rounds** resolve by matching
domain/modality and cover every advertised profession, including **65 pinned
rounds in the 17 new paths**. The two detail samples returned the Career
Foundations and Cybersecurity specialists, the correct format names, and
community-preview status. Responses allowed the appropriate preview origin;
the public-production run used `https://mockinterview.live` as Origin and passed.
These checks made no authenticated, email, or paid-provider requests.

Browser inspection of staging confirmed the 185-scenario catalog, seven-family
and 31-profession selectors, Cybersecurity filtering with its primary specialist
scenarios ahead of shared practice, the Cybersecurity specialist on setup, and
23 paths with profession filtering and round details. Browser inspection of live production confirmed:

- `/interviews/` showed 185 scenarios; selecting the Career foundations family
  returned 23 scenarios.
- `/setup/?pack=cybersecurity-practice&round=round-2` resolved the pinned phishing
  scenario and showed entry level, 20 minutes, Incident simulation, and the
  Cybersecurity interviewer.
- `/setup/?q=career-written-screen` showed Written response and discussion, the
  Career Foundations interviewer, entry level, and 15 minutes. At a 390 × 844
  mobile viewport, the document width was 390 pixels, with no horizontal overflow.
- `/packs/` showed 23 paths. The Skilled Trades filter returned its dedicated path
  first, followed by the three shared paths. At the same mobile viewport, its
  document width was 390 pixels, with no horizontal overflow.
- The browser console recorded zero errors and zero warnings across the checked
  pages. No authenticated interview session or provider conversation was started.

An independent **33-GET** artifact check at **21:33:36.727802 UTC** found the
preview and live HTML byte-identical for `/`, `/interviews/`, `/packs/`, and
`/setup/`, along with all 12 JavaScript files referenced by those pages. The
compiled API selection was HTTP with `IS_MOCK=false` and the stable production
API URL; none of the inspected assets selected a loopback or staging API.
Bundled demo-fixture strings were present, but the compiled runtime selection
was not mock mode. The API readiness release marker matched the recorded source
SHA and reported non-stub configuration.

## Release artifacts

| Artifact | Recorded value |
| --- | --- |
| API and web build source | `9584d71041047fa5ff566f91f16eb89bb16eac4c` |
| Identical-tree merge | `f51b2f37c47650918704e2ef7cfcb309100d4e04` |
| Cloud Build | `71c13305-ce69-4a4e-9eae-f88e12ad1998` |
| Immutable API image digest | `sha256:7fe01bcc475728aa150ac5ab394df7c00fda2098a973b392600f91189d3ff216` |
| Tested staging API | `mockinterview-api-staging-00018-pil` |
| Staging Firebase version | `52cbc0d6a3a1c194` |
| Production API revision | `mockinterview-api-00052-goc` |
| Production API traffic | `100%` to `mockinterview-api-00052-goc` |
| Production Firebase preview channel | `launch-production` |
| Production Firebase preview version | `b8a1329cd717263b` |
| Production Firebase live version | `b8a1329cd717263b` |
| Production Firebase live release | `1789421477501000` |
| Production web promotion (UTC) | `2026-09-14T21:31:17.501Z` |
| Final public API verification (UTC) | `2026-09-14T21:32:16.919267+00:00` |
| Preview/live asset verification (UTC) | `2026-09-14T21:33:36.727802+00:00` |
| Final release verification (UTC) | `2026-09-14T21:34:00Z` |

Production reuses the tested immutable API image. The production web preview
was promoted to live as the same exact Firebase version, without a rebuild. Its
build input used the source SHA recorded above and the stable production API.
The web export has no compiled SHA marker: `NEXT_PUBLIC_RELEASE_SHA` was supplied
as build input but is unused by the web source. No SHA literal was found in the
four HTML pages or their 12 referenced JavaScript files. Web source attribution
therefore rests on recorded build-input provenance and the independently verified
preview/live artifact identity above, not a SHA read from the served application.
API/web build identifiers remain the source SHA above even if documentation is
committed later.

The production configuration was compared with its recorded baseline and was
preserved except for the expected image and `RELEASE_SHA` changes. No migrations,
secret rotations, provider changes, or new runtime configuration were required.
Corpus, format, and path JSON ships in the API image and loads at startup.

At **21:32 UTC**, a structured log query for the new production revision covering
the preceding 30 minutes returned no entries at severity `ERROR` or higher or
with HTTP status 500 or above. This is a bounded post-deployment observation, not
an assertion that every request path or future operation is error-free.

## Rollback and limits

The paired rollback targets are API **`mockinterview-api-00050-tur`** and Firebase
web version **`86c8dc3900f656ee`**, live release **`1789278115871000`**. Restore the
recorded web artifact together with API traffic. No database rollback is required.
An older API can parse existing JSON snapshots, but removes discovery of new
scenarios/paths and the new specialist behavior. Do not terminate healthy existing
interviews merely to finish the rollout.

A real-provider interview, voice conversation, saved-work reconnection, and
scoring/report flow **were not repeated for this release**. Browser navigation,
public readiness/catalog checks, and automated session tests do not constitute
fresh end-to-end interview acceptance or establish provider conversation quality.
Earlier production text-interview and saved-report acceptance is recorded in the
[initial interview acceptance](RELEASE-VALIDATION-2026-09-09.md) and
[policy/privacy release record](RELEASE-VALIDATION-2026-09-10.md); those checks are
historical evidence, not validation of the new specialist prompts.

Practitioner review, representative real-provider exercises across the new
families, and human scoring calibration remain outstanding product-quality work.
See the [bank audit](INTERVIEW-BANK-EXPANSION-2026-09-14.md) and
[release runbook](RELEASE-RUNBOOK.md).
