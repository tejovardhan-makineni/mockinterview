#!/usr/bin/env bash
# Static-export the Next.js web app and deploy to Firebase Hosting ($0 CDN).
set -euo pipefail
cd "$(dirname "$0")"
source ./mockinterview.env

echo "==> Building web (static export) against API base: $WEB_API_BASE"
pushd ../web >/dev/null
NEXT_PUBLIC_MOCK=0 NEXT_PUBLIC_API_BASE="$WEB_API_BASE" npm run build
popd >/dev/null

echo "==> Deploying to Firebase Hosting ($FIREBASE_PROJECT), isolated site 'mockinterview-web'"
cd ..  # firebase.json + web/out live at repo root
# Create the dedicated site once (so we never overwrite summon/storybytes hosting).
firebase hosting:sites:create mockinterview-web --project "$FIREBASE_PROJECT" 2>/dev/null || echo "   (site exists — skipping)"
firebase deploy --only hosting --project "$FIREBASE_PROJECT"
echo "==> Web live at: https://mockinterview-web.web.app"
