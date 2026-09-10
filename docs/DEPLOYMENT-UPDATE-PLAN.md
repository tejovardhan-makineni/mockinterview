# Deployment update plan

> **Historical deployment assessment.** This document records the infrastructure observed before implementation. Use [implementation validation](RELEASE-VALIDATION-2026-09-09.md) for current check results and the [release runbook](RELEASE-RUNBOOK.md) for the maintained deployment procedure. Old script examples below are not the current release instructions.

Verified 2026-09-09 (America/Los_Angeles). This is a read-only deployment audit and a proposed release procedure; no deployment was performed.

## Verified deployment

| Resource | Observed value |
|---|---|
| Public app | https://mockinterview.live — HTTP 200, app rendered in browser |
| Firebase app URL | https://mockinterview-web.web.app |
| Firebase Hosting site | `mockinterview-web` — confirmed by `firebase hosting:sites:list` |
| GCP / Firebase project | `storybytes-495010` |
| API service / region | `mockinterview-api` / `us-west1` |
| API URL returned by Cloud Run | `https://mockinterview-api-a35kjmd22q-uw.a.run.app` |
| Existing documented API URL | `https://mockinterview-api-661893776515.us-west1.run.app` — `/api/v1/ping` returned `200 {"pong":"ok"}` |
| Serving revision | `mockinterview-api-00037-zsd`, 100% traffic |
| Revision creation | `2026-08-14T04:44:49.894040Z` |
| Container digest | `gcr.io/storybytes-495010/mockinterview-api@sha256:bf274fd10d3d99aa3544b16d3c2ec79f7a5c366f5f9663f521687822c5135513` |
| Cloud SQL connection | `storybytes-495010:us-west1:storybytes-beta-db` |
| App database | `mockinterview`, per repository and Obsidian configuration; database contents were not queried |
| Capacity | 1 CPU, 512 MiB, concurrency 80, max 5 instances, request timeout 3600 seconds |
| DB pool | `DB_MAX_CONNS=3` per instance |
| Reasoning / live | `gemini` / `gemini-2.5-flash-native-audio-preview-12-2025` |
| CORS | `https://mockinterview-web.web.app,https://mockinterview.live` |
| Secret Manager references | None in the current container environment; secret values were not displayed |
| Repository | `https://github.com/tejovardhan-makineni/mockinterview` |
| Repository visibility | Private, verified in the follow-up launch-readiness review; public source access is a pending release step |
| Audited local HEAD | `a09e1a6` |

The deployed image does not expose a verified Git SHA, so this audit does not claim the running binary is identical to local HEAD. Add release/version metadata in the next release.

The user mentioned `mockinterview.io`. That URL returned a small redirect shell toward `/lander`, not the verified app content. Treat `.live` as the current deployment until the owner decides on a domain change; ownership of `.io` was not established.

## Existing instructions and their corrections

- [deploy-api.sh](../deploy/deploy-api.sh) builds remotely through Cloud Build, then deploys Cloud Run. It sources the ignored `deploy/mockinterview.env`; do not print, commit, or copy credentials into documentation.
- [deploy-web.sh](../deploy/deploy-web.sh) builds a Next.js static export against `WEB_API_BASE` and deploys the `mockinterview-web` Firebase site selected in [firebase.json](../firebase.json).
- [OPERATIONS.md](OPERATIONS.md) incorrectly names `mockinterview-live` in one section and says domain mapping is pending. The verified site is `mockinterview-web`; `.live` now serves the app.
- The API script prints `/healthz` as the smoke URL; use `/api/v1/ping`, consistent with the working runbook endpoint.
- Operations documentation says a five-connection pool; the script and live configuration use three.
- CLI read access works in this environment. The older statement that web deployment always requires a fresh interactive Firebase login should become an authentication prerequisite, not a universal blocker.
- Current deployment scripts do not forward every supported model, tier, admin, and provider setting. `--set-env-vars` can replace existing environment configuration. Move to a reviewed, explicit non-secret manifest and Secret Manager references before adding usage-policy and BYOK settings.
- Current API images use `:latest`, deploy directly to serving traffic, and have no automated rollback gate. The web script also treats every site-create failure as “already exists.” Provision the site separately and fail on real deployment errors.
- The SQL instance is shared with other products. Routine updates must not recreate the instance/database or run `setup-db.sh`. Schema changes and restore exercises must be limited to this app.

## Release preparation

1. Finish the reliability, authorization, quota, and migration gates in [IMPROVEMENT-PLAN.md](IMPROVEMENT-PLAN.md). Publish the UX behind a feature flag until its complete interview path passes.
2. Commit a reproducible release; embed Git SHA, API schema version, format/rubric versions and model IDs in safe release metadata. Preserve unrelated local changes.
3. Use a dedicated staging service and database. A Firebase preview that calls production is only a UI preview; it is not an isolated end-to-end test environment. Permit only its exact staging origin in CORS.
4. Move server credentials to Secret Manager, using narrowly scoped access. [push-secrets.sh](../deploy/push-secrets.sh) is only a partial starting point: it does not wire the running service or cover all new settings. Never pass user BYOK credentials through the deploy configuration.
5. Use additive migrations and a compatibility adapter for old sessions and corpus JSON. Validate migration locks, real PostgreSQL behavior, and old/new API compatibility. Record a backup and exercise app-database restoration in isolation. A Cloud Run rollback does not undo a database migration.
6. Run Go build/vet/tests/race checks, frontend lint/tests/production build, schema checks, real-Postgres tests, browser flows, and the targeted provider evaluations described in the plan. Provider evaluations should use synthetic candidate data and a bounded budget.

