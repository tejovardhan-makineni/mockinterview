#!/usr/bin/env bash
# Build the API image on Cloud Build and deploy to Cloud Run, wired to the shared
# StoryBytes Cloud SQL instance. Never builds Docker locally (house rule).
set -euo pipefail
cd "$(dirname "$0")"
source ./mockinterview.env

IMAGE="gcr.io/${PROJECT_ID}/${SERVICE}:latest"

echo "==> Cloud Build image: $IMAGE"
gcloud builds submit ../api --tag "$IMAGE" --project "$PROJECT_ID"

# DATABASE_URL over the Cloud SQL unix socket (pgx understands host=/cloudsql/...).
DB_URL="postgres://${DB_USER}:${DB_PASSWORD}@/${DB_NAME}?host=/cloudsql/${CLOUDSQL_INSTANCE}&sslmode=disable"

# One --set-env-vars with a custom '|' delimiter (DATABASE_URL contains '@' and
# CORS contains ',', so neither can be the delimiter — no value contains '|').
ENVS="MODE=api|APP_ENV=production|DB_MAX_CONNS=3|LLM_PROVIDER=${LLM_PROVIDER}|GEMINI_MODEL_LIVE=${GEMINI_MODEL_LIVE}"
ENVS="${ENVS}|CORS_ALLOW=https://mockinterview-web.web.app,https://mockinterview.live"
ENVS="${ENVS}|DATABASE_URL=${DB_URL}|JWT_SECRET=${JWT_SECRET}|GEMINI_API_KEY=${GEMINI_API_KEY}"
[ -n "${OPENAI_API_KEY:-}" ]    && ENVS="${ENVS}|OPENAI_API_KEY=${OPENAI_API_KEY}"
[ -n "${DEEPSEEK_API_KEY:-}" ]  && ENVS="${ENVS}|DEEPSEEK_API_KEY=${DEEPSEEK_API_KEY}"
[ -n "${XAI_API_KEY:-}" ]       && ENVS="${ENVS}|XAI_API_KEY=${XAI_API_KEY}"
[ -n "${ANTHROPIC_API_KEY:-}" ] && ENVS="${ENVS}|ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}"

echo "==> Deploy Cloud Run: $SERVICE ($REGION)"
gcloud run deploy "$SERVICE" \
  --image "$IMAGE" \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --platform managed \
  --allow-unauthenticated --ingress all \
  --set-cloudsql-instances "$CLOUDSQL_INSTANCE" \
  --cpu 1 --memory 512Mi \
  --concurrency 80 --min-instances 0 --max-instances 5 \
  --timeout 3600 \
  --set-env-vars "^|^${ENVS}"

URL=$(gcloud run services describe "$SERVICE" --project "$PROJECT_ID" --region "$REGION" --format='value(status.url)')
echo "==> API live at: $URL"
echo "    Smoke: curl $URL/healthz"
