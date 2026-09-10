#!/usr/bin/env bash
# Create only this app's database and user. Existing passwords never rotate
# without the explicit --rotate-password option. Secret values stay out of argv.
set -euo pipefail
TASK_ROOT=$(cd "$(dirname "$0")/.." && pwd)
set -a
source "${MOCKINTERVIEW_DEPLOY_ENV:-$TASK_ROOT/deploy/mockinterview.env}"
source "$TASK_ROOT/deploy/common.sh"
configure_target
set +a
python3 "$TASK_ROOT/deploy/setup-db.py" "$@"
