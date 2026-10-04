# Dependency security review

Reviewed 2026-10-04 against the committed npm lockfiles. This is a dated assessment, not a claim that all dependency vulnerabilities have been fixed. Rerun the audit before release; advisories and registry releases can change.

## Current status

| Dependency tree | Full npm audit                       | Policy result                     | Remaining scope                                                                                      |
| --------------- | ------------------------------------ | --------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Web             | 5 high package findings, 0 critical  | Existing temporary lint exception | One underlying `braces` advisory in the Next ESLint dependency chain                                 |
| Mobile          | 16 high package findings, 0 critical | **Blocked**                       | Two underlying advisories in `braces` and `node-forge`, inherited by Expo/Metro/React Native tooling |
| Desktop         | 0 findings                           | Passed                            | This covers Electron packaging dependencies; the bundled web and Go runtime need their own checks    |

Package finding counts include dependencies that inherit an underlying advisory; they are not counts of distinct vulnerabilities. Mobile has no exception. The existing web exception is not a fix or a zero-vulnerability result. Do not merge or release on an “all security issues fixed” claim while these findings remain unresolved.

## Run and retain the checks

Use Node 22 and npm 10. From the repository root:

```sh
node --test scripts/security-audit.test.mjs web/scripts/security-audit.test.mjs
node scripts/security-audit.mjs web --report-dir audit-reports
node scripts/security-audit.mjs mobile --report-dir audit-reports
node scripts/security-audit.mjs desktop --report-dir audit-reports
```

Each package also exposes `npm run audit:security`. The runner explicitly includes development, optional, and peer dependencies. It rejects incomplete reports, unexpected finding counts, unknown lockfile nodes, and audit failures. Mobile and desktop reject every high or critical finding. It emits the raw npm report and a decision report containing the audit time, lockfile SHA-256, accepted findings, and blocked findings. Keep these reports with CI artifacts. An audit service error is a failed check, not a clean result.

The existing web assessor only accepts the exact reviewed advisory through `eslint-config-next → @next/eslint-plugin-next → fast-glob → micromatch → braces`. All affected nodes must stay development-only, and `braces` must remain the reviewed version 3.0.3. It rejects other advisories and expires at **2026-11-04 00:00 UTC**. Its scope and deadline have not been expanded for mobile. Web's separate production-only npm audit currently has zero findings; that does not erase its lint-tool findings.

## Unresolved advisories and reachability

### `braces` 3.0.3

[GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) affects versions through 3.0.3 and lists no patched version. Deeply nested brace patterns can exhaust recursive AST processing. Version 3.0.3 was also the latest npm release at review time.

The web path is Next's ESLint file globbing. The mobile paths include Expo's and React Native's Metro file watchers through `micromatch`; their watcher helpers match repository paths against fixed or configured glob patterns. This is build/development input, not interview content submitted in the application. Untrusted repository or tool configuration is still relevant to developer and CI availability. Removing the entire lint or Metro toolchain, or aliasing `micromatch` to an incompatible glob API, would sacrifice correctness rather than provide a compatible security update.

### `node-forge` 1.4.0

[GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv) affects versions through 1.4.0 and lists no patched version. RSA PKCS#1 v1.5 verification accepts extra nested algorithm elements, allowing signature forgery under the advisory's low-exponent key conditions. Version 1.4.0 was the latest npm release at review time.

The mobile dependency comes from Expo CLI and `@expo/code-signing-certificates`. The latter calls Forge to verify certificates, signatures, and certificate signing requests. These are actual verification operations in development/signing tooling; it is not accurate to treat Forge as an unused package simply because the app does not import it. The app has no configured Expo update-signing certificate, but that is insufficient to prove every CLI verification path unreachable.

The latest available Expo 57 patch and code-signing package still depend on affected Forge versions. Upstream [PR #1152](https://github.com/digitalbazaar/forge/pull/1152) remained open, with related [NULL parameter validation work #1157](https://github.com/digitalbazaar/forge/pull/1157) also open. Applying an unmerged cryptographic patch and inventing a patched version number would not establish a supported security fix. A maintained replacement would need certificate, key, CSR, and signature compatibility review, not only a changed package name.

### Runtime bundle evidence

The current mobile project was exported for all three platforms with source maps:

```sh
cd mobile
npx expo export --platform all --source-maps --output-dir /tmp/mockinterview-security-mobile-export --max-workers 2
```

Inspection of every generated map's `sources` (including nested map sections) found no `node_modules/braces`, `node_modules/micromatch`, or `node_modules/node-forge` modules in the Android, iOS, or web application bundles. The respective maps contained 683, 685, and 329 sources. This supports the limited conclusion that those packages are tooling dependencies in these exports. It does not certify the tools, future configurations, native installers, or a future dependency tree as unaffected. Mobile type checking and 12 unit tests passed; successful builds do not resolve the advisories.

## Resolution requirements

Keep the mobile check blocking until a compatible upstream update or a separately reviewed maintained replacement removes both affected dependency paths. Do not use `npm audit fix --force` recommendations that downgrade Expo/React Native or Next to unsupported older major versions, classify required build dependencies as development-only just to hide findings, or dismiss alerts without evidence. A local patch would still need explicit provenance, regression and compatibility tests, and a new security review; it must not silently bypass audit findings.

Dependabot covers web, mobile, desktop, Go, and GitHub Actions weekly. When upstream releases a fix, update the lockfile, rerun the complete audits and platform builds, remove any now-unnecessary exception, and verify the corresponding GitHub alerts close from the actual default-branch dependency change.
