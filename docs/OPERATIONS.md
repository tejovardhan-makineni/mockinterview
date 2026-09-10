# Operations — mockinterview.live

## Release status

The redesigned public beta is **live** with **143 preview scenarios**. The
September 10 policy/privacy update is deployed: explicit adult and current-policy
acknowledgments, voice/Gemini-key declarations, resume deletion, clearer notices,
and browser dependency/font licenses. The retired camera-analysis ingestion
endpoint returns 410. Existing accounts retain history, export and deletion
access while reviewing the current policies; none were automatically marked adult
or accepted.

| Deployed release field | Recorded value |
|---|---|
| API build source | `58280bab2d55c1047c7e388ba72c1ddefe51befe` |
| Web build source | `061b56bc6b26ab33baf092a9679f123a60b92764` |
| Production Cloud Run revision | `mockinterview-api-00041-cic` — 100% traffic |
| API image digest | `sha256:d38fdc7583f67602994bc93f4541f731be1810d168bf50dceef3f1b6220af48e` |
| Cloud Build | `31e8d60b-39fc-489f-b579-d925c97cca93` |
| Production Firebase version | `b8a9451c163cb83d` |
| Firebase hosting release | `1789031721533000` |
| Firebase promotion time (UTC) | `2026-09-10T09:15:21.533Z` |
| Public verification time (UTC) | `2026-09-10T09:17:02.886581Z` |

The API source tree is identical in the API and web build commits. The web and
Firebase configuration trees match the staging-tested `b6f5756` source; staging
web version `11cdb49cee568add` targets the isolated staging API. Production version
`b8a9451c163cb83d` targets the stable production API and was cloned from its tested
preview without rebuilding. Documentation-only commits do not change these
build-source identifiers.

Public health, current policy enforcement, CORS, routes/security headers, license
notices and the replacement font hash passed. Migration 0009 preserved existing
application data; no hosted account or paid provider request was created for this
update. The new revision's retention worker completed. See the
[policy/privacy validation record](RELEASE-VALIDATION-2026-09-10.md) and the
[initial real interview acceptance](RELEASE-VALIDATION-2026-09-09.md), which also
records the recovered staging scoring failure with unknown original cause.
Content rights/review, scoring calibration and the owner/legal decisions in the
[legal assessment](LEGAL-READINESS-2026-09-10.md) remain open.

The prior rollback pair is API `mockinterview-api-00039-qam` and Firebase version
`c8dee48c3e3cb3b9`. Rolling back removes the new policy safeguards; coordinate both
artifacts and assess that consequence. The database migration is additive, so a
routine binary rollback does not require restoring the shared SQL instance.

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

The apex `https://mockinterview.live` is the primary website. Production CORS
was verified to allow these five exact served origins and reject an untrusted
origin:

- `https://mockinterview.live`
- `https://www.mockinterview.live`
- `https://mockinterview-web.web.app`
- `https://mockinterview-web.firebaseapp.com`
- `https://mockinterview-web--launch-production-dnxl08u1.web.app`

The last origin is the reviewed production-target preview. New installations
must select their own exact trusted origins in deployment configuration; do not
copy these operator-specific domains or replace them with a wildcard. Update and
verify the allowlist when a preview origin is added or retired.

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

The host-run API/web path and real PostgreSQL checks were exercised. Compose
configuration validates, but the complete container profile has not been booted
in the release validation environment. Local practice remains unlimited; hosted
administrators use the same seven-day funded and 24-hour overall start allowance
as other users. Resuming and retrying feedback preserve the original attempt.

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

The active main-branch ruleset requires six checks and the CodeQL findings gate
without bypass actors. Check the actual source commit's CI/security results before
building. Human approval is not enforced by that single-maintainer ruleset.

## Account mail

The hosted sender domain `mockinterview.live` is verified with Resend. Real
registration/verification and password recovery have been exercised. Gmail
recovery reached Inbox. An initial Yahoo verification message reached Spam and
was moved manually; the later production verification reached Inbox in that same
mailbox after the earlier spam correction. Authentication and TLS passed, but
these observations do not guarantee inbox delivery for other recipients. Observe delivery failures and
support reports, and direct users to check spam folders.

