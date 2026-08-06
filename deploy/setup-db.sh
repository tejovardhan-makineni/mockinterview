#!/usr/bin/env bash
# Create the mockinterview database + app user on the SHARED StoryBytes Cloud SQL
# instance (same pattern summon uses — the user is auto-added to cloudsqlsuperuser
# so embedded migrations can create tables; no manual GRANT needed). Idempotent.
set -euo pipefail
cd "$(dirname "$0")"
source ./mockinterview.env

INSTANCE="${CLOUDSQL_INSTANCE##*:}" # trailing instance name

echo "==> user '$DB_USER' on '$INSTANCE'"
gcloud sql users create "$DB_USER" \
  --instance="$INSTANCE" --project="$PROJECT_ID" \
  --password="$DB_PASSWORD" || echo "   (exists — updating password)" && \
  gcloud sql users set-password "$DB_USER" --instance="$INSTANCE" --project="$PROJECT_ID" --password="$DB_PASSWORD" || true

echo "==> database '$DB_NAME' on '$INSTANCE'"
gcloud sql databases create "$DB_NAME" \
  --instance="$INSTANCE" --project="$PROJECT_ID" || echo "   (exists — skipping)"

echo "Done. Migrations auto-apply on first API deploy."
