#!/usr/bin/env bash
# Migrate this app's existing credentials into isolated Secret Manager entries
# and grant only its dedicated runtime identity access. Never print values.
set -euo pipefail
TASK_ROOT=$(cd "$(dirname "$0")/.." && pwd)
set -a
source "${MOCKINTERVIEW_DEPLOY_ENV:-$TASK_ROOT/deploy/mockinterview.env}"
source "$TASK_ROOT/deploy/common.sh"
configure_target
set +a
python3 "$TASK_ROOT/deploy/provision-secrets.py"
