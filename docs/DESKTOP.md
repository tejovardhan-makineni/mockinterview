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
- “Share analytics” and “Share interview results” are separate, initially-off preferences. Consent timestamps persist across app restarts. Sharing failures do not prevent local practice or erase results.
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

`.github/workflows/desktop-build.yml` builds four native targets, runs boundary/storage tests, launches each staged and packaged engine, verifies no-key interview denial and restart persistence, then uploads installer artifacts. All publishing is disabled in electron-builder. An explicit workflow dispatch with `publish_draft=true` creates a **draft prerelease** only; publishing remains an owner action after review.

Configure these repository secrets to sign distribution builds:

| Secret                                                                             | Purpose                                                                                                 |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `DESKTOP_CSC_LINK`                                                                 | macOS Developer ID Application certificate, encoded or securely hosted as supported by electron-builder |
| `DESKTOP_CSC_KEY_PASSWORD`                                                         | Password for that certificate                                                                           |
| `DESKTOP_APPLE_ID`, `DESKTOP_APPLE_APP_SPECIFIC_PASSWORD`, `DESKTOP_APPLE_TEAM_ID` | Apple notarization credentials                                                                          |
| `DESKTOP_WIN_CSC_LINK`, `DESKTOP_WIN_CSC_KEY_PASSWORD`                             | Windows code-signing certificate and password supported by the configured signer                        |

Modern Windows signing certificates may require a hardware token or cloud signing service; adapt the CI signer to the actual certificate provider rather than exporting a non-exportable key. See [electron-builder signing](https://www.electron.build/v26/docs/code-signing) and [macOS configuration](https://www.electron.build/v26/docs/mac/).

Without a Developer ID identity, macOS packaging explicitly uses an ad-hoc development signature. Without Windows credentials, the Windows package is unsigned. Neither is represented as a trusted public installer. A macOS Apple Development or App Store Apple Distribution certificate is not a substitute for Developer ID Application notarization.

## Release verification

Before public release on every OS:

1. Install using the actual downloadable artifact in a clean user account; verify expected publisher/signature and macOS notarization.
2. Open without developer prerequisites, confirm local history survives quit/reopen, and test an app upgrade preserves it.
3. Confirm missing/invalid AI keys cannot start an interview. Validate a real user-owned key, then exercise a short text and microphone/WebSocket interview, report, workspace, export and history.
4. Verify microphone/camera prompts, editor and drawing input, keyboard navigation, external community links and the Help menu.
5. Keep analytics off and confirm no project sharing; enable each consent independently, check server reachability failures do not block practice, and verify the admin receives only the consented payload.
6. Confirm all checksums, update release notes with tested platforms and actual signing status, publish the GitHub release, then enable website download links for those exact files.

## Security boundaries

The renderer has no Node integration, no remote modules, context isolation and an OS sandbox. A minimal preload exposes only validated consent/theme preference methods; IPC accepts the exact main frame and local app origin. There is no generic file, command, shell or secret access from the renderer.

The Go engine listens only on `127.0.0.1` at a random port. The main process generates a new bridge token per launch and injects it into requests only for that exact HTTP/WebSocket origin. The token is never exposed to page JavaScript. The server additionally rejects incorrect Host/Origin/bridge headers. Environment variables passed to the child are allowlisted so hosted API keys, production database URLs, proxies and development overrides cannot be inherited accidentally.

All rendered assets are packaged. CSP denies remote scripts/frames; renderer networking stays on the exact app origin. The Go sharing proxy has a fixed hosted destination and a small route allowlist, excluding interviews and provider validation. External links use parsed HTTPS host/path allowlists and open in the default browser. Electron fuses disable RunAsNode, Node environment flags, CLI inspection and extra file-protocol privileges; packaged app code loads from ASAR, with integrity validation on supported macOS/Windows builds.

Security design follows [Electron security guidance](https://www.electronjs.org/docs/latest/tutorial/security), [safeStorage platform behavior](https://www.electronjs.org/docs/latest/api/safe-storage) and [Electron fuses](https://www.electronjs.org/docs/latest/tutorial/fuses).