The privacy page identifies Resend and explains that account email addresses and
single-use action links pass through that service. Keep mail API credentials in
Secret Manager, and never place action links, tokens or message bodies in logs.
Development returns action links locally without requiring a mail provider.

Existing accounts, including the maintainer account, must verify their email
before hosted AI use and review the current adult/terms/privacy declarations. Resume upload parses through a provider and shares the
verified, per-user 30-request/hour limit with the other ancillary AI endpoints.
Legacy unfinished attempts cannot queue paid scoring until their owner verifies;
history, export and recovery remain accessible. Resume provider failures use
fixed category/route diagnostics without raw errors, account identity or content.

**Remaining owner action:** the existing owner account is unverified and has the
`user` role. Confirm the intended administrative account and complete its email
verification. An authorized operator can then grant the stored admin role;
verification alone does not grant it. No admin role or verification bypass was
applied during launch. This affects the owner's feedback-triage access, not public
beta availability. The normal hosted interview allowance still applies.

## Health and recovery

`/health` reports process liveness. `/ready` checks database access and model
configuration; it does not make a paid provider request. Monitor the API readiness
endpoint and website, and verify alert delivery through a configured notification
channel. A created uptime check alone does not prove notifications work.
The owner email route was tested with real regional uptime notifications; the
temporary test policy was deleted afterward. After promotion, reconciliation
updated the existing API check to `/ready` and the web check to `/`, with a
300-second period, 10-second timeout, USA regions and valid TLS. Both uptime
policies and the scoring-failure policy are enabled. A helper bug that included
an immutable monitored-resource field in an update was corrected, with six
regression tests passing; actual reconciliation then succeeded. This operational
helper fix requires no API or web rebuild. Retest delivery intentionally when
notification ownership or routing changes.
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

### Scoring failures

Scoring logs and stored job failures contain fixed, allowlisted diagnostics.
The five categories are `provider_request`, `assessment_invalid`,
`evidence_limit`, `timeout` and `operation`. Logs include the session identifier
and job attempt for restricted operator investigation; they do not include the
raw provider response, model output, private candidate evidence or credentials.
Invalid citations, dimensions and numeric bounds remain rejected. Invalid
assessments and evidence-size failures do not trigger the automatic transient
retry; model-controlled text such as `503` or `timeout` cannot request one.
Ordinary provider-transient retries remain bounded. A manual feedback retry
uses the same saved attempt and does not consume a new start.

The log-based metric
`logging.googleapis.com/user/mockinterview_scoring_failures` exports only fixed
`category` and `service_name` labels. The alert sums failures for production
`mockinterview-api` across 15 minutes and fires above two events: **three or more
failures in 15 minutes**. It excludes staging and routes to the tested owner
email channel. The alert is installed, but its new scoring signal has not been
triggered in production; uptime-message delivery only verifies the shared
notification route. Do not make paid requests or induce real user failures just
to manufacture a notification test.

If it fires, confirm the affected service/release and fixed category, inspect job
state and persistence health, and use the saved attempt's retry when appropriate.
Do not weaken evidence validation to make a report appear successful. A single
successful retry does not establish why the previous attempt failed.

### Reproduce or update scoring monitoring

`deploy/monitor.py` reconciles uptime checks, their policies and notification
routing. It **does not create or update this scoring metric or policy**. The
current operator retains the applied `scoring-failure-metric.json`,
`scoring-failure-alert-policy.json` and monitoring record with the private release
backups. Use those records and a fresh resource description to update the
existing installation. Do not publish exported policy metadata containing operator
identities or create a duplicate policy just to change its configuration.

For another Google Cloud installation, enable Logging/Monitoring and use an
operator authorized to manage log metrics and alert policies. Save the following
as `scoring-failure-metric.yaml` outside the repository, replacing the service
filter if your service names differ:

