# Operations — mockinterview.live

## Release status

The redesigned application has **143 preview scenarios** and is available in the
public source repository. The hosted API and website still serve the previous
release while production verification/recovery mail is configured. Local checks
and real Gemini tests do not establish that the new version is deployed. See the
[dated validation record](RELEASE-VALIDATION-2026-09-09.md) for completed checks and
remaining release gates. Content review and scoring calibration remain pending.

Use the [release and recovery runbook](RELEASE-RUNBOOK.md) as the authoritative
procedure for staging, promotion, rollback and operational verification. Earlier
audits describe the pre-implementation application.

## Current hosting targets

| Resource | Target |
|---|---|
| Public website | [mockinterview.live](https://mockinterview.live) |
| Firebase Hosting site | `mockinterview-web` in project `storybytes-495010` |
| Firebase default domain | [mockinterview-web.web.app](https://mockinterview-web.web.app) |
| Cloud Run service | `mockinterview-api`, region `us-west1`, project `storybytes-495010` |
| Stable API origin | [mockinterview-api-661893776515.us-west1.run.app](https://mockinterview-api-661893776515.us-west1.run.app) |
| PostgreSQL | App database/login `mockinterview` on the shared Cloud SQL instance |

Do not deploy to another Firebase site or assume ownership of mockinterview.io.
Never recreate or restore the shared SQL instance to update this application.

## Local operation

Follow [the README](../README.md#run-locally) for dependencies and initial setup.
`make up` starts PostgreSQL; `make dev` starts the API on port 8080 and web on
port 3000. `make down` stops containers and preserves the database volume.

Development without the selected provider's key uses the labelled deterministic
text demo. Development auth supplies verification/recovery links without mail.
`LOCAL_UNLIMITED=true` permits unlimited local practice; production rejects this
setting and demo models. Real-provider usage still incurs provider charges.

Gemini supplies native voice. Reasoning/scoring use the configured provider and
model; personal-key sessions retain their selected provider. Configuration is
listed in [.env.example](../.env.example). The optional `make check-llm` makes
billable requests to configured providers; earlier results do not prove current
credentials or models work.

Run `make test`, `make lint`, `make build` and `make validate-content` for changes.
Use an isolated `TEST_DATABASE_URL` for PostgreSQL integration tests, never the
production database. [Contribution guidance](../CONTRIBUTING.md) covers scenario
fixtures, original content and format review.

## Release controls

Keep filled deployment configuration outside Git and credentials in app-scoped
Secret Manager secrets. The [deployment template](../deploy/mockinterview.env.template)
describes the settings; [database role hardening](DATABASE-ROLE-HARDENING.md)
covers existing-login demotion and custom roles for new installations. Routine
releases do not rerun database provisioning or rotate passwords.

The API script builds committed source in Cloud Build and stages an immutable
candidate before explicit traffic promotion. The web script exports committed
source into an isolated directory, publishes a preview on `mockinterview-web`,
then promotes that tested version without rebuilding. Staging must use a separate
database, login, secret prefix and runtime service account. Follow the release
runbook for exact commands, mail verification, preview CORS, backups and rollback.

## Health and recovery

`/health` reports process liveness. `/ready` checks database access and model
configuration; it does not make a paid provider request. Monitor the API readiness
endpoint and website, and verify alert delivery through a configured notification
channel. A created uptime check alone does not prove notifications work.
The legacy `/healthz` and `/readyz` aliases remain for local compatibility; Cloud
Run can intercept reserved paths ending in `z` before they reach the application.
Use the non-`z` paths for probes and public checks; see
[Cloud Run reserved paths](https://docs.cloud.google.com/run/docs/known-issues).

Keep CPU allocated and a minimum production instance for the durable scoring and
retention workers. Watch failed starts, provider errors, persistence failures and
scoring backlog. Preserve existing interviews during rollouts; verify reconnect
and report recovery before promotion. Logs must not contain keys, query strings,
request bodies or candidate transcripts. History remains until user deletion;
expired keys, action tokens and eligibility records follow the retention rules
in the release runbook. Database backups follow their separate retention policy.
