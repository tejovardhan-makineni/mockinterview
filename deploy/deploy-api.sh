#!/usr/bin/env bash
# Build committed source remotely, deploy a no-traffic candidate, then explicitly
# promote that immutable revision after the staging and browser checks pass.
set -euo pipefail
TASK_ROOT=$(cd "$(dirname "$0")/.." && pwd)
CONFIG_FILE=${MOCKINTERVIEW_DEPLOY_ENV:-"$TASK_ROOT/deploy/mockinterview.env"}
source "$CONFIG_FILE"
: "${PROJECT_ID:?}" "${REGION:?}" "${SERVICE:?}" "${CLOUDSQL_INSTANCE:?}"
ACTION=${1:-candidate}
source "$TASK_ROOT/deploy/common.sh"
configure_target

# Bind each revision to actual secret versions so later restarts cannot silently
# pick up a credential rotation that was never tested with this candidate.
secret_ref() {
 local version
 version=$(gcloud secrets versions describe latest --secret "$1" --project "$PROJECT_ID" --format='value(name)')
 version=${version##*/}
 [[ "$version" =~ ^[0-9]+$ ]] || { echo "Cannot resolve secret version: $1" >&2;return 1; }
 printf '%s:%s' "$1" "$version"
}
case "$ACTION" in
 candidate)
  RELEASE_SHA=$(git -C "$TASK_ROOT" rev-parse HEAD)
  git -C "$TASK_ROOT" diff --quiet HEAD -- api || { echo 'Commit API changes before building a release.' >&2; exit 1; }
  BUILD_DIR=$(mktemp -d)
  trap 'rm -rf "$BUILD_DIR"' EXIT
  git -C "$TASK_ROOT" archive "$RELEASE_SHA" api | tar -x -C "$BUILD_DIR"
  BUILD_ID=$(gcloud builds submit "$BUILD_DIR/api" --project "$PROJECT_ID" --tag "gcr.io/$PROJECT_ID/mockinterview-api:$RELEASE_SHA" --async --format='value(id)')
  echo "Cloud Build: $BUILD_ID"
  while true; do
   BUILD_STATUS=$(gcloud builds describe "$BUILD_ID" --project "$PROJECT_ID" --format='value(status)')
   case "$BUILD_STATUS" in SUCCESS) break;; FAILURE|CANCELLED|TIMEOUT|EXPIRED|INTERNAL_ERROR) echo "Build failed: $BUILD_STATUS" >&2;exit 1;; esac
   sleep 10
  done
  IMAGE_DIGEST=$(gcloud builds describe "$BUILD_ID" --project "$PROJECT_ID" --format='value(results.images[0].digest)')
  [[ "$IMAGE_DIGEST" == sha256:* ]] || { echo 'Missing immutable image digest' >&2;exit 1; }
  IMAGE="gcr.io/$PROJECT_ID/mockinterview-api@$IMAGE_DIGEST"
  # These are Secret Manager references, never secret values in command arguments.
  DATABASE_SECRET=$(secret_ref "$SECRET_PREFIX-database-url")
  JWT_SECRET_REF=$(secret_ref "$SECRET_PREFIX-jwt-secret")
  GEMINI_SECRET=$(secret_ref "$SECRET_PREFIX-gemini-key")
  SESSION_SECRET=$(secret_ref "$SECRET_PREFIX-session-key")
  MAIL_SECRET=$(secret_ref "$SECRET_PREFIX-mail-key")
  SECRETS="DATABASE_URL=$DATABASE_SECRET,JWT_SECRET=$JWT_SECRET_REF,GEMINI_API_KEY=$GEMINI_SECRET,SESSION_ENCRYPTION_KEY=$SESSION_SECRET"
  case "${MAIL_PROVIDER:-resend}" in
   resend) SECRETS+=",RESEND_API_KEY=$MAIL_SECRET";;
   smtp) SECRETS+=",SMTP_PASSWORD=$MAIL_SECRET";;
   *) echo 'MAIL_PROVIDER must be resend or smtp.' >&2;exit 1;;
  esac
  if [[ "${LLM_PROVIDER:-gemini}" != gemini ]]; then PROVIDER_ENV=$(printf %s "$LLM_PROVIDER" | tr '[:lower:]' '[:upper:]');REASONING_SECRET=$(secret_ref "$SECRET_PREFIX-reasoning-key");SECRETS+=",${PROVIDER_ENV}_API_KEY=$REASONING_SECRET";fi
  export RELEASE_SHA
  # JSON is valid YAML and preserves all delimiter-containing nonsecret values.
  export PUBLIC_URL="${PUBLIC_URL:-https://mockinterview.live}" MAIL_FROM="${MAIL_FROM:-}" LLM_PROVIDER="${LLM_PROVIDER:-gemini}" LLM_MODEL="${LLM_MODEL:-}" GEMINI_MODEL_LIVE="${GEMINI_MODEL_LIVE:-gemini-2.5-flash-native-audio-preview-12-2025}"
  export CORS_ALLOW="${CORS_ALLOW:-https://mockinterview.live,https://mockinterview-web.web.app}" SMTP_ADDRESS="${SMTP_ADDRESS:-}" SMTP_USERNAME="${SMTP_USERNAME:-}" HOSTED_DAILY_START_LIMIT="${HOSTED_DAILY_START_LIMIT:-50}"
  python3 - "$BUILD_DIR/env.json" <<'PY'