```yaml
description: Failed scoring-job attempts by fixed category and service; not unique users or eventual outcomes.
filter: |
  resource.type="cloud_run_revision"
  resource.labels.service_name=~"^mockinterview-api(-staging)?$"
  jsonPayload.msg="scoring attempt failed"
  jsonPayload.category=~"^(provider_request|assessment_invalid|evidence_limit|timeout|operation)$"
metricDescriptor:
  metricKind: DELTA
  valueType: INT64
  unit: "1"
  labels:
    - key: category
      valueType: STRING
    - key: service_name
      valueType: STRING
labelExtractors:
  category: EXTRACT(jsonPayload.category)
  service_name: EXTRACT(resource.labels.service_name)
```

Save this as `scoring-failure-policy.yaml` beside it. Replace `YOUR_PROJECT` and
`YOUR_CHANNEL_ID`, choose an enabled channel whose delivery you have verified,
and use the exact production service name. Keep staging excluded from the
threshold filter. The sum spans revisions and categories without including
session identifiers in metric labels or notification content.

```yaml
displayName: Mockinterview scoring failures
enabled: true
combiner: OR
notificationChannels:
  - projects/YOUR_PROJECT/notificationChannels/YOUR_CHANNEL_ID
alertStrategy:
  autoClose: 1800s
conditions:
  - displayName: At least 3 production scoring failures in 15 minutes
    conditionThreshold:
      filter: >-
        metric.type="logging.googleapis.com/user/mockinterview_scoring_failures"
        AND resource.type="cloud_run_revision"
        AND resource.labels.project_id="YOUR_PROJECT"
        AND resource.labels.service_name="mockinterview-api"
      comparison: COMPARISON_GT
      thresholdValue: 2
      duration: 0s
      trigger:
        count: 1
      aggregations:
        - alignmentPeriod: 900s
          perSeriesAligner: ALIGN_SUM
          crossSeriesReducer: REDUCE_SUM
documentation:
  mimeType: text/markdown
  content: >-
    Inspect fixed categories and the service revision first. This counts failed
    job attempts, not unique users or ultimately failed interviews. Never put
    raw provider output, transcripts, account emails, keys or session identifiers
    in incident notifications. Preserve strict assessment validation. This alert
    does not authorize automatic paid retries or quota resets. See the release
    runbook for recovery and rollback.
```

Choose an explicit project, then inspect existing resources before changing them:

```bash
gcloud logging metrics describe mockinterview_scoring_failures --project=YOUR_PROJECT
gcloud monitoring policies list --project=YOUR_PROJECT --format=json
```

When those resources are absent on a new installation, create them from the
reviewed files and record the returned policy identifier:

```bash
gcloud logging metrics create mockinterview_scoring_failures \
  --project=YOUR_PROJECT --config-from-file=scoring-failure-metric.yaml
gcloud monitoring policies create \
  --project=YOUR_PROJECT --policy-from-file=scoring-failure-policy.yaml
```

For an existing installation, describe and preserve its current policy first.
Use `gcloud logging metrics update mockinterview_scoring_failures
--project=YOUR_PROJECT --config-from-file=scoring-failure-metric.yaml` for the
metric. Use `gcloud monitoring policies update YOUR_POLICY_ID
--project=YOUR_PROJECT --policy-from-file=scoring-failure-policy.yaml` only after
reviewing the complete policy file: that command replaces the policy and must
preserve the intended channels and conditions. Re-read both resources afterward
to verify the filter, labels, 900-second sum, threshold, enabled state and owner
route. The Google Cloud CLI documents
[metric updates](https://docs.cloud.google.com/sdk/gcloud/reference/logging/metrics/update)
and [policy creation](https://docs.cloud.google.com/sdk/gcloud/reference/monitoring/policies/create).

This is configuration guidance, not evidence that a scoring incident has been
delivered. Validate notification ownership separately and record any controlled
signal test as such; do not count uptime emails as a test of this metric.
