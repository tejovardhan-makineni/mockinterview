#!/usr/bin/env bash
# Preview the exact committed static build, then clone the tested version to live.
set -euo pipefail
TASK_ROOT=$(cd "$(dirname "$0")/.." && pwd)
source "${MOCKINTERVIEW_DEPLOY_ENV:-$TASK_ROOT/deploy/mockinterview.env}"
: "${FIREBASE_PROJECT:?}" "${WEB_API_BASE:?}"
SITE=mockinterview-web
ACTION=${1:-preview}
CHANNEL=${2:-launch-candidate}
case "$ACTION" in
 preview)
  git -C "$TASK_ROOT" diff --quiet HEAD -- web firebase.json || { echo 'Commit the web changes before building a release.' >&2;exit 1; }
  RELEASE_SHA=$(git -C "$TASK_ROOT" rev-parse HEAD)
  [[ "$WEB_API_BASE" == https://* ]] || { echo 'Hosted API origin must use HTTPS.' >&2;exit 1; }
  BUILD_DIR=$(mktemp -d)
  trap 'rm -rf "$BUILD_DIR"' EXIT
  git -C "$TASK_ROOT" archive "$RELEASE_SHA" web firebase.json | tar -x -C "$BUILD_DIR"
  python3 - "$BUILD_DIR/firebase.json" "$SITE" <<'PY'
import json,sys
config=json.load(open(sys.argv[1]))
hosting=config.get('hosting',{})
if not isinstance(hosting,dict) or hosting.get('site') != sys.argv[2] or hosting.get('public') != 'web/out':
    raise SystemExit('Refusing deployment: committed hosting config does not match this app site/output.')
PY
  cd "$BUILD_DIR/web"
  npm ci
  APP_ENV=production NEXT_PUBLIC_MOCK=0 NEXT_PUBLIC_API_BASE="$WEB_API_BASE" NEXT_PUBLIC_RELEASE_SHA="$RELEASE_SHA" npm run build
  cd "$BUILD_DIR"
  # Do not catch arbitrary site-create errors or touch another application's site.
  firebase hosting:channel:deploy "$CHANNEL" --no-authorized-domains --expires 7d --project "$FIREBASE_PROJECT"
  ;;
 promote)
  firebase hosting:clone "$SITE:$CHANNEL" "$SITE:live" --project "$FIREBASE_PROJECT"
  ;;
 *) echo 'Usage: deploy-web.sh [preview|promote] CHANNEL' >&2;exit 1;;
esac
