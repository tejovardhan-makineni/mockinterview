# mockinterview.live

An MIT-licensed open source project for making thoughtful interview practice
available to everyone. Practice with a clearly identified AI interviewer, keep
your work and feedback, and contribute new interview formats. The hosted application is at
[mockinterview.live](https://mockinterview.live).

Use the hosted website, the desktop app, or a local web installation. The website
adapts to desktop and phone browsers.

**Community:** [GitHub](https://github.com/tejovardhan-makineni/mockinterview) ·
[Reddit](https://www.reddit.com/r/mockinterview_live/) ·
[Discord](https://discord.gg/KvGunFKZwS)

**Current source:** see [the changelog](CHANGELOG.md) for the project-home, MIT,
local setup and practice updates. These changes are not a deployment claim.

**The public beta is live.** The interview bank expansion was deployed and
verified on September 14, 2026. See the
[September 14 release record](docs/INTERVIEW-BANK-RELEASE-2026-09-14.md) for
artifact versions, validation and rollback. The
[September 13 release record](docs/MICROPHONE-TESTERS-RELEASE-2026-09-13.md)
covers microphone readiness and unlimited tester access. Earlier production
signup, verification, real AI text interview and saved-report acceptance remain
documented in the [initial interview acceptance](docs/RELEASE-VALIDATION-2026-09-09.md)
and [policy/privacy release record](docs/RELEASE-VALIDATION-2026-09-10.md).

Choose a profession, format, target level and duration. Optional controls adjust
challenge, interview style and simulation versus coaching. A device check leads
into a room with voice, an optional camera, notes and an appropriate workspace.
Reports use the scenario's rubric and cited candidate evidence; missing evidence
is marked **not assessed**. Appearance is not part of the interview score.

The hosted catalog contains **185 scenarios** across **30 professional areas
plus career foundations**, organized into seven career families with specialized
AI interviewer profiles and 23 practice paths. The
[September 14 bank audit and expansion](docs/INTERVIEW-BANK-EXPANSION-2026-09-14.md)
describes the additions, categorization and next priorities. The
[release record](docs/INTERVIEW-BANK-RELEASE-2026-09-14.md) records the deployed
artifacts and verification.
The bank includes original work-sample defense,
AI-output critique, incident triage, SQL review, stakeholder negotiation and
candidate-question practice. Content and AI feedback are **community previews**:
practitioner review and scoring calibration remain pending. Employer-named packs
are practice approximations, with no employer affiliation or claim of exact
questions. Code and SQL are reviewed as text; there is no execution sandbox.

## Desktop app

The Electron app uses the same interview room, custom questions, model options,
feedback and reports as the website. It bundles the local Go service and SQLite:
no terminal, Docker, PostgreSQL installation or online account is needed to
practice. **Desktop interviews always require your own AI provider key.** There
are no free desktop interviews. The hosted website still provides one funded
interview per standard account, with up to 200 funded interviews per UTC day
across the project; personal-key practice and approved tester access retain
their separate rules.

Published packages and their current availability are listed on the
[Downloads page](https://mockinterview.live/downloads/) and
[GitHub Releases](https://github.com/tejovardhan-makineni/mockinterview/releases).
GitHub hosts the installer files. Only verified assets appear as download buttons;
build support in this repository is not a claim that every platform is signed or
published yet. See [desktop setup and storage](docs/LOCAL-SETUP.md#desktop-app).

Interviews and reports save locally. Cloud AI still needs internet and incurs your
provider's charges. Keys stay in memory for the app session. Optional analytics
and optional result sharing start off, are private to the project administrator,
and never block practice when the sharing service is unavailable. GitHub, Discord
and Reddit remain available inside the app.

## Run locally from source

Install **Git, Node.js 22 with npm 10, and Go 1.26.8+**. Docker and a model key
are not required for the local demo. These commands work in macOS/Linux terminals
and Windows PowerShell:

```sh
git clone https://github.com/tejovardhan-makineni/mockinterview.git
cd mockinterview
node scripts/local.mjs
```

**Default demo accounts and history are temporary and reset on exit.** For lasting
history, install native PostgreSQL, copy `.env.example` to `.env`, configure
`DATABASE_URL`, then run `node scripts/local.mjs --persistent`. See the
[OS setup, storage and Docker guide](docs/LOCAL-SETUP.md). Desktop package availability is listed separately on the Downloads page. Python 3 is only needed for content tools and
some checks.

Open `http://localhost:3000`; the API is at `http://localhost:8080`. Register a
local account. Development auth responses provide a verification/recovery link
so a mail service is unnecessary locally. The default development setup uses a
deterministic demo model when no key is configured. Demo feedback is labelled and
does not measure interview performance. Choose **Text conversation** at the
device check for this no-key demo. `USE_STUB_LLM=true` explicitly forces it.
If voice is unavailable, the room identifies the text fallback and keeps the
microphone off.

`APP_ENV=development` and `LOCAL_UNLIMITED=true` enable unlimited local practice.
Keep this development configuration on your computer. Production refuses stub
models and unlimited mode. Local real-provider usage still incurs your provider's
charges. `make down` stops containers and preserves your database volume.

For a real voice interview, add `GEMINI_API_KEY` to `.env`. Gemini supplies native
voice; reasoning and scoring can use the configured `LLM_PROVIDER` and its key.
See [.env.example](.env.example). `make check-llm` is an optional, billable provider
connectivity check. Never commit `.env` or paste a key in an issue or transcript.

You can also paste a personal provider key in interview setup. Development
generates a temporary encryption key automatically. For interrupted personal-key
attempts to remain recoverable after restarting the API, generate a stable key:

```bash
python3 -c 'import base64,secrets; print(base64.b64encode(secrets.token_bytes(32)).decode())'
```

Save the output as `SESSION_ENCRYPTION_KEY` in your local `.env`; do not commit
it. Without a stable key, re-enter your provider key after restarting or reloading. Provider
credentials expire after three hours, so later feedback retries can also request
re-entry. Unlimited local practice does not remove provider charges.

Two alternatives after copying `.env.example`:

- **Containers:** `make local-stack` builds the API and static web application and
  starts Postgres. Only loopback ports 3000, 8080 and 5432 are published. This is a
  development setup, without production TLS or mail configuration. Compose
  configuration has been checked; a complete container boot remains unverified
  in this release's validation environment.
- **UI preview:** after `make install`, run
  `cd web && NEXT_PUBLIC_MOCK=1 npm run dev`. This uses example data without an API.

## Hosted usage and continued practice

The standard free allowance is **one funded interview per account**,
using Gemini 3.8 Flash for text and feedback. The project funds at most **200
interviews per UTC calendar day**, including approved tester starts. The free
allowance does not renew daily. The project must have access to that
provider model; deployment validation checks this rather than silently replacing
it. **Validated personal-key interviews have no daily start limit**. Your model
provider's charges and rate limits still apply. Resume and report retries do not
consume another start; only one active interview per account is allowed.

Approved beta testers may start additional funded interviews within the shared
200-per-day capacity and agree to provide useful feedback.
Apply through `/beta`; the owner reviews applications in `/admin`. Feedback and
analytics consent are separate. Tester access does not grant administrator
access. See [tester operations](docs/TESTER-ACCESS.md).

Describe a custom interview in your own words: profession, goal, seniority/level,
questions and preferred structure. The interviewer uses this context to guide
practice when no existing template fits. Request a future template through
`/requests`; requests are private administrator notes.

During an interview, the AI privately reviews the in-app workspace and conversation
about every 30 seconds. It can keep waiting, answer a clarification, ask one
question grounded in the candidate's work, or move forward once it has enough
evidence. Technical tasks start with a concise brief; later requirements are
introduced through clarification and discussion. The cadence is for observation,
not a question every 30 seconds. See the [behavior and level guidance](docs/ADAPTIVE-INTERVIEWER.md).

Hosted accounts verify their email before starting or using hosted resume AI.
Existing accounts can still read history and export data before verification;
retrying a legacy unfinished interview's assessment requires verification too.
Verification and recovery
messages use the project's verified sender domain through Resend. Check spam as
well as your inbox; delivery tests do not guarantee inbox placement. If feedback
fails, the report offers a retry for that saved attempt. An invalid assessment
is rejected rather than replaced with invented scores, and a retry is not a
guarantee of success.

The **policy and privacy controls are deployed**, as recorded in the
[September 10 validation](docs/RELEASE-VALIDATION-2026-09-10.md). They require an 18+ assertion, acceptance of the current terms and acknowledgment of
the privacy notice before hosted AI use. Existing users keep login, recovery,
history, export and deletion access while reviewing the update. No birth date or
identity document is collected by this acknowledgment flow.

API clients can read `GET /api/v1/legal-policy` for `terms_version`,
`privacy_version`, `minimum_age` and `required`. The current document versions are
`2026-10-05.1`. Hosted registration includes `adult_confirmed: true` and both exact
version strings alongside email/password; existing users submit the same three
fields to authenticated `POST /api/v1/auth/policies`. That endpoint returns the
user directly, including `policies_required`, `adult_confirmed`, accepted versions,
`adult_confirmed_at` and `policies_accepted_at`. Local demo mode preserves its
existing setup.

New hosted voice attempts require `voice_processing_acknowledged: true` after
the microphone-processing notice; text practice needs no microphone permission.
Hosted personal Gemini keys require `paid_billing_confirmed: true` for validation,
session creation and key replacement. This is the user's declaration, **not a
verified billing check**; provider charges and terms still apply.

Resume upload sends extracted text to the configured AI provider immediately;
later interview inclusion is a separate choice. The update adds authenticated
`DELETE /api/v1/resume` to remove uploads and standalone reviews. It preserves
interview history and content already used there; delete the relevant interviews
or account when needed. See [legal readiness](docs/LEGAL-READINESS-2026-09-10.md)
and [privacy operations](docs/PRIVACY-OPERATIONS.md) for remaining operator,
audience and retention decisions. These controls are not a claim of universal
legal compliance.

Between interviews, revisit saved evidence, rewrite an answer and complete the
report's short self-guided exercises. These exercises make no model request.
Rehearsing the same scenario builds fluency; a new scenario tests whether the
skill transfers. Repeated scores are not independent evidence of readiness.

## Contribute

### Help improve the beta

New started interviews include a required six-question product check-in after
they end, including unsuccessful attempts. Complete it before starting another
interview; this check-in is optional for approved testers. Existing history,
reports, report retries, export and deletion remain
available. Unstarted reservations and older interviews do not create a backlog.
Every question accepts an unable-to-judge response; comments and transcript
sharing remain optional. An optional comparison section asks which other
interview tools you have tried, how this experience compares, and what worked
better or worse. The check-in does not change your interview score.

Questions cover ease of use, interviewer realism, subject-specific probing,
challenge fit, report actionability and technical disruption. See the exact
[questionnaire](docs/BETA-FEEDBACK-QUESTIONNAIRE.md) and
[metric definitions](docs/FEEDBACK-METRICS.md). Stored administrators can review
the aggregated results at `/admin/feedback`. These are product-experience
measures, not proof of learning gains or a validated assessment of job readiness.
Public research or university studies require a separate participation and
data-handling process.

### Contribute a format or improvement

You can contribute a scenario, a reusable format, a rubric review, an accessibility
fix or a product improvement. Start with [CONTRIBUTING.md](CONTRIBUTING.md) and the
[content contract](docs/CORPUS.md). New content needs original or appropriately
licensed material, conditional facts, fair follow-ups and review fixtures.

```bash
make new-scenario ID=my-original-scenario
make new-format ID=my-format
make validate-content
make preview-format ID=work-sample-reservation-review
```

Scaffolds go to `scratch/content/` and are not published automatically. The author
preview includes private answers and probes; do not expose its output to a live
candidate. Schema validation and context tests are a first gate, followed by
human content review and real-provider evaluation before any quality claim.

Public beta validation has not covered a human microphone/browser matrix,
production load, or calibration of the scenario bank. Report reproducible
problems through [support](SUPPORT.md), without sharing keys or private interview
content in public issues.

## Development checks

```bash
make test
make lint
make build
make validate-content
```

CI installs from the lockfile and runs Go checks, corpus fixtures and web tests
and a production web export. Deterministic tests need no real provider key.

The application is a Go API with PostgreSQL and embedded migrations, plus a
Next.js static export. Corpus, director and scorer versions travel with attempts
so future edits do not silently redefine earlier interviews. The scorer keeps
full evidence up to an explicit size limit and rejects invalid citations instead
of silently shortening the transcript. See [architecture](docs/ARCHITECTURE.md),
[deployment update instructions](docs/DEPLOYMENT-UPDATE-PLAN.md) and
[launch readiness](docs/LAUNCH-READINESS.md).

## Community and license

See [support](SUPPORT.md), [security reporting](SECURITY.md), the
[Code of Conduct](CODE_OF_CONDUCT.md) and [third-party notices](NOTICE.md).
Source and original contributed scenarios are licensed under
[MIT](LICENSE). Keep the copyright and permission notice with redistributed
copies. Third-party dependencies retain their own licenses.


## Private feedback, analytics and administration

Hosted account history is stored by the API. Local PostgreSQL history belongs to
that installation; the temporary demo resets on exit. Optional **Share analytics**
sends consented results to a separately configured, authenticated server for
administrator review. Without consent it sends nothing; if that API is offline,
optional sharing fails quietly and local practice continues. This is not a backup
or automatic cross-device sync. Private feedback is not a public testimonial.
See [local sharing setup](docs/LOCAL-SETUP.md#optional-analytics-sharing), the
[design and data contracts](docs/OPEN-SOURCE-DESIGN.md), and the app's privacy page.

The owner portal is `/admin`, protected by the persisted admin role **and** the
verified owner account `makinenitejovardhan@gmail.com`. There is no seeded/shared
password. Register or recover that account, set a unique strong password, verify
email, then run `go run ./cmd/admin -grant-owner` from `api/` against the intended
database. An optional `-owner-password-file` provisions a new strong password
from an owner-only file outside the repository; it never bypasses verification.
Sign in again after promotion. See [owner setup and deployment](docs/OPEN-SOURCE-DESIGN.md#owner-bootstrap-and-deployment).
