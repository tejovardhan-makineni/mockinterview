# Desktop downloads

Mock Interview Desktop packages the existing web interface and Go interview engine in Electron. Users install and open it; they do not need Node, Go, Docker, PostgreSQL or a terminal.

Desktop requires a personal AI provider key for every interview. It does not use the project's hosted/free AI allowance. The website remains separate and offers one free interview per day, subject to the hosted account policy. Personal provider charges and network access still apply in the desktop app.

## Distribution

The project uploads installers to **[GitHub Releases](https://github.com/tejovardhan-makineni/mockinterview/releases)**. GitHub serves the files; the website's download buttons link to those assets. No download server or Firebase storage bucket is needed. Repository owners control uploads and releases. GitHub's [release documentation](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases) describes hosting limits.

Targets:

| Platform            | Package                           |
| ------------------- | --------------------------------- |
| macOS Apple Silicon | arm64 `.dmg`, `.zip`              |
| macOS Intel         | x64 `.dmg`, `.zip`                |
| Windows x64         | `.exe` installer                  |
| Linux x64           | `.AppImage`, Debian/Ubuntu `.deb` |

This first desktop version is a preview. A completed CI artifact is not automatically a public download. Before publishing, verify signing, notarization and the manual platform checklist below. Linux requires a normal graphical desktop with an unlocked GNOME Keyring or KWallet. The app refuses Electron's insecure plaintext fallback. Do not advise users to disable sandboxing or operating-system protections.

## Local data and privacy

- The SQLite database, installation keys and consent preferences live under the OS app-data folder. **Help → Open app data folder** locates it.
- Keep the entire app-data directory together when backing up. Installation keys are encrypted by the OS keychain; moving them to another account or computer will not necessarily unlock them. Use app-level exports for portable interview content.
- AI keys entered in the interface are not stored by the Electron preferences bridge. The interview engine encrypts keys needed for active interview sessions using the per-install key; ordinary local history is not whole-database encrypted. OS account permissions and disk encryption protect the device.
- “Share analytics” starts on for a new installation; an existing saved off choice is preserved. “Share interview results” remains a separate, initially-off preference. Sharing requires a connected hosted account, and preferences persist across app restarts. Sharing failures do not prevent local practice or erase results.
- AI provider processing is separate from project analytics. A cloud provider receives the interview content needed to run the selected model, and may charge the user's account.
- The Help menu links to GitHub, Discord and Reddit, plus the repository's release page. Updates are explicit downloads. No automatic code installation is enabled.

## Build from source

For contributors only, install Node 22/npm 10 and the Go version in `api/go.mod`:

```sh
npm ci --prefix web
npm ci --prefix desktop
npm --prefix desktop test
npm --prefix desktop run build:runtime
npm --prefix desktop run smoke
npm --prefix desktop start
```

`build:runtime` creates a fresh static desktop export, compiles a native Go binary, and stages only the exported UI, executable, corpus, formats, packs, dependency notices and build metadata into `desktop/resources`. It does not copy `.env`, databases, source credentials or development dependencies into the app. `DESKTOP_TARGET_OS` and `DESKTOP_TARGET_ARCH` select the Go target; package matching Electron architecture on the platform runner.

```sh
npm --prefix desktop run dist
npm --prefix desktop run checksums
```

Artifacts appear under `desktop/dist`. `npm --prefix desktop run pack` makes an unpacked app for inspection. Use the generated `SHA256SUMS.txt` when distributing files. The first package version is `0.1.0-beta.1`; desktop tags use `desktop-v0.1.0-beta.1` to stay separate from web/API releases.

## CI and signing

`.github/workflows/desktop-build.yml` builds four native targets on ordinary pushes and pull requests, runs boundary/storage tests, launches each staged and packaged engine, verifies no-key interview denial and restart persistence, then uploads installer artifacts. All publishing is disabled in electron-builder.

For a public release, run **Release desktop** on `main` with a new `version` and `target`: `all`, `linux`, `macos`, or `windows`. A platform can ship independently; macOS always includes both Apple Silicon and Intel. The workflow builds only the selected platforms, verifies their complete native receipts and file hashes, creates a draft, checks the uploaded bytes, and publishes after rechecking source and CI gates. Existing versions, including drafts, cannot be reused.

```sh
gh workflow run release-desktop.yml --ref main -f version=0.1.0-beta.2 -f target=linux
```

Use a newer version if that example version already exists. Linux requires no Apple or Windows credentials. macOS and Windows still require the signing configuration below; selecting another platform never makes unsigned assets public. Published betas appear on Downloads with a beta label after their metadata and native receipts are verified. Releasing one platform preserves the latest verified downloads for the others. Website refresh also requires production deployment to be enabled and configured.

Configure these secrets in GitHub → repository Settings → Environments → `desktop-release` (repository secrets are also supported). Enter credentials there, never in a chat, source file or commit:

| Secret                                                                             | Purpose                                                                                                 |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `DESKTOP_CSC_LINK`                                                                 | macOS Developer ID Application certificate, encoded or securely hosted as supported by electron-builder |
| `DESKTOP_CSC_KEY_PASSWORD`                                                         | Password for that certificate                                                                           |
| `DESKTOP_APPLE_ID`, `DESKTOP_APPLE_APP_SPECIFIC_PASSWORD`, `DESKTOP_APPLE_TEAM_ID` | Apple notarization credentials                                                                          |
| `DESKTOP_WIN_CSC_LINK`, `DESKTOP_WIN_CSC_KEY_PASSWORD`                             | Windows code-signing certificate and password supported by the configured signer                        |

Also set the `DESKTOP_WINDOWS_PUBLISHER` environment variable to the exact certificate subject name expected by Authenticode verification.

Modern Windows signing certificates may require a hardware token or cloud signing service; adapt the CI signer to the actual certificate provider rather than exporting a non-exportable key. See [electron-builder signing](https://www.electron.build/v26/docs/code-signing) and [macOS configuration](https://www.electron.build/v26/docs/mac/).

The desktop `postinstall` temporarily corrects a macOS keychain password bug in `app-builder-lib` 26.15.3: certificate import keeps the P12 password, while key access setup uses the generated keychain password. The script accepts only that version and the complete original or corrected source hash, and fails installation on an unknown dependency. Review and remove the workaround when upgrading to an upstream fix; do not bypass installation scripts for release builds. Developer ID, hardened runtime, notarization and native verification remain required.

Without a Developer ID identity, macOS packaging explicitly uses an ad-hoc development signature. Without Windows credentials, the Windows package is unsigned. Neither is represented as a trusted public installer. A macOS Apple Development or App Store Apple Distribution certificate is not a substitute for Developer ID Application notarization.

## Release verification

For each platform, validate native release signatures and checksums in CI. Before promoting a beta as a fully tested stable desktop release, also complete these manual checks:

1. Install using the actual downloadable artifact in a clean user account; verify expected publisher/signature and macOS notarization.
2. Open without developer prerequisites, confirm local history survives quit/reopen, and test an app upgrade preserves it.
3. Confirm missing/invalid AI keys cannot start an interview. Validate a real user-owned key, then exercise a short text and microphone/WebSocket interview, report, workspace, export and history.
4. Verify microphone/camera prompts, editor and drawing input, keyboard navigation, external community links and the Help menu.
5. Turn analytics off and confirm no project sharing; verify an existing off choice survives upgrade. Enable each sharing preference independently, check server reachability failures do not block practice, and verify that result sharing stays off until explicitly enabled.
6. Confirm all checksums, update release notes with tested platforms and actual signing status, publish the GitHub release, then enable website download links for those exact files.

## Security boundaries

The renderer has no Node integration, no remote modules, context isolation and an OS sandbox. A minimal preload exposes only validated consent/theme preference methods; IPC accepts the exact main frame and local app origin. There is no generic file, command, shell or secret access from the renderer.

The Go engine listens only on `127.0.0.1` at a random port. The main process generates a new bridge token per launch and injects it into requests only for that exact HTTP/WebSocket origin. The token is never exposed to page JavaScript. The server additionally rejects incorrect Host/Origin/bridge headers. Environment variables passed to the child are allowlisted so hosted API keys, production database URLs, proxies and development overrides cannot be inherited accidentally.

All rendered assets are packaged. CSP denies remote scripts/frames; renderer networking stays on the exact app origin. The Go sharing proxy has a fixed hosted destination and a small route allowlist, excluding interviews and provider validation. External links use parsed HTTPS host/path allowlists and open in the default browser. Electron fuses disable RunAsNode, Node environment flags, CLI inspection and extra file-protocol privileges; packaged app code loads from ASAR, with integrity validation on supported macOS/Windows builds.

Security design follows [Electron security guidance](https://www.electronjs.org/docs/latest/tutorial/security), [safeStorage platform behavior](https://www.electronjs.org/docs/latest/api/safe-storage) and [Electron fuses](https://www.electronjs.org/docs/latest/tutorial/fuses).

For local desktop troubleshooting, create an empty `diagnostics.enabled` file in the app-data folder and restart, or launch with `--diagnostics`. This writes startup stages, HTTP status codes with sanitized route categories, and generic renderer failure metadata to `desktop-diagnostics.jsonl` on that computer. It does not record request bodies, headers, tokens, query strings, interview text, or console message text, and it is never uploaded. Remove the marker and restart to stop logging. Diagnostics additionally enables the native accessibility tree on macOS/Windows for UI inspection; normal builds use Electron's automatic accessibility detection.
