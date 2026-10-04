#!/usr/bin/env bash
# Operator bootstrap only. Default is a local plan; --apply changes IAM/GitHub.
set -euo pipefail

PROJECT=storybytes-495010
PROJECT_NUMBER=661893776515
REGION=us-west1
REPOSITORY=tejovardhan-makineni/mockinterview
REPOSITORY_ID=1363533004
OWNER_ID=35104991
SERVICE=mockinterview-api
IMAGE_REPOSITORY=mockinterview
SITE=mockinterview-web
WEB_API_BASE=https://mockinterview-api-661893776515.us-west1.run.app
DEPLOY_ACCOUNT=mockinterview-deploy
RUNTIME_ACCOUNT=mockinterview-runtime
POOL=mockinterview-github
PROVIDER=github-deploy
APPLY=false
HOSTING=false

usage() {
  cat <<'EOF'
Usage: bash deploy/setup-github.sh [--plan | --apply] [options]
  --project ID --project-number NUMBER --region REGION
  --repo OWNER/REPO --repo-id NUMBER --owner-id NUMBER
  --service NAME --image-repository NAME --site NAME --web-api-base HTTPS_ORIGIN
  --deploy-account NAME --runtime-account NAME --pool NAME --provider NAME
  --acknowledge-project-wide-hosting

Default: print a local plan only; no cloud/GitHub requests or mutations.
--apply bootstraps API deployment, with no Hosting grants by default.
The separate Hosting flag grants Hosting Admin across ALL sites in the project.
It never grants Editor, Firebase Admin, API Keys Viewer, or secret payload access.
The runtime account/service must already exist. See docs/GITHUB-DEPLOYMENT.md.
EOF
}
die() { echo "Error: $*" >&2; exit 1; }
while (($#)); do
  case "$1" in
    --plan) APPLY=false; shift ;;
    --apply) APPLY=true; shift ;;
    --acknowledge-project-wide-hosting) HOSTING=true; shift ;;
    --help|-h) usage; exit 0 ;;
    --project|--project-number|--region|--repo|--repo-id|--owner-id|--service|--image-repository|--site|--web-api-base|--deploy-account|--runtime-account|--pool|--provider)
      (($# >= 2)) || die "Missing value for $1"
      case "$1" in
        --project) PROJECT=$2 ;; --project-number) PROJECT_NUMBER=$2 ;;
        --region) REGION=$2 ;; --repo) REPOSITORY=$2 ;;
        --repo-id) REPOSITORY_ID=$2 ;; --owner-id) OWNER_ID=$2 ;;
        --service) SERVICE=$2 ;; --image-repository) IMAGE_REPOSITORY=$2 ;;
        --site) SITE=$2 ;; --web-api-base) WEB_API_BASE=$2 ;;
        --deploy-account) DEPLOY_ACCOUNT=$2 ;; --runtime-account) RUNTIME_ACCOUNT=$2 ;;
        --pool) POOL=$2 ;; --provider) PROVIDER=$2 ;;
      esac
      shift 2 ;;
    *) die "Unknown argument: $1" ;;
  esac
