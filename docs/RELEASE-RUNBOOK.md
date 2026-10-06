# Release and recovery

The hosted application uses Cloud Run, PostgreSQL and Firebase Hosting. Keep production credentials in Secret Manager, and keep filled deployment configuration outside Git. `deploy/mockinterview.env.template` lists every setting. The current domain is **mockinterview.live**; do not assume control of mockinterview.io.

## Before the first release

1. Configure a verified sender in Resend or a STARTTLS SMTP service. Verify delivery, expired links, reset/revocation and spam-folder guidance using an account you control. Production refuses to start without mail configuration.
2. Run `deploy/push-secrets.sh`. This creates a dedicated runtime service account, grants Cloud SQL connection permission and grants access at each app secret. It does not remove permissions from shared service accounts or replace another application's database.
3. Use a separate staging service, database, database user and secret prefix. Never point destructive tests at production. Bind database users to their own database and verify a restore into the staging database before launch.
4. Configure uptime checks for `/ready` on the API and `/` on the web domain. Configure alert notification channels and verify actual delivery. `/health` is process liveness; `/ready` checks the database and model configuration, not a paid provider request.
5. Keep Cloud Run CPU allocated outside requests: the portable scoring/retention worker runs within the API process. Production uses one **service-level** minimum instance (`MIN_INSTANCES=1`); staging uses zero. Each new revision has minimum zero. `MAX_INSTANCES` defaults to one and caps both the service and each revision. A stopped worker leaves durable scoring jobs to be reclaimed after the lease expires.
6. Grant administration to the **verified project owner account**: from `api/`, `go run ./cmd/admin -grant-owner`. Use operator credentials and the intended database. The stored role, verified email and exact owner identity are all required. This revokes old login sessions.

