# mockinterview.live

Practice interviews with a clearly identified AI interviewer, keep your work and
feedback, and contribute new interview formats. The hosted application is at
[mockinterview.live](https://mockinterview.live).

**The redesigned public beta is live.** The API and website were promoted on
September 10, 2026. Production signup, verification, a real AI text interview,
saved evidence/report, history, feedback and quota checks passed. See
[initial interview acceptance](docs/RELEASE-VALIDATION-2026-09-09.md) and the
[policy/privacy release record](docs/RELEASE-VALIDATION-2026-09-10.md) for exact
deployed versions, completed checks and remaining limits.

Choose a profession, format, target level and duration. Optional controls adjust
challenge, interview style and simulation versus coaching. A device check leads
into a room with voice, an optional camera, notes and an appropriate workspace.
Reports use the scenario's rubric and cited candidate evidence; missing evidence
is marked **not assessed**. Appearance is not part of the interview score.

The catalog contains **143 scenarios**, including original work-sample defense,
AI-output critique, incident triage, SQL review, stakeholder negotiation and
candidate-question practice. Content and AI feedback are **community previews**:
practitioner review and scoring calibration remain pending. Employer-named packs
are practice approximations, with no employer affiliation or claim of exact
questions. Code and SQL are reviewed as text; there is no execution sandbox.

## Run locally

Install **Go 1.26.8+**, **Node.js 22 with npm 10**, **Python 3** (content tools),
and **Docker with Compose v2** (Postgres 16). No paid service is needed for the
demo.

```bash
git clone https://github.com/tejovardhan-makineni/mockinterview.git
cd mockinterview
cp .env.example .env
make install
make up
make dev
```

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
it. Without a stable key, re-enter your provider key after restarting. Provider
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

The free allowance is one interview start per rolling seven days. All hosted
accounts, including maintainers, share the same allowance. All hosted starts,
including your own provider key, share a one-start-per-rolling-24-hours limit.
Resume and report retries do not consume another start. Your own-key
option still uses the hosted service; self-hosting is the route to unrestricted
local practice.

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
`2026-09-10.1`. Hosted registration includes `adult_confirmed: true` and both exact
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
interview. Existing history, reports, report retries, export and deletion remain
available. Unstarted reservations and older interviews do not create a backlog.
Every question accepts an unable-to-judge response; comments and transcript
sharing remain optional. The check-in does not change your interview score.

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
production load, or calibration of all 143 scenarios. Report reproducible
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
[GNU AGPL v3](LICENSE). If you offer a modified version over a network, provide
users access to the corresponding source as required by that license.
