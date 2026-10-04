# Keyless GitHub deployment setup

`deploy/setup-github.sh` prepares Workload Identity Federation (WIF), resource-specific API deployment permissions, and GitHub repository variables. It does **not** build or deploy an application, create a service-account key, configure app secrets, provision a database, or change runtime permissions. Its default mode prints a local plan without contacting either service.

```sh
bash deploy/setup-github.sh --plan
```

The defaults target `tejovardhan-makineni/mockinterview` (repository ID `1363533004`, owner ID `35104991`) and Google Cloud project `storybytes-495010` (`661893776515`, `us-west1`). Fork maintainers must pass their own `--repo`, `--repo-id`, `--owner-id`, project, region, resource names, and API origin. `--help` lists every option. Repository names alone are insufficient: Google recommends immutable numeric IDs to prevent deleted-name reuse. [Google's deployment pipeline WIF guide](https://cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines).

## Prerequisites and explicit setup

An operator needs authenticated `gcloud` and `gh`, `jq`, permission to create the named dedicated service account/pool/provider/repository and edit their IAM policies, and repository administration permission. These are operator privileges; the script does not grant them to CI. Enable `iam.googleapis.com`, `iamcredentials.googleapis.com`, `sts.googleapis.com`, `run.googleapis.com`, and `artifactregistry.googleapis.com` separately first.

The existing `mockinterview-api` Cloud Run service must already use `mockinterview-runtime@storybytes-495010.iam.gserviceaccount.com`. Review that runtime identity's access before setup. Existing bootstrap-owned resources must have the exact ownership description written by this script. It refuses to adopt a similarly named account/repository/pool, overwrite different federation trust, reuse a deploy identity with user-managed keys or unexpected project-level roles, or loosen an existing GitHub production environment. Resolve a mismatch manually after reviewing it; do not remove the checks.

After reviewing the plan, an operator explicitly runs:

```sh
bash deploy/setup-github.sh --apply
```

This default apply configures **API deployment only**. The Hosting variables are recorded for the workflow, but recording a site name does not authorize a web deploy. The script is additive and repeatable: it preserves existing reviewers, does not revoke earlier Hosting grants when rerun without the optional flag, and stops on failures. After a partial failure, inspect the error and rerun with the same reviewed settings. It does not automatically roll back IAM changes that succeeded.

Production deployment stays inactive until the operator sets the repository
variable `PRODUCTION_DEPLOY_ENABLED=true`. An unset or false value lets automatic
post-merge runs finish with a setup notice before any build, cloud authentication
or deployment. Explicit manual release attempts fail clearly while inactive.
CI, security scans and desktop package checks continue to run for every PR and
merge. This switch does not bypass any release or current-main checks.

## Trust and permissions

The dedicated provider accepts only the exact immutable repository/owner IDs, `refs/heads/main`, `.github/workflows/deploy.yml@refs/heads/main`, `workflow_run` or `workflow_dispatch` events, and the explicit `production` environment claim. This supports GitHub’s legacy and newer immutable-ID subject formats without weakening the immutable repository/owner checks. The pool may contain only this expected provider. Its repository-specific principal set may impersonate only `mockinterview-deploy@storybytes-495010.iam.gserviceaccount.com` through `roles/iam.workloadIdentityUser`.

The production environment permits the `main` branch only. Existing reviewers and other environment protections are preserved. Protect `main` and review changes to deployment workflows: code accepted into that trusted workflow can use the deploy identity. Keep pull-request validation jobs separate from cloud authentication and never execute untrusted PR artifacts after obtaining credentials. [GitHub OIDC claims](https://docs.github.com/en/actions/reference/security/oidc), [deployment branch policies](https://docs.github.com/en/rest/deployments/branch-policies).

| Grant to deploy identity | Binding scope |
| --- | --- |
| `roles/artifactregistry.writer` | The dedicated `mockinterview` Docker repository in `us-west1` |
| `roles/run.developer` | The existing `mockinterview-api` Cloud Run service |
| `roles/iam.serviceAccountUser` | The dedicated `mockinterview-runtime` service account |
| Optional `roles/firebasehosting.admin` | Entire Firebase/GCP project; see the limitation below |

There is no project-level Cloud Run Developer/Editor, Firebase Admin, service-account administration, API Keys Viewer, direct Secret Manager payload, database, or storage grant. Container deploys require the service, image, and runtime identity permissions above. [Cloud Run deployment permissions](https://cloud.google.com/run/docs/reference/iam/roles#additional-configuration).

This is a **deployment** security boundary, not separation from this app's own runtime data: a trusted deployer can run code as `mockinterview-runtime`, which can use its configured app secrets and database access. Restrict that runtime identity to this application. Bootstrap checks do not prove absence of inherited organization/group grants or grants on every other resource; operators must audit those when reusing a cloud project.

## Firebase Hosting in a shared project

Do not claim `FIREBASE_SITE=mockinterview-web` provides IAM isolation. It limits normal workflow targeting, but project Hosting permissions can affect other sites. Firebase's current documentation says custom roles cannot control Hosting, its Hosting API exposes no site-level IAM policy methods, and Hosting is absent from the supported IAM Conditions resource-attribute list. There is no documented supported site-only binding to substitute here. [Firebase permissions](https://firebase.google.com/docs/projects/iam/permissions#hosting), [Hosting API](https://firebase.google.com/docs/reference/hosting/rest), [IAM Conditions resource attributes](https://cloud.google.com/iam/docs/conditions-resource-attributes).

For strict isolation from other applications, use a separate Firebase project for this site's hosting and configure the workflow's Firebase project/authentication separately. Moving an existing site/domain is a separate migration; this bootstrap does not perform it.

If the owner accepts access to **every Hosting site in this shared project**, a separate explicit invocation adds the narrowest supported Hosting write role:

```sh
bash deploy/setup-github.sh --apply --acknowledge-project-wide-hosting
```

This role can create, update, and delete Hosting resources across the project. It is narrower than Firebase Admin or Editor but still exceeds one-site isolation. [Hosting role permissions](https://cloud.google.com/iam/docs/roles-permissions/firebasehosting).

The script deliberately does not grant API Keys Viewer. Firebase's general CLI documentation mentions that additional role, but the inspected static Hosting CLI path checks project access and Hosting site updates, creates a Hosting version, and uploads/releases static files; it does not need a Firebase app API key in that path. Validate the exact pinned CLI and static workflow with the provisioned identity. If a future CLI or added framework/function feature requires more access, stop and review it instead of widening permissions automatically. No successful authenticated Hosting deploy is implied by this source review. [Firebase CLI general role guidance](https://firebase.google.com/docs/projects/iam/roles-predefined-product-categories#hosting), [static Hosting prepare implementation](https://github.com/firebase/firebase-tools/blob/v15.24.0/src/deploy/hosting/prepare.ts), [CLI permission checks](https://github.com/firebase/firebase-tools/blob/v15.24.0/src/requirePermissions.ts).

## Repository variables and validation

Bootstrap writes ordinary repository variables, never credentials:

| Variable | Default |
| --- | --- |
| `WIF_PROVIDER` | `projects/661893776515/locations/global/workloadIdentityPools/mockinterview-github/providers/github-deploy` |
| `GCP_DEPLOY_SA` | `mockinterview-deploy@storybytes-495010.iam.gserviceaccount.com` |
| `GCP_PROJECT` | `storybytes-495010` |
| `GCP_REGION` | `us-west1` |
| `GCP_API_SERVICE` | `mockinterview-api` |
| `GCP_IMAGE_REPOSITORY` | `mockinterview` (repository name, not a full image URL) |
| `FIREBASE_SITE` | `mockinterview-web` |
| `WEB_API_BASE` | `https://mockinterview-api-661893776515.us-west1.run.app` |

Bootstrap does not enable deployment automatically. After configuring the Hosting
permission choice, checking the variables and production environment, and reviewing
the deployment workflow, activate it with:

```sh
gh variable set PRODUCTION_DEPLOY_ENABLED --repo tejovardhan-makineni/mockinterview --body true
```

Run **Deploy production / Release web** manually with an empty version to verify
the first deployment; no semantic version is created. Later checked merges deploy
automatically. To stop new deployments, set the same variable to `false`; this
does not cancel an in-progress deployment or interrupt its rollback handling.
The first authenticated deployment must still verify the real cloud permissions
and readiness checks; setting the variable is not evidence of a successful deploy.

Local validation needs no cloud credentials:

```sh
bash -n deploy/setup-github.sh
node --test deploy/setup-github.test.mjs
```

After operator setup, validate federation and an approved API candidate from the reviewed `main` deployment workflow. Verify immutable image/version provenance, service runtime identity, health checks, and traffic promotion before calling deployment complete. Web deployment remains blocked until the Hosting isolation/permission decision is implemented and tested. Do not merge or release while required security checks are failing.