done
[[ "$PROJECT" =~ ^[a-z][a-z0-9-]{4,28}[a-z0-9]$ ]] || die "Invalid project ID"
[[ "$PROJECT_NUMBER" =~ ^[0-9]+$ && "$REPOSITORY_ID" =~ ^[0-9]+$ && "$OWNER_ID" =~ ^[0-9]+$ ]] || die "Immutable IDs must be numeric"
[[ "$REPOSITORY" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || die "Invalid repository"
for name in "$REGION" "$SERVICE" "$IMAGE_REPOSITORY" "$SITE" "$POOL" "$PROVIDER"; do
  [[ "$name" =~ ^[a-z][a-z0-9-]{1,61}[a-z0-9]$ ]] || die "Invalid resource name: $name"
done
for name in "$DEPLOY_ACCOUNT" "$RUNTIME_ACCOUNT"; do
  [[ "$name" =~ ^[a-z][a-z0-9-]{4,28}[a-z0-9]$ ]] || die "Invalid service account name"
done
[[ "$DEPLOY_ACCOUNT" != "$RUNTIME_ACCOUNT" ]] || die "Deploy and runtime identities must differ"
[[ "$WEB_API_BASE" =~ ^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?$ ]] || die "WEB_API_BASE must be an HTTPS origin without path, credentials, or query"

DEPLOY_SA="$DEPLOY_ACCOUNT@$PROJECT.iam.gserviceaccount.com"
RUNTIME_SA="$RUNTIME_ACCOUNT@$PROJECT.iam.gserviceaccount.com"
MEMBER="serviceAccount:$DEPLOY_SA"
POOL_NAME="projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/$POOL"
PROVIDER_NAME="$POOL_NAME/providers/$PROVIDER"
PRINCIPAL="principalSet://iam.googleapis.com/$POOL_NAME/attribute.repository_id/$REPOSITORY_ID"
MARKER="Managed by mockinterview keyless CI: $REPOSITORY ($REPOSITORY_ID)"
WORKFLOW="$REPOSITORY/.github/workflows/deploy.yml@refs/heads/main"
MAPPING="google.subject=assertion.sub,attribute.repository_id=assertion.repository_id,attribute.repository_owner_id=assertion.repository_owner_id,attribute.ref=assertion.ref,attribute.workflow_ref=assertion.workflow_ref,attribute.event_name=assertion.event_name,attribute.environment=assertion.environment"
CONDITION="assertion.repository_id == '$REPOSITORY_ID' && assertion.repository_owner_id == '$OWNER_ID' && assertion.ref == 'refs/heads/main' && assertion.workflow_ref == '$WORKFLOW' && assertion.environment == 'production' && assertion.event_name in ['workflow_run', 'workflow_dispatch']"

cat <<EOF
Keyless CI target: $REPOSITORY -> $PROJECT ($PROJECT_NUMBER), $REGION
Deploy identity: $DEPLOY_SA
Runtime identity (existing): $RUNTIME_SA
Trust: $PROVIDER_NAME
Condition: $CONDITION
Grants:
  workloadIdentityUser on deploy identity to this repository in this dedicated pool
  artifactregistry.writer on $REGION/$IMAGE_REPOSITORY only
  run.developer on existing service $SERVICE only
  iam.serviceAccountUser on $RUNTIME_SA only
Hosting Admin on all project sites: $HOSTING (configured site: $SITE)
GitHub production environment: only branch main; preserve existing reviewers
Repository variables: WIF_PROVIDER, GCP_DEPLOY_SA, GCP_PROJECT, GCP_REGION,
  GCP_API_SERVICE, GCP_IMAGE_REPOSITORY, FIREBASE_SITE, WEB_API_BASE
EOF
if ! $APPLY; then
  echo 'Plan only. Use --apply after reviewing the scope and prerequisites.'
  exit 0
fi
for tool in gcloud gh jq; do command -v "$tool" >/dev/null || die "Install $tool first"; done
umask 077
CHECK_DIR=$(mktemp -d)
trap 'rm -rf "$CHECK_DIR"' EXIT

# All identity checks precede IAM changes. Read failures are fatal, never treated
# as evidence that a resource is absent. Dedicated resources carry an owner marker.
gh api "repos/$REPOSITORY" >"$CHECK_DIR/repo.json"
jq -e --argjson repo "$REPOSITORY_ID" --argjson owner "$OWNER_ID" --arg name "$REPOSITORY" \
  '.id == $repo and .owner.id == $owner and .full_name == $name and .default_branch == "main"' "$CHECK_DIR/repo.json" >/dev/null || die "GitHub immutable identity/name/default branch mismatch"
gcloud projects describe "$PROJECT" --format=json >"$CHECK_DIR/project.json"
jq -e --arg number "$PROJECT_NUMBER" '.projectNumber == $number and .lifecycleState == "ACTIVE"' "$CHECK_DIR/project.json" >/dev/null || die "GCP project number/state mismatch"
gcloud services list --enabled --project="$PROJECT" --format=json >"$CHECK_DIR/apis.json"
for api in iam.googleapis.com iamcredentials.googleapis.com sts.googleapis.com run.googleapis.com artifactregistry.googleapis.com; do
  jq -e --arg api "$api" 'any(.[]; .config.name == $api)' "$CHECK_DIR/apis.json" >/dev/null || die "Enable prerequisite API manually: $api"
done
gcloud iam service-accounts describe "$RUNTIME_SA" --project="$PROJECT" --format=json >"$CHECK_DIR/runtime.json"
jq -e --arg email "$RUNTIME_SA" '.email == $email and (.disabled // false) == false' "$CHECK_DIR/runtime.json" >/dev/null || die "Runtime identity mismatch/disabled"
gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" --format=json >"$CHECK_DIR/service.json"
jq -e --arg sa "$RUNTIME_SA" '.spec.template.spec.serviceAccountName == $sa' "$CHECK_DIR/service.json" >/dev/null || die "Cloud Run does not use the dedicated runtime identity"
gcloud iam service-accounts list --project="$PROJECT" --format=json >"$CHECK_DIR/accounts.json"
jq --arg sa "$DEPLOY_SA" '[.[] | select(.email == $sa)]' "$CHECK_DIR/accounts.json" >"$CHECK_DIR/deploy.json"
jq -e --arg marker "$MARKER" 'length == 0 or (length == 1 and .[0].description == $marker and (.[0].disabled // false) == false)' "$CHECK_DIR/deploy.json" >/dev/null || die "Existing deploy account is not this bootstrap's identity"
DEPLOY_EXISTS=$(jq 'length == 1' "$CHECK_DIR/deploy.json")
gcloud projects get-iam-policy "$PROJECT" --format=json >"$CHECK_DIR/project-policy.json"
jq -e --arg member "$MEMBER" \
  '[.bindings[]? | select(.members | index($member)) | .role] | all(. == "roles/firebasehosting.admin")' "$CHECK_DIR/project-policy.json" >/dev/null || die "Deploy account has unexpected project-wide roles; review them manually"
if $DEPLOY_EXISTS; then
  gcloud iam service-accounts keys list --iam-account="$DEPLOY_SA" --managed-by=user --project="$PROJECT" --format=json >"$CHECK_DIR/keys.json"
  jq -e 'length == 0' "$CHECK_DIR/keys.json" >/dev/null || die "Deploy account has user-managed keys; remove/review them manually"
  gcloud iam service-accounts get-iam-policy "$DEPLOY_SA" --project="$PROJECT" --format=json >"$CHECK_DIR/deploy-policy.json"
  jq -e --arg principal "$PRINCIPAL" \
    'all(.bindings[]?; .role == "roles/iam.workloadIdentityUser" and .members == [$principal] and (has("condition") | not))' "$CHECK_DIR/deploy-policy.json" >/dev/null || die "Deploy account has unexpected impersonation bindings"
fi
gcloud artifacts repositories list --project="$PROJECT" --location="$REGION" --format=json >"$CHECK_DIR/artifacts.json"
jq --arg suffix "/repositories/$IMAGE_REPOSITORY" '[.[] | select(.name | endswith($suffix))]' "$CHECK_DIR/artifacts.json" >"$CHECK_DIR/artifact.json"
jq -e --arg marker "$MARKER" 'length == 0 or (length == 1 and .[0].format == "DOCKER" and .[0].description == $marker)' "$CHECK_DIR/artifact.json" >/dev/null || die "Existing image repository is not this bootstrap's dedicated repository"
gcloud iam workload-identity-pools list --project="$PROJECT" --location=global --format=json >"$CHECK_DIR/pools.json"
jq --arg name "$POOL_NAME" '[.[] | select(.name == $name)]' "$CHECK_DIR/pools.json" >"$CHECK_DIR/pool.json"
jq -e --arg marker "$MARKER" 'length == 0 or (length == 1 and .[0].description == $marker and .[0].state == "ACTIVE" and (.[0].disabled // false) == false)' "$CHECK_DIR/pool.json" >/dev/null || die "Existing identity pool differs from this bootstrap"
echo '[]' >"$CHECK_DIR/providers.json"
if [[ $(jq length "$CHECK_DIR/pool.json") == 1 ]]; then
  gcloud iam workload-identity-pools providers list --project="$PROJECT" --location=global --workload-identity-pool="$POOL" --format=json >"$CHECK_DIR/providers.json"
fi
jq -e --arg name "$PROVIDER_NAME" --arg condition "$CONDITION" --arg marker "$MARKER" \
  'length == 0 or (length == 1 and .[0].name == $name and .[0].description == $marker and .[0].state == "ACTIVE" and (.[0].disabled // false) == false and .[0].attributeCondition == $condition and .[0].oidc.issuerUri == "https://token.actions.githubusercontent.com" and (.[0].oidc.allowedAudiences // []) == [] and .[0].attributeMapping == {"google.subject":"assertion.sub","attribute.repository_id":"assertion.repository_id","attribute.repository_owner_id":"assertion.repository_owner_id","attribute.ref":"assertion.ref","attribute.workflow_ref":"assertion.workflow_ref","attribute.event_name":"assertion.event_name","attribute.environment":"assertion.environment"})' \
  "$CHECK_DIR/providers.json" >/dev/null || die "Existing provider/pool trust differs; refusing to widen or replace it"

ENV_EXISTS=false
if gh api "repos/$REPOSITORY/environments/production" >"$CHECK_DIR/environment.json" 2>"$CHECK_DIR/environment.err"; then
  ENV_EXISTS=true
  jq -e '.deployment_branch_policy == {"protected_branches":false,"custom_branch_policies":true}' "$CHECK_DIR/environment.json" >/dev/null || die "Production environment has a different branch policy; review it manually"
  gh api "repos/$REPOSITORY/environments/production/deployment-branch-policies?per_page=100" >"$CHECK_DIR/branches.json"
  jq -e '.total_count <= 1 and all(.branch_policies[]; .name == "main" and .type == "branch")' "$CHECK_DIR/branches.json" >/dev/null || die "Production environment permits a different branch/tag"
else
  grep -q 'HTTP 404' "$CHECK_DIR/environment.err" || { cat "$CHECK_DIR/environment.err" >&2; die "Cannot inspect production environment"; }
  echo '{"total_count":0,"branch_policies":[]}' >"$CHECK_DIR/branches.json"
fi

if ! $DEPLOY_EXISTS; then
  gcloud iam service-accounts create "$DEPLOY_ACCOUNT" --project="$PROJECT" --description="$MARKER" --display-name='Mock Interview CI deploy'
fi
if [[ $(jq length "$CHECK_DIR/artifact.json") == 0 ]]; then
  gcloud artifacts repositories create "$IMAGE_REPOSITORY" --project="$PROJECT" --location="$REGION" --repository-format=docker --description="$MARKER"
fi
if [[ $(jq length "$CHECK_DIR/pool.json") == 0 ]]; then
  gcloud iam workload-identity-pools create "$POOL" --project="$PROJECT" --location=global --description="$MARKER" --display-name='Mock Interview GitHub'
fi
if [[ $(jq length "$CHECK_DIR/providers.json") == 0 ]]; then
  gcloud iam workload-identity-pools providers create-oidc "$PROVIDER" --project="$PROJECT" --location=global --workload-identity-pool="$POOL" \
    --description="$MARKER" --issuer-uri=https://token.actions.githubusercontent.com --attribute-mapping="$MAPPING" --attribute-condition="$CONDITION"
fi
gcloud iam service-accounts add-iam-policy-binding "$DEPLOY_SA" --project="$PROJECT" --role=roles/iam.workloadIdentityUser --member="$PRINCIPAL" --condition=None >/dev/null
gcloud artifacts repositories add-iam-policy-binding "$IMAGE_REPOSITORY" --project="$PROJECT" --location="$REGION" --role=roles/artifactregistry.writer --member="$MEMBER" --condition=None >/dev/null
gcloud run services add-iam-policy-binding "$SERVICE" --project="$PROJECT" --region="$REGION" --role=roles/run.developer --member="$MEMBER" --condition=None >/dev/null
gcloud iam service-accounts add-iam-policy-binding "$RUNTIME_SA" --project="$PROJECT" --role=roles/iam.serviceAccountUser --member="$MEMBER" --condition=None >/dev/null
if $HOSTING; then
  gcloud projects add-iam-policy-binding "$PROJECT" --role=roles/firebasehosting.admin --member="$MEMBER" --condition=None >/dev/null
else
  echo 'Hosting permissions were not added. Existing grants, if any, are unchanged.'
fi
if ! $ENV_EXISTS; then
  gh api --method PUT "repos/$REPOSITORY/environments/production" \
    --input - <<'JSON' >/dev/null
{"deployment_branch_policy":{"protected_branches":false,"custom_branch_policies":true}}
JSON
fi
if [[ $(jq .total_count "$CHECK_DIR/branches.json") == 0 ]]; then
  gh api --method POST "repos/$REPOSITORY/environments/production/deployment-branch-policies" -f name=main -f type=branch >/dev/null
fi
gh variable set WIF_PROVIDER --repo "$REPOSITORY" --body "$PROVIDER_NAME"
gh variable set GCP_DEPLOY_SA --repo "$REPOSITORY" --body "$DEPLOY_SA"
gh variable set GCP_PROJECT --repo "$REPOSITORY" --body "$PROJECT"
gh variable set GCP_REGION --repo "$REPOSITORY" --body "$REGION"
gh variable set GCP_API_SERVICE --repo "$REPOSITORY" --body "$SERVICE"
gh variable set GCP_IMAGE_REPOSITORY --repo "$REPOSITORY" --body "$IMAGE_REPOSITORY"
gh variable set FIREBASE_SITE --repo "$REPOSITORY" --body "$SITE"
gh variable set WEB_API_BASE --repo "$REPOSITORY" --body "$WEB_API_BASE"
echo 'API trust configured. No deploy has run. Verify CI with the reviewed main workflow.'
if ! $HOSTING; then echo 'Hosting is not provisioned by this run; configure its isolation/permission choice separately.'; fi
echo 'After Hosting setup and workflow review, enable PRODUCTION_DEPLOY_ENABLED in GitHub; see docs/GITHUB-DEPLOYMENT.md.'
