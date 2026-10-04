# Dependency security review

Reviewed 2026-10-04 against the committed npm lockfiles. This is a dated assessment, not a claim that all dependency vulnerabilities have been fixed. Rerun the audit before release; advisories and registry releases can change.

## Current status

| Dependency tree | Full npm audit                      | Policy result                     | Remaining scope                                                                                   |
| --------------- | ----------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------- |
| Web             | 5 high package findings, 0 critical | Existing temporary lint exception | One underlying `braces` advisory in the Next ESLint dependency chain                              |
| Desktop         | 0 findings                          | Passed                            | This covers Electron packaging dependencies; the bundled web and Go runtime need their own checks |

Package finding counts include dependencies that inherit an underlying advisory; they are not counts of distinct vulnerabilities. Desktop has no exception. The existing web exception is not a fix or a zero-vulnerability result. Do not describe a policy pass as “all security issues fixed” while this finding remains unresolved.

## Run and retain the checks

Use Node 22 and npm 10. From the repository root:

```sh
node --test scripts/security-audit.test.mjs web/scripts/security-audit.test.mjs
node scripts/security-audit.mjs web --report-dir audit-reports
node scripts/security-audit.mjs desktop --report-dir audit-reports
```

Each package also exposes `npm run audit:security`. The runner explicitly includes development, optional, and peer dependencies. It rejects unsupported projects, incomplete reports, unexpected finding counts, unknown lockfile nodes, and audit failures. Desktop rejects every high or critical finding. Web rejects every high or critical finding outside its exact dated exception. The runner emits the raw npm report and a decision report containing the audit time, lockfile SHA-256, accepted findings, and blocked findings. Keep these reports with CI artifacts. An audit service error is a failed check, not a clean result.

The existing web assessor only accepts the exact reviewed advisory through `eslint-config-next → @next/eslint-plugin-next → fast-glob → micromatch → braces`. All affected nodes must stay development-only, and `braces` must remain the reviewed version 3.0.3. It rejects other advisories and expires at **2026-11-04 00:00 UTC**. Its scope and deadline have not been expanded. Web's separate production-only npm audit currently has zero findings; that does not erase its lint-tool findings.

## Unresolved advisory and reachability

[GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) affects `braces` versions through 3.0.3 and lists no patched version. Deeply nested brace patterns can exhaust recursive AST processing. Version 3.0.3 was also the latest npm release at review time.

The web path is Next's ESLint file globbing. This processes repository paths and lint configuration, not interview content submitted in the application, and is absent from the deployed static export. Untrusted repository or tool configuration remains relevant to developer and CI availability. Removing required lint checks or aliasing `micromatch` to an incompatible glob API would sacrifice correctness rather than provide a compatible security update.

## Resolution requirements

Do not use `npm audit fix --force` recommendations that downgrade Next to an unsupported older major version, reclassify required dependencies just to hide findings, or dismiss alerts without evidence. A local patch would need explicit provenance, regression and compatibility tests, and a new security review; it must not silently bypass audit findings.

Dependabot covers web, desktop, Go, and GitHub Actions weekly. When upstream releases a fix, update the lockfile, rerun the complete audits and platform builds, remove the now-unnecessary exception, and verify the corresponding GitHub alerts close from the actual default-branch dependency change.
