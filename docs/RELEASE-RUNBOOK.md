# Release and recovery

The hosted application uses Cloud Run, PostgreSQL and Firebase Hosting. Keep production credentials in Secret Manager, and keep filled deployment configuration outside Git. `deploy/mockinterview.env.template` lists every setting. The current domain is **mockinterview.live**; do not assume control of mockinterview.io.

## Before the first release

1. Configure a verified sender in Resend or a STARTTLS SMTP service. Verify delivery, expired links, reset/revocation and spam-folder guidance using an account you control. Production refuses to start without mail configuration.
2. Run `deploy/push-secrets.sh`. This creates a dedicated runtime service account, grants Cloud SQL connection permission and grants access at each app secret. It does not remove permissions from shared service accounts or replace another application's database.
3. Use a separate staging service, database, database user and secret prefix. Never point destructive tests at production. Bind database users to their own database and verify a restore into the staging database before launch.
4. Configure uptime checks for `/ready` on the API and `/` on the web domain. Configure alert notification channels and verify actual delivery. `/health` is process liveness; `/ready` checks the database and model configuration, not a paid provider request.
5. Keep Cloud Run CPU allocated outside requests: the portable scoring/retention worker runs within the API process. Production uses one minimum instance. A stopped worker leaves durable scoring jobs to be reclaimed after the lease expires.
6. Grant feedback administration by **verified user UUID**, not by an email allowlist: from `api/`, `go run ./cmd/admin -grant-admin-user USER_UUID`. Use operator credentials and the intended database. This revokes old login sessions.

Use `/health` and `/ready` for probes and external checks. Cloud Run reserves
some paths ending in `z`; the live service's `/healthz` request returned a Google
frontend 404 before reaching the container. The API retains `/healthz` and
`/readyz` as local compatibility aliases. Do not interpret their public 404 as
evidence that the process is unhealthy.
[Cloud Run reserved URL paths](https://docs.cloud.google.com/run/docs/known-issues)

## Build and stage

- Run `make test`, the browser checks, dependency scans and corpus validation. Run the PostgreSQL integration tests with an isolated `TEST_DATABASE_URL`. Check saved work, rejected personal keys, quota exhaustion, interrupted speech, provider failure, refresh/reconnect, final-answer persistence and repeat finish.
- Commit the exact release source. `deploy/deploy-api.sh candidate` uses `git archive HEAD api` and Cloud Build, retrieves an immutable digest, then creates a revision tagged `candidate` with no production traffic. The first staging service is the only exception to `--no-traffic`.
- Run this against isolated staging first using `MOCKINTERVIEW_DEPLOY_ENV=/private/path/staging.env`. Test migrations there; production startup applies additive migrations automatically, before traffic promotion. Review backward compatibility with the still-serving revision.
- Set `WEB_API_BASE` to the candidate API URL. Add the exact Firebase preview origin to the candidate's CORS configuration. `deploy/deploy-web.sh preview launch-candidate` builds with `npm ci`, real API mode and the source SHA, then publishes only the dedicated site. It does not modify shared Firebase Auth domains.
- Verify real-provider readiness separately with a short, controlled interview. A green readiness endpoint does not prove a vendor's key or model works.

### Policy controls and required product feedback

Build the API and web from the same reviewed source, or record and verify exact
matching API/web trees when their build SHAs differ. Match the published policy
documents and forms to the API versions; do not release one side independently.
`GET /api/v1/legal-policy` currently returns `terms_version` and `privacy_version`
of `2026-09-10.1` in this source, `minimum_age: 18`, and `required` for the hosted configuration.
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

1. Record the currently serving API revision and Firebase live version/channel in a private release record.
2. Promote the tested API revision: `deploy/deploy-api.sh promote EXACT_REVISION`.
3. Ensure the web build uses the stable production API origin (or a permanent tested revision URL with an explicit lifetime). Preview and test that exact build.
4. Promote that same Firebase version: `deploy/deploy-web.sh promote launch-candidate`. This clones a tested version; it does not rebuild.
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

Review failed interview starts, input/persistence failures, feedback jobs, provider errors and latency. Keep application diagnostics free of request bodies, action links, keys and provider output; verify infrastructure access-log fields separately, including query strings. The hourly maintenance worker removes expired email actions and personal keys, the expired seven-day eligibility ledger, and raw legacy behavioral telemetry older than thirty days. Completed interview history remains until the user deletes it or the account. Automated backups age out under the database's configured backup policy; manual backups need a separate retention decision. Do not claim immediate deletion from backups. See the actual retention inventory in [privacy operations](PRIVACY-OPERATIONS.md).

The global platform-funded daily start limit complements the per-user weekly/daily admission limits. Cloud billing alerts provide notifications; they do not cap usage. Personal-key requests must remain on that user's selected provider, including scoring, and must not silently fall back to platform billing.