import os,json,sys
keys=['RELEASE_SHA','PUBLIC_URL','MAIL_FROM','LLM_PROVIDER','LLM_MODEL','GEMINI_MODEL_LIVE','CORS_ALLOW','SMTP_ADDRESS','SMTP_USERNAME','HOSTED_DAILY_START_LIMIT']
d={k:os.environ.get(k,'') for k in keys};d.update(APP_ENV='production',MODE='api',DB_MAX_CONNS='3',LOCAL_UNLIMITED='false',USE_STUB_LLM='false')
with open(sys.argv[1],'w') as f:json.dump(d,f)
PY
  TRAFFIC_ARGS=(--no-traffic --tag candidate)
  # First deployment of an isolated staging service has no previous revision.
  if ! gcloud run services describe "$TARGET_SERVICE" --project "$PROJECT_ID" --region "$REGION" --format='value(metadata.name)' >/dev/null 2>&1; then
   [[ "$TARGET_SERVICE" == *-staging ]] || { echo 'Create production only after an isolated staging deployment.' >&2;exit 1; }
   TRAFFIC_ARGS=(--tag candidate)
  fi
  gcloud run deploy "$TARGET_SERVICE" --image "$IMAGE" --project "$PROJECT_ID" --region "$REGION" \
   --platform managed --allow-unauthenticated --ingress all --service-account "$RUNTIME_SA" \
   --set-cloudsql-instances "$CLOUDSQL_INSTANCE" --cpu 1 --memory 512Mi --concurrency 20 \
   --min-instances "${MIN_INSTANCES:-1}" --max-instances 5 --no-cpu-throttling --timeout 3600 \
   --startup-probe='httpGet.path=/ready,httpGet.port=8080,initialDelaySeconds=0,periodSeconds=10,timeoutSeconds=5,failureThreshold=12' \
   --liveness-probe='httpGet.path=/health,httpGet.port=8080,periodSeconds=30,timeoutSeconds=5,failureThreshold=3' \
   --env-vars-file "$BUILD_DIR/env.json" --set-secrets "$SECRETS" "${TRAFFIC_ARGS[@]}"
  gcloud run services describe "$TARGET_SERVICE" --project "$PROJECT_ID" --region "$REGION" --format='json(status.latestReadyRevisionName,status.traffic)'
  ;;
 promote|rollback)
  REVISION=${2:?Usage: deploy-api.sh promote-or-rollback EXACT_REVISION}
  [[ "$REVISION" == "$TARGET_SERVICE"-* ]] || { echo 'Revision must belong to the selected service.' >&2;exit 1; }
  gcloud run services update-traffic "$TARGET_SERVICE" --project "$PROJECT_ID" --region "$REGION" --to-revisions "$REVISION=100"
  ;;
 *) echo 'Usage: deploy-api.sh [candidate|promote REVISION|rollback REVISION]' >&2;exit 1;;
esac
