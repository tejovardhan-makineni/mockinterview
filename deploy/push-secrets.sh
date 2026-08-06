#!/usr/bin/env bash
# Optional: push app secrets to Secret Manager so deploy-api.sh can use
# --set-secrets instead of plaintext --set-env-vars. Run once, then edit
# deploy-api.sh to reference the secrets.
set -euo pipefail
cd "$(dirname "$0")"
source ./mockinterview.env

put() {
  local name="$1" val="$2"
  [ -z "$val" ] && return 0
  if gcloud secrets describe "$name" --project="$PROJECT_ID" >/dev/null 2>&1; then
    printf '%s' "$val" | gcloud secrets versions add "$name" --project="$PROJECT_ID" --data-file=-
  else
    printf '%s' "$val" | gcloud secrets create "$name" --project="$PROJECT_ID" --replication-policy=automatic --data-file=-
  fi
  echo "  set $name"
}

echo "Pushing secrets to Secret Manager ($PROJECT_ID)…"
put mockinterview-db-password "$DB_PASSWORD"
put mockinterview-jwt-secret  "$JWT_SECRET"
put mockinterview-gemini-key  "$GEMINI_API_KEY"
put mockinterview-openai-key  "$OPENAI_API_KEY"
put mockinterview-anthropic-key "$ANTHROPIC_API_KEY"
put mockinterview-xai-key     "$XAI_API_KEY"
put mockinterview-deepseek-key "$DEEPSEEK_API_KEY"
echo "Done. Grant the Cloud Run service account roles/secretmanager.secretAccessor."
