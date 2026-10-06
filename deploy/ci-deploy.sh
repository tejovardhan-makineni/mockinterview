#!/usr/bin/env bash
# Runs only after exact-main CI, security and desktop checks pass. Credentials
# arrive via Workload Identity Federation. Preserve runtime secrets, identity,
# service minimum and CPU allocation; enforce the deployment's scaling ceiling.
set -Eeuo pipefail
for name in GCP_PROJECT GCP_REGION GCP_API_SERVICE GCP_IMAGE_REPOSITORY FIREBASE_PROJECT FIREBASE_SITE WEB_API_BASE WEB_PUBLIC_URL RELEASE_SHA RELEASE_VERSION GITHUB_RUN_ID; do
  [[ -n "${!name:-}" ]] || { echo "Missing deployment configuration: $name" >&2; exit 1; }
done
[[ "$RELEASE_SHA" =~ ^[a-f0-9]{40}$ && "$GITHUB_RUN_ID" =~ ^[0-9]+$ ]]
[[ "$GCP_PROJECT" == storybytes-495010 && "$GCP_API_SERVICE" == mockinterview-api && "$FIREBASE_SITE" == mockinterview-web ]]
node scripts/github-release.mjs gate --required
# The workflow verifies this standalone binary against the pinned upstream
# digest before authentication. Do not install deployment dependencies here.
FIREBASE_CLI=${FIREBASE_CLI:-./deployment-inputs/firebase}
[[ -f "$FIREBASE_CLI" && -x "$FIREBASE_CLI" ]] || { echo 'Verified Firebase CLI is missing or not executable.' >&2; exit 1; }
FIREBASE=("$FIREBASE_CLI")
CHANNEL="ci-${GITHUB_RUN_ID}"
BACKUP="rollback-${GITHUB_RUN_ID}"
IMAGE="$GCP_REGION-docker.pkg.dev/$GCP_PROJECT/$GCP_IMAGE_REPOSITORY/api:$RELEASE_SHA"
SERVICE_CONFIG_JSON=$(gcloud run services describe "$GCP_API_SERVICE" --project "$GCP_PROJECT" --region "$GCP_REGION" --format=json)
PREVIOUS_TRAFFIC=$(printf '%s' "$SERVICE_CONFIG_JSON" | python3 -c 'import json,sys; print(",".join(x["revisionName"]+"="+str(x["percent"]) for x in json.load(sys.stdin)["status"]["traffic"] if x.get("percent",0)>0))')
# Cloud Run retains explicit env overrides across image updates. Apply the beta
# model/cap upgrade to the candidate revision while preserving other settings
# and secrets. A separately configured reasoning provider keeps its model.
RUNTIME_ENV_UPDATES=$(printf '%s' "$SERVICE_CONFIG_JSON" | python3 -c '
import json,os,sys
service=json.load(sys.stdin)
current={item["name"]:item.get("value", "") for item in service["spec"]["template"]["spec"]["containers"][0].get("env", [])}
updates={"RELEASE_SHA":os.environ["RELEASE_SHA"], "GEMINI_MODEL_REASON":"gemini-3.8-flash", "GEMINI_MODEL_LIVE":"gemini-3.8-live", "GEMINI_MODEL_TTS":"gemini-3.8-flash-tts", "HOSTED_DAILY_START_LIMIT":"200"}
if current.get("LLM_PROVIDER", "gemini").lower() in ("", "gemini"):
    updates["LLM_MODEL"]="gemini-3.8-flash"
print(",".join(key+"="+value for key,value in updates.items()))
')
unset SERVICE_CONFIG_JSON
[[ -n "$PREVIOUS_TRAFFIC" ]]
API_PROMOTED=false
WEB_PROMOTED=false
rollback() {
  local status=$?
  trap - ERR
  echo 'Deployment failed; restoring previous serving revisions.' >&2
  if [[ "$WEB_PROMOTED" == true ]]; then "${FIREBASE[@]}" hosting:clone "$FIREBASE_SITE:$BACKUP" "$FIREBASE_SITE:live" --project "$FIREBASE_PROJECT" --non-interactive || echo 'Hosting rollback failed: operator action required.' >&2; fi
  if [[ "$API_PROMOTED" == true ]]; then gcloud run services update-traffic "$GCP_API_SERVICE" --project "$GCP_PROJECT" --region "$GCP_REGION" --to-revisions "$PREVIOUS_TRAFFIC" --quiet || echo 'API rollback failed: operator action required.' >&2; fi
  exit "$status"
}
trap rollback ERR
gcloud auth configure-docker "$GCP_REGION-docker.pkg.dev" --quiet
docker tag mockinterview-api:release "$IMAGE"
docker push "$IMAGE"
DIGEST=$(gcloud artifacts docker images describe "$IMAGE" --project "$GCP_PROJECT" --format='value(image_summary.digest)')
[[ "$DIGEST" =~ ^sha256:[a-f0-9]{64}$ ]]
REVISION="$GCP_API_SERVICE-gh$GITHUB_RUN_ID-a${GITHUB_RUN_ATTEMPT:-1}"
# Avoid a warm instance for every candidate tag while preserving the service's
# existing worker minimum. Tagged candidates need their own maximum as well.
gcloud run services update "$GCP_API_SERVICE" --project "$GCP_PROJECT" --region "$GCP_REGION" \
  --image "${IMAGE%:*}@$DIGEST" --update-env-vars "$RUNTIME_ENV_UPDATES" \
  --min-instances 0 --max "${MAX_INSTANCES:-1}" --max-instances "${MAX_INSTANCES:-1}" \
  --revision-suffix "gh$GITHUB_RUN_ID-a${GITHUB_RUN_ATTEMPT:-1}" --no-traffic --tag candidate --quiet
CANDIDATE=$(gcloud run services describe "$GCP_API_SERVICE" --project "$GCP_PROJECT" --region "$GCP_REGION" --format=json | python3 -c 'import json,sys; print(next(x["url"] for x in json.load(sys.stdin)["status"]["traffic"] if x.get("tag")=="candidate"))')
curl --fail --silent --show-error --retry 5 --retry-all-errors --max-time 15 "$CANDIDATE/ready" | python3 -c 'import json,os,sys; r=json.load(sys.stdin); assert r["ready"] and not r["llm_stub"] and r["release"]==os.environ["RELEASE_SHA"]'
node --input-type=module -e 'import {writeFileSync} from "node:fs"; writeFileSync("web/out/build-info.json",JSON.stringify({version:process.env.RELEASE_VERSION,commit:process.env.RELEASE_SHA}))'
"${FIREBASE[@]}" hosting:channel:deploy "$CHANNEL" --project "$FIREBASE_PROJECT" --no-authorized-domains --expires 7d --non-interactive --json > hosting-candidate.json
PREVIEW_URL=$(python3 -c 'import json; r=json.load(open("hosting-candidate.json"))["result"]; print(next(iter(r.values()))["url"])')
curl --fail --silent --show-error --retry 3 --max-time 15 "$PREVIEW_URL/build-info.json" | python3 -c 'import json,os,sys; r=json.load(sys.stdin); assert r["commit"]==os.environ["RELEASE_SHA"] and r["version"]==os.environ["RELEASE_VERSION"]'
node scripts/github-release.mjs gate --required
"${FIREBASE[@]}" hosting:clone "$FIREBASE_SITE:live" "$FIREBASE_SITE:$BACKUP" --project "$FIREBASE_PROJECT" --non-interactive
API_PROMOTED=true
gcloud run services update-traffic "$GCP_API_SERVICE" --project "$GCP_PROJECT" --region "$GCP_REGION" --to-revisions "$REVISION=100" --quiet
WEB_PROMOTED=true
"${FIREBASE[@]}" hosting:clone "$FIREBASE_SITE:$CHANNEL" "$FIREBASE_SITE:live" --project "$FIREBASE_PROJECT" --non-interactive
curl --fail --silent --show-error --retry 5 --retry-all-errors --max-time 15 "$WEB_PUBLIC_URL/build-info.json?build=$RELEASE_SHA" | python3 -c 'import json,os,sys; assert json.load(sys.stdin)["commit"]==os.environ["RELEASE_SHA"]'
curl --fail --silent --show-error --retry 5 --retry-all-errors --max-time 15 "$WEB_API_BASE/ready" | python3 -c 'import json,os,sys; r=json.load(sys.stdin); assert r["ready"] and r["release"]==os.environ["RELEASE_SHA"]'
export REVISION DIGEST PREVIOUS_TRAFFIC BACKUP
node --input-type=module -e 'import {writeFileSync} from "node:fs"; const e=process.env; writeFileSync("deployment-receipt.json",JSON.stringify({commit:e.RELEASE_SHA,version:e.RELEASE_VERSION,apiRevision:e.REVISION,imageDigest:e.DIGEST,previousTraffic:e.PREVIOUS_TRAFFIC,hostingRollbackChannel:e.BACKUP,run:e.GITHUB_RUN_ID},null,2))'
trap - ERR