## Concrete update sequence after implementation

The existing production commands are:

```bash
bash deploy/deploy-api.sh
bash deploy/deploy-web.sh
```

They currently publish immediately. Harden them to implement the staged sequence below before using them for the redesign. This example describes release operations; these commands were not executed during the audit.

```bash
# From the repository root, with a reviewed committed release.
RELEASE_SHA=$(git rev-parse HEAD)
RELEASE_IMAGE="gcr.io/storybytes-495010/mockinterview-api:${RELEASE_SHA}"
RELEASE_SOURCE=$(mktemp -d "${TMPDIR:-/tmp}/mockinterview-release.XXXXXX")

# Build the exact committed source, excluding unrelated working-directory edits.
git archive "$RELEASE_SHA" api | tar -x -C "$RELEASE_SOURCE"

# Keep builds on Cloud Build, as the existing deployment convention requires.
BUILD_ID=$(gcloud builds submit "$RELEASE_SOURCE/api" \
  --tag "$RELEASE_IMAGE" --project storybytes-495010 --format='value(id)')
RELEASE_DIGEST=$(gcloud builds describe "$BUILD_ID" \
  --project storybytes-495010 --format='value(results.images[0].digest)')
test -n "$RELEASE_DIGEST"
RELEASE_IMAGE_REF="gcr.io/storybytes-495010/mockinterview-api@${RELEASE_DIGEST}"

# Image-only update preserves existing service settings. Apply any reviewed
# environment / secret / capacity changes separately through the hardened script.
# Even without traffic, startup can apply migrations: only additive, tested ones.
gcloud run deploy mockinterview-api \
  --image "$RELEASE_IMAGE_REF" \
  --project storybytes-495010 --region us-west1 \
  --no-traffic --tag candidate

# Inspect the candidate URL and exact new revision. Do not guess either value.
gcloud run services describe mockinterview-api \
  --project storybytes-495010 --region us-west1 \
  --format='yaml(status.traffic,status.latestReadyRevisionName)'
```

Use the returned candidate URL for `/api/v1/ping` and safe production smoke checks. Complete destructive/failure-injection tests in staging. Verify the new revision's migrations and provider readiness; keep active sessions on the existing version and support reconnects across revisions. Persist state externally because Cloud Run session affinity is best effort. [Cloud Run WebSockets guidance](https://docs.cloud.google.com/run/docs/triggering/websockets).

Prepare the web candidate against staging for full testing, and against the verified production API only for the final compatible release preview:

```bash
# In web/, after a reproducible dependency install.
NEXT_PUBLIC_MOCK=0 \
NEXT_PUBLIC_API_BASE=https://mockinterview-api-661893776515.us-west1.run.app \
npm run build

# From repository root; firebase.json restricts the site to mockinterview-web.
firebase hosting:channel:deploy ux-review \
  --project storybytes-495010 --expires 7d
```

Record the generated preview origin and configure the appropriate API CORS allowlist before testing it. Firebase preview channels have their own URLs and can be promoted to live. [Firebase preview workflow](https://firebase.google.com/docs/hosting/test-preview-deploy).

Promote the compatible API candidate with an explicit returned revision name. Start with limited new-session traffic if the persistence and schema contracts support mixed revisions; otherwise use a maintenance window for session starts. The release command should require an explicit revision, not `latest`. Cloud Run supports controlled traffic migration and rollback. [Cloud Run rollout guidance](https://docs.cloud.google.com/run/docs/rollouts-rollbacks-traffic-migration).

Promote the exact tested web version using `firebase hosting:clone mockinterview-web:ux-review mockinterview-web:live --project storybytes-495010`, after ensuring it is the final production-API build. Avoid rebuilding a different artifact during promotion. [Firebase version and channel management](https://firebase.google.com/docs/hosting/manage-hosting-resources).

## Smoke checks, observation, rollback

- Check landing, sign-in, public catalog, quota/reset display, device preflight, successful voice and text start, save acknowledgement, finish, feedback generation, history and feedback submission.
- Verify a returning user's existing reports, saved configuration and workspace after migration. Confirm production contains no mock fixtures or stub-generated assessments.
- Watch session-start failures, upstream errors, interruption latency, reconnect success, lost-save reports, scoring queue age, quota conflicts, provider spend and database pressure. Logs must exclude credentials and raw interview content.
- Record the previous Cloud Run revision and Firebase release before promotion. Roll API traffic back to that recorded revision if reliability degrades; rollback the Firebase live release through its release history. Keep additive schemas compatible with both versions.
- Do not roll back by restoring the entire shared SQL instance. Prefer forward fixes or a tested app-specific recovery plan.
- Update [OPERATIONS.md](OPERATIONS.md), [ARCHITECTURE.md](ARCHITECTURE.md), README and the Obsidian project note with the actual release, site, API URL, policies and verified checks.

No production changes, DNS changes, credential changes, account creation, or paid provider evaluations were performed in this planning pass.

Follow-up operational checks found successful automated database backups (seven retained), no Cloud Monitoring uptime checks or alert policies in this project, a TCP-only startup probe, and use of a shared default service account with project Editor permissions. The remediation and verification gates are in [LAUNCH-READINESS.md](LAUNCH-READINESS.md); those settings were inspected only, not changed.
