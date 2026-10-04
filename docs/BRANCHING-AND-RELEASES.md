# Branches, deployments and releases

`main` is the primary branch. There is no `master` branch. Contributors work on
short-lived branches or forks and open pull requests against `main`. Squash merge
keeps a readable history; branch deletion and force pushes to `main` are blocked.

## Before merging

The repository rules require an up-to-date branch, resolved review conversations,
Go build/race tests, web lint/tests/export, mobile tests, all four desktop packages,
local setup checks, release-policy checks, dependency audits, a secret scan and
CodeQL. CodeQL alerts block merges as well as scanner execution failures.
Maintainers review behavior and compatibility before enabling auto-merge; a green
build alone is not a review. Auto-merge is opt-in per PR and cannot bypass checks.

Fork PRs receive read-only tokens and no signing/cloud credentials. The project is
MIT licensed; original contributions must be compatible with MIT and identify
third-party sources. No CLA, payment or external account is required to contribute.
Do not include real interview data, provider keys or confidential questions.
Report vulnerabilities through the private security reporting link in SECURITY.md.

Current dependency blockers and the one existing, time-limited web lint exception
are documented in [DEPENDENCY_SECURITY.md](DEPENDENCY_SECURITY.md). The mobile
audit deliberately fails while its two unpatched advisories remain. Do not remove
that required check, dismiss an alert without fixing it, or expand an exception to
publish a release.

## Every merged PR: deploy without a version bump

CI, Security and Desktop packages run on the resulting `main` commit. The
**Deploy production / Release web** workflow waits for all three successful runs
for that exact commit. Superseded commits are skipped. It also checks for open
CodeQL alerts. It does not run privileged deployment code from PR branches.

The build job has no cloud identity or write token. A separate deployment job
uses GitHub OIDC and a dedicated Google service account, receives artifacts from
the same run, and deploys a no-traffic Cloud Run candidate and a Firebase preview.
The standalone Firebase deployment tool is pinned by version, size and SHA-256;
it is downloaded in the unprivileged build job and reverified before cloud auth.
Deployment and rollback never install a fresh npm dependency tree.
It verifies readiness/build identity, rechecks current `main` and gates, captures
rollback targets, promotes the API and website, and checks them again. A failed
promotion attempts both rollbacks and fails visibly if either cannot be restored.
Deployment receipts record the source commit, image digest and rollback targets.

API deployment changes only the image and RELEASE_SHA, retaining existing runtime
identity, database, secret references, environment and scaling settings. Schema
migrations must remain compatible with the previous serving version: restoring
traffic does not reverse database migrations. Interview/provider billing smoke
tests and manual UX checks are separate from the readiness probes.

Routine deployments reuse the latest stable `web-v*` release version, initially
the web package version. The UI displays the version; Settings also displays a
short build commit. A new deployment is identifiable without creating a new
minor version or noisy GitHub release.

## Release a new web version

1. Merge the desired changes and wait for all `main` checks to pass.
2. Open GitHub Actions → **Deploy production / Release web** → **Run workflow**.
3. Select `main` and enter an explicit stable version such as `0.1.1` or `0.2.0`.

The workflow rejects older/reused versions and existing tags, deploys the selected
version, and publishes `web-vX.Y.Z` with generated notes and build metadata only
after successful deployment. Leave the version empty to retry a normal deployment
without a new release. Patch/minor/major choice is a maintainer decision, not tied
to the number of PRs. Version numbers are resolved from release tags and injected
at build time; source package versions are local-development baselines.

## Release a new desktop version

1. Configure and verify the signing prerequisites below once.
2. Merge changes and wait for all `main` checks to pass.
3. GitHub Actions → **Release desktop** → **Run workflow**, select `main` and
   enter a newer version such as `0.1.0-beta.2` or `1.0.0`.

The workflow builds Apple Silicon/Intel macOS, Windows x64 and Linux x64 from the
same source, injecting the requested desktop version into the disposable build
checkout. It verifies the actual packaged runtime, macOS Developer ID signatures,
notarization/stapling and Gatekeeper, and Windows Authenticode publisher identity.
Linux artifacts carry checksums but are not described as platform-code-signed.

Each runner produces a signing receipt bound to its version, commit, run and
installer hashes. The publisher verifies every receipt and checksum, uploads a
draft, compares GitHub's asset sizes/digests, rechecks the source/gates/tag, then
publishes. Tags and published versions are immutable: never replace public
installer files with different bytes under the same version.

GitHub Releases hosts the files. After publication, the workflow redeploys the
website without a web-version bump. Complete, verified **stable** desktop releases
appear on Downloads automatically; prereleases are available through their
explicit GitHub release page. The app's Help menu links to releases for manual
updates. This pipeline does not silently install updates or close active interviews.

If an upload/signing run fails, no partial draft is promoted. Inspect the failure;
a version whose tag/draft was created stays reserved. Use a new version for a new
build. Do not replace an old published version or remove tag protection to retry.

## One-time configuration and current limits

Run the documented [GitHub deployment bootstrap](GITHUB-DEPLOYMENT.md). It uses
short-lived OIDC credentials, not stored Google service-account keys. The production
and desktop-release GitHub environments accept only `main`.

Desktop environment secrets:

- `DESKTOP_CSC_LINK`, `DESKTOP_CSC_KEY_PASSWORD`: Developer ID Application certificate.
- `DESKTOP_APPLE_ID`, `DESKTOP_APPLE_APP_SPECIFIC_PASSWORD`, `DESKTOP_APPLE_TEAM_ID`:
  Apple notarization account and team.
- `DESKTOP_WIN_CSC_LINK`, `DESKTOP_WIN_CSC_KEY_PASSWORD`: Windows signing certificate.
- Environment variable `DESKTOP_WINDOWS_PUBLISHER`: exact certificate subject name.

No public release bypasses missing or invalid signing credentials. The existing
unsigned/ad-hoc `0.1.0-beta.1` draft remains a draft. Before the first public release,
complete clean installation, upgrade/data-preservation and microphone checks on
each supported platform. Automated startup tests do not certify microphone/AI
quality. The current mobile dependency failures also block all production releases.

Firebase Hosting cannot currently be scoped by IAM to one site in a shared
project. Decide between a dedicated Hosting project or explicitly granting the
documented project-wide Hosting role. Bootstrap does not grant that broader role
by default. Until Hosting permissions and signing credentials are configured and
the required audits pass, the release workflow is prepared, not production-ready.