Use `/health` and `/ready` for probes and external checks. Cloud Run reserves
some paths ending in `z`; the live service's `/healthz` request returned a Google
frontend 404 before reaching the container. The API retains `/healthz` and
`/readyz` as local compatibility aliases. Do not interpret their public 404 as
evidence that the process is unhealthy.
[Cloud Run reserved URL paths](https://docs.cloud.google.com/run/docs/known-issues)

## Build and stage

- Run `make test`, the browser checks, dependency scans and corpus validation. Run the PostgreSQL integration tests with an isolated `TEST_DATABASE_URL`. Check saved work, rejected personal keys, quota exhaustion, interrupted speech, provider failure, refresh/reconnect, final-answer persistence and repeat finish.
- Commit the exact release source. `deploy/deploy-api.sh candidate` uses `git archive HEAD api` and Cloud Build, retrieves an immutable digest, then creates a revision tagged `candidate` with no production traffic. The first staging service is the only exception to `--no-traffic`. Archive extraction normalizes the public source's umask to `022` so the non-root container can read the corpus even when the operator uses `077`; private outer directories and credentials remain restrictive.
- Run this against isolated staging first using `MOCKINTERVIEW_DEPLOY_ENV=/private/path/staging.env`. Test migrations there; production startup applies additive migrations automatically, before traffic promotion. Review backward compatibility with the still-serving revision.
- Set the staging `WEB_API_BASE` to the tested staging service, or a candidate URL whose lifetime you preserve. Add the exact Firebase preview origin to that API's CORS configuration. With the staging configuration, `deploy/deploy-web.sh preview launch-candidate` builds with `npm ci`, real API mode and the source SHA, then publishes only the dedicated site. It does not modify shared Firebase Auth domains. This preview talks to the staging database and must not be cloned to production.
- Verify real-provider readiness separately with a short, controlled interview. A green readiness endpoint does not prove a vendor's key or model works.

### Policy controls and required product feedback

Build the API and web from the same reviewed source, or record and verify exact
matching API/web trees when their build SHAs differ. Match the published policy
documents and forms to the API versions; do not release one side independently.
`GET /api/v1/legal-policy` currently returns `terms_version` and `privacy_version`
of `2026-10-04.1` in this source, `minimum_age: 18`, and `required` for the hosted configuration.
Hosted registration requires `adult_confirmed: true` plus both current version
strings. Existing authenticated users submit those fields to
`POST /api/v1/auth/policies`, which returns the user directly with
`policies_required`, `adult_confirmed`, versions and server timestamps.

Verify these release boundaries with synthetic accounts and isolated PostgreSQL:

- Missing, false or stale acknowledgment must prevent hosted registration/AI
  calls. Legacy login, recovery, history, export and deletion must remain usable.
  New migration `0009_policy_acknowledgments.sql` leaves existing accounts
  unacknowledged; do not backfill acceptance or infer adulthood from prior use.
- New hosted voice attempts require `voice_processing_acknowledged: true`
  before reservation/provider use. Check the notice before audio streams to a
  provider and the text alternative. Existing voice reconnects retain their
  compatibility path after account acknowledgment.
- Hosted Gemini BYOK validation, new attempts and credential replacement require
  `paid_billing_confirmed: true`. The connection check does not verify billing;
  new attempts record a declaration timestamp, while key replacement does not
  retain a separate declaration timestamp. Never describe this as verified
  provider eligibility or silently use platform billing instead.
- `DELETE /api/v1/resume` must remove the owner's uploads and standalone reviews,
  including reviews detached by an earlier replacement, while preserving
  interview history. Explain that already-used interview content needs separate
  session/account deletion. Retired behavior ingestion must return `410` without
  reading or storing camera-analysis samples.
- Already acknowledged interviews can finish queued feedback across a policy
  revision. Pre-policy jobs remain saved but require account review/verification
  before retry; verify the actionable report message and no provider call while
  blocked.

Record exact validation and deployment evidence before marking these controls
live. Review [legal readiness](LEGAL-READINESS-2026-09-10.md) and
[privacy operations](PRIVACY-OPERATIONS.md); operator identity, audience and
contract/retention decisions remain separate from passing tests.

For the required product-feedback release, also verify that a new, started,
finished attempt requires a versioned questionnaire before another new interview
can reserve capacity or call a provider. An unused reservation and an older
attempt must not block practice. Verify failed and unscored attempts, all
unable-to-judge answers, concurrent/repeated submissions, ownership, and recovery
from an unsuccessful save. Reopening a saved response must not count it twice.
Reports, retry, history, export and deletion remain accessible. Session/account
deletion removes structured responses; general problem reports have their own
documented lifecycle. Check full-window metric denominators and stored-admin
authorization. See [metric definitions](FEEDBACK-METRICS.md).

The terms/privacy version change explains required product feedback; it is not
consent to optional transcript sharing or research. Coordinate API and web
promotion. A rollback to an earlier binary removes the new survey enforcement
and endpoints even if the additive migration is compatible.

## Promote

1. Record the currently serving API revision and Firebase live version/channel in a private release record. Preserve a private application backup and verify the migration on an isolated restore before creating the production candidate.
2. Create a production candidate using the exact immutable image tested in staging. For an existing service with unchanged configuration, `gcloud run deploy mockinterview-api --project storybytes-495010 --region us-west1 --image "$TESTED_IMAGE" --update-env-vars "RELEASE_SHA=$TESTED_SHA" --no-traffic --tag candidate` preserves its production settings and secret references. Set both variables from the verified staging record; do not use an image tag or copy staging database credentials. Compare the resulting configuration and readiness with the recorded baseline. If a new build or configuration is necessary, test that new artifact before promotion.
3. With the production deployment configuration selected, build `deploy/deploy-web.sh preview launch-production`. Its `WEB_API_BASE` must be the stable production API origin (or a permanent tested revision URL with an explicit lifetime). Verify source identity, CORS, routes, notices and the exact Firebase version. Keep this separate from `launch-candidate`.
4. Promote the exact production API revision with `deploy/deploy-api.sh promote EXACT_REVISION`, then clone the matching production preview with `deploy/deploy-web.sh promote launch-production`, both using the production configuration. The web promotion does not rebuild. Verify live equals the tested preview version.
5. Check the public domain, actual signup/recovery delivery, one representative voice and text interview, history/report retrieval, source links and feedback submission. Inspect structured errors and job backlog.
6. Tag the tested commit and publish release notes with supported modes and known limitations. Make the repository public only after full-history secret and asset-rights review. Confirm an unauthenticated clone works. Enable private vulnerability reporting, dependency/security scanning and branch protection.

## Rollback

Route API traffic back with `deploy/deploy-api.sh rollback PREVIOUS_REVISION`. Restore the recorded Firebase Hosting version using its release history or clone a retained previous channel. Do not roll database schema backward automatically: additive migrations must remain compatible with the prior binary. If not, use a forward fix and a reviewed data recovery plan. Never restore the entire shared Cloud SQL instance to fix this application's data.

Migration `0009` adds nullable timestamps and version columns with safe defaults;
the prior API can read its existing columns with the migration left in place.
However, rolling back to that binary **removes the new age/policy enforcement**.
It also rejects new registration fields and lacks `/auth/policies`. Coordinate
the matching web rollback so signup does not silently break, and explicitly
assess the lost safeguards; database compatibility is not policy equivalence.
Prefer a forward fix when the previous release cannot meet the required controls.

Existing WebSockets can remain attached to their original revision during a traffic change. Do not forcibly terminate healthy interviews just to complete rollout. During process shutdown, leases and saved transcripts allow reconnection; a scoring job can be reclaimed after its lease expires. Verify that recovery behavior before relying on it.

## Ongoing operation

Review failed interview starts, input/persistence failures, feedback jobs, provider errors and latency. Keep application diagnostics free of request bodies, action links, keys and provider output; verify infrastructure access-log fields separately, including query strings. The hourly maintenance worker removes expired email actions and personal keys, the expired seven-day usage ledger, and raw legacy behavioral telemetry older than thirty days. A minimal HMAC identity and first-claim timestamp remain separately to enforce the one-time free allowance after account or history deletion. Completed interview history remains until the user deletes it or the account. Automated backups age out under the database's configured backup policy; manual backups need a separate retention decision. Do not claim immediate deletion from backups. See the actual retention inventory in [privacy operations](PRIVACY-OPERATIONS.md).

The global platform-funded limit is at most 200 starts per UTC day, including approved testers. Standard hosted identities get one funded interview in total; approved testers retain repeated practice within the shared cap. Validated personal-key sessions do not consume either funded allowance. Cloud billing alerts provide notifications; they do not cap usage. Personal-key requests must remain on that user's selected provider, including scoring, and must not silently fall back to platform billing.

Keep minimum instances at service level. A tagged revision with its own minimum
can keep a separate billable instance running even at zero percent traffic. The
deploy scripts use revision minimum zero; CI preserves the existing service
minimum and CPU allocation and sets both maximums from `MAX_INSTANCES` (default
one). Increasing this ceiling requires reviewing the monthly cost allowance.
Existing revision settings are immutable: deploying a new revision does not
remove old tagged revisions' minimums. After confirming that a tag is no longer
used by an active release or preview, remove that tag while retaining the
revision for rollback. Changing tags does not change the main service's traffic
percentages. Preserve any candidate URL still used by staging or preview clients.
[Cloud Run minimum instances](https://docs.cloud.google.com/run/docs/configuring/min-instances).

The service maximum excludes tagged revisions with no traffic percentage, so
each candidate also needs its own maximum. Instance limits can be briefly
exceeded during scaling or rollout; these settings reduce resource costs but
are not a combined dollar cap for Cloud Run, SQL, Hosting and Gemini.
[Cloud Run maximum instances](https://docs.cloud.google.com/run/docs/configuring/max-instances).

### Live cost controls verified October 4, 2026 (Pacific)

The combined Google spending target is **$200/month**, across both projects on
the same billing account. The controls below are conservative safeguards, not a
guaranteed all-service invoice ceiling.

| Control | Saved setting |
| --- | --- |
| Account-wide monthly budget, all projects and services | $200, before credits; actual-spend alerts at $100, $150, $170 and $200; forecast alert at $170 |
| StoryBytes Cloud Run enforced monthly spend cap | $80; covers production and staging in `storybytes-495010` |
| Default Gemini Project monthly API cap | $40 in `gen-lang-client-0958826978`, which contains the app's named API keys |
| StoryBytes monthly Gemini API cap | $10 in `storybytes-495010` |
| Production Cloud Run service scaling | Minimum 1, maximum 1; always-allocated CPU retained |
| Staging Cloud Run service scaling | Minimum 0, maximum 1 |
| Cloud SQL automatic storage growth | Maximum 20 GB; current disk remains 10 GB, `db-g1-small`, backups retained |

The $80 + $40 + $10 caps leave $70 of the target for SQL, Hosting, storage,
builds, secrets, logging, taxes and delayed usage. This is an allowance, not an
enforced $70 cap on those services. The account budget only alerts. Google spend
caps may overshoot while reporting/enforcement catches up, in-flight requests
can finish, and persistent compute/storage charges can continue. Cloud SQL can
override its storage-growth limit for critical maintenance; exhausting the
limit can interrupt database availability. No project billing shutdown was
configured. See [spend cap limitations](https://docs.cloud.google.com/billing/docs/how-to/budgets-spend-caps)
and [Cloud SQL storage settings](https://docs.cloud.google.com/sql/docs/postgres/instance-settings).

Obsolete production revision tags were removed (including the tag on the
current production revision); main traffic remains on `mockinterview-api-00059-dew`.
Staging keeps its serving `candidate` tag on `mockinterview-api-staging-00016-qox`;
other staging tags were removed. The underlying revisions were retained for
rollback. Both `/ready` endpoints returned healthy after the changes.

Review [the account budgets](https://console.cloud.google.com/billing/018C4E-829C3D-84E5B5/budgets)
and [AI Studio project caps](https://aistudio.google.com/spend).
Cloud Billing caps can require manual lifting after enforcement; do not lift
them in the same month without reviewing the combined allowance. AI Studio
project caps reset monthly. On the verification date, AI Studio also displayed
a prepay-migration notice for October 12; no credits or automatic reload were
purchased or enabled during this cost-control change.


## Open source participation update

The current source adds MIT licensing, a Docker-free temporary demo, one-time funded
access, unlimited validated personal-key starts, custom interviews, beta
applications, private template requests and consented analytics. Follow the
[feature deployment checklist](OPEN-SOURCE-DESIGN.md#owner-bootstrap-and-deployment)
in addition to this runbook. Migrations `0013_runtime_metrics.sql`, `0014_community.sql` and `0015_lifetime_free_interview.sql` are additive. The lifetime-claim migration recovers retained usage and surviving started sessions; erased historical records cannot be reconstructed. Do not
promote a source change until its staged API and web artifacts are verified.

Verify Gemini 3.8 Flash, Gemini 3.8 Live and Gemini 3.8 Flash TTS access in the
actual deployment project with optional billable provider checks; model access is
not guaranteed for a particular project.
If it is unavailable, choose a model explicitly and update the displayed default
before release. Production must reject LOCAL_MEMORY and stub mode. Provision the
verified owner through the operator CLI; never seed a shared administrator password.
