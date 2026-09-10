# Privacy operations

Maintainer contact: [makinenitejovardhan@gmail.com](mailto:makinenitejovardhan@gmail.com). This is the existing private support route, including for people who cannot sign in. Do not put personal records, credentials or rights requests into public GitHub issues. This project has no staffed response-time guarantee; the operator must still meet applicable legal deadlines and arrange coverage when necessary.

Read the [legal-readiness assessment](LEGAL-READINESS-2026-09-10.md) for unresolved operator identity, location, audience and legal scope. Procedures below are operational instructions, not proof that every process has been exercised. The policy gates, notices, behavior-ingestion closure and resume deletion are deployed; [release evidence](RELEASE-VALIDATION-2026-09-10.md) records exact artifacts, focused checks and limitations. Earlier baseline references describe `83f17fa`.

## Private records and ownership

The new required product check-in is distinct from voluntary bug reports and
research. It records versioned choices and limited interview metadata, with
optional comments and transcript permission. Structured responses are included
in account export and removed with their interview or account; general feedback
can have a different lifecycle. Follow the
[questionnaire](BETA-FEEDBACK-QUESTIONNAIRE.md) and
[metric definitions](FEEDBACK-METRICS.md), and consult the current release record
for deployed status. Do not reuse identifiable responses or transcripts in a
university study merely because they were collected for product improvement.

Where relying on legitimate interests, the operator must document the purpose,
necessity and balancing assessment and handle applicable objections. Making a
survey required does not itself establish that basis, and a product terms
acknowledgment is not freely given research consent. Preserve the existing
private rights route and assess requests without requiring survey submission.
[EDPB lawful-processing guidance](https://www.edpb.europa.eu/sme/be-compliant/process-personal-data-lawfully_en).

Keep a restricted request/incident register outside Git. Assign an accountable operator and, where appropriate, counsel. Record only: reference, received/awareness time in UTC, request type, necessary contact/account reference, relevant jurisdiction, verified authority, applicable deadline and source, actions, exceptions and closure. Keep content out of CI artifacts, model prompts and ordinary logs. Decide and record retention for this register; do not retain copies of entire interviews by default.

Maintain a provider register covering legal entity, service, controller/processor role, data types, purposes, countries, accepted agreement/version, subprocessors, transfer mechanism, retention/deletion route and security contact. The hosted Gemini project's paid billing was verified on 10 September 2026; BYOK eligibility declarations are not independent billing verification. An operator must review and accept applicable contracts personally or through authorized representation.

## Rights requests

1. **Receive and scope.** Accept signed-out email requests as well as in-app controls. Record receipt immediately when handled; identify the requested access, correction, deletion, objection or restriction. Ask only for information necessary to locate the account and determine relevant rights. Do not require a new account or policy acceptance just to request rights.
2. **Verify proportionately.** Prefer existing authenticated controls or a verified account-contact challenge. Never ask for a password, API key or emailed identity document as a routine step. Evaluate representative/parental authority before disclosing another person's data. A matching email display name is not proof.
3. **Set the actual deadline.** If GDPR applies, the usual rights-response period is one month; a justified complex extension needs notice within that initial period. Other laws have different clocks, verification, appeal and exception rules. A support queue does not suspend them. [EDPB rights guidance](https://www.edpb.europa.eu/sme/be-compliant/respect-individuals-rights_en)
4. **Fulfill securely.** Prefer Settings export or another authenticated delivery channel. The JSON export deliberately excludes passwords, tokens, provider credentials, private scoring references and the quota ledger; it is not automatically a complete legal response covering operational/vendor data. Check logs, feedback, prior review results and processor records where relevant without disclosing another person's information.
5. **Explain scope and exceptions.** Record what was corrected/deleted, any limited lawful retention and its reason, provider handling and appeal/complaint routes where applicable. Confirm completion only after verification. Do not promise remote erasure of downloaded exports or another device.

## Deletion and restoration checklist

- **Session:** use the owner-scoped deletion operation. A leased/ending/scoring session can return a conflict; resolve activity safely instead of bypassing persistence safeguards. Structured product check-ins are removed with their interview. Separate general feedback can retain account-linked comments/context after session deletion and must be considered in a broader erasure request.
- **Resume:** a new upload replaces the previous upload, but older standalone review results can remain. The deployed explicit resume-delete operation removes uploads and standalone reviews, including detached reviews. Deleting a resume does not rewrite interview transcripts, saved session context or reports that already used it.
- **Account:** account deletion cascades linked application records. Verify related data and credential removal using scoped counts, not transcript dumps. The rolling quota ledger survives temporarily; review any exceptional erasure request against its documented anti-abuse purpose.
- **Browser:** logout/deletion clears private application caches on the current origin. It cannot wipe other devices, alternate hostnames, previously downloaded exports or user copies. Explain how to clear those locally if requested.
- **Providers/backups:** determine whether additional vendor deletion is available/required. Record a minimal suppression/deletion record where justified so restoration cannot silently revive deleted data. Before a restore serves traffic, replay applicable deletions and restrictions, test them, and remove temporary restored copies. Do not keep a second unrestricted archive of deleted interviews as a “deletion log.”

Use the [release runbook](RELEASE-RUNBOOK.md) for isolated restore and rollback handling. Never restore production just to answer a routine request without a documented necessity and authorized plan.

## Retention inventory

The following combines source behavior with read-only production configuration checks on **10 September 2026**. Expiry prevents use where enforced; physical deletion can occur at the next hourly maintenance pass. A configured period is not evidence that every historical copy is absent.

| Data | Verified behavior or open decision |
| --- | --- |
| Accounts, interviews, transcripts, workspace, reports | No general automatic expiry. Retained until applicable user/operator deletion. Define any future inactivity schedule before promising one. |
| Resume uploads/reviews | Latest upload replaces prior upload; standalone reviews can persist. Account deletion removes linked data. Independent resume/review deletion passed owner-isolation and idempotence tests and is deployed. |
| Required interview check-in | Account/interview-linked six answers, version, timestamps, optional comment and transcript permission. Included in account export; cascades with session/account deletion. Private aggregate metrics and paginated suggestions do not make the underlying records anonymous. |
| General/support feedback | Account-linked; separate from the session lifecycle. Optional diagnostic/transcript flags do not make it anonymous. |
| Verification/reset actions | One-use tokens stored hashed; verification validity 24 hours, reset 30 minutes; expired rows cleaned periodically. Never log action links. |
| BYOK credentials | Encrypted server-side session credentials expire after three hours and are removed following terminal processing/maintenance. Do not claim this controls vendor logs. |
| Usage ledger | Purpose-specific HMAC of normalized email plus activation/funding; retained for rolling seven-day enforcement with hourly cleanup. Pseudonymous, not anonymous; survives account deletion for that limited purpose. |
| Legacy behavior | Raw behavior samples/events have a 30-day purge; aggregates can remain with reports. New ingestion closure does not itself delete all historical data. |
| Cloud Logging | `_Default` retention verified at 30 days; `_Required` is locked at 400 days. Content differs by bucket; do not claim all logs disappear after 30 days or assume every request URL excludes a query string. |
| Cloud SQL | `us-west1`; automated backups enabled with retention of **seven backups by count**, not a guaranteed seven-day period. Transaction-log retention is seven days. |
| Manual database backups | Access restricted, but **no automatic expiry currently established**. Operator must assign/document purpose, review/expiry and erasure/restore handling. Do not silently promise a 30-day deletion schedule. |
| Original Git-history backup | Separately preserved under the owner's explicit history-cleanup authorization; not the same asset as application database backups. Inventory its contents/access and applicable retention separately. |
| Provider/email/browser/support data | Separate terms, configuration and local copies apply. Record actual settings and unresolved retention decisions rather than inventing a common expiry. |

The maintenance worker needs CPU time when idle; verify `retention_completed`/fixed failure diagnostics and deployment settings. A failed purge requires investigation. See [operations](OPERATIONS.md).

## Security and privacy incidents

1. **Start a restricted record:** awareness time, reporter, affected service/revision, data categories, approximate population/countries, access/acquisition evidence and uncertainty. Do not copy raw payloads into alerts or public issues.
2. **Contain and preserve:** involve the authorized operator; restrict compromised access, revoke exposed credentials/tokens and isolate affected processing as justified. Preserve necessary evidence securely with timestamps. Do not erase evidence, trigger paid retries or perform a broad restore reflexively.
3. **Assess scope:** determine controller/processor roles, affected jurisdictions, whether encrypted material and keys were exposed, harm and sensitive/child data. Contact relevant processors privately using established channels. Inspect all 50 US state breach regimes plus DC/territories and applicable foreign/sector laws for the affected population; this document is not an exhaustive legal survey.
4. **Calculate and act on deadlines:** use the governing statute, facts and counsel; do not wait for a final root cause when an earlier notice is required. Track regulator, individual, contractual and law-enforcement obligations separately.
5. **Close with evidence:** record notification decisions, corrective work and verified recovery. Review access, collection and retention changes; do not describe a successful retry or rollback as proof that no disclosure occurred.

| Conditional example | Deadline/decision to evaluate |
| --- | --- |
| GDPR controller breach | Notify the authority within 72 hours of awareness unless unlikely to risk rights/freedoms; high-risk cases require individual notice without undue delay. Document all breaches. [EDPB breach guidance](https://www.edpb.europa.eu/sme/assess-the-risks/data-breaches_en) |
| California covered breach | Current §1798.82 generally requires consumer notice within 30 calendar days of discovery/notification, subject to statutory exceptions. More than 500 affected California residents also requires AG sample submission within 15 days of consumer notification. Other states may require earlier/different action. [Current statute](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CIV&sectionNum=1798.82.) |
| PIPEDA | Assess real risk of significant harm for reporting/individual notification; keep required breach records for 24 months, including incidents below the notification threshold. [OPC reporting](https://www.priv.gc.ca/en/report-a-concern/report-a-privacy-breach-at-your-organization/report-a-privacy-breach-at-your-business/), [records](https://www.priv.gc.ca/en/privacy-topics/privacy-for-businesses/privacy-breaches-at-your-business/breach_101/breach_records/) |
| Brazil | Apply ANPD's notification and recordkeeping rules, including qualifying risk and any applicable small-agent provisions; do not substitute the GDPR clock. [ANPD Resolution 15/2024](https://bibliotecadigital.mj.gov.br/bitstream/1/12879/2/RES_ANPD_2024_15.html) |

## Discovered minors or sensitive uploads

For a credible underage report, restrict the affected hosted AI use through an authorized, verified enforcement path; do not merely hide a frontend button. Avoid additional model processing while investigating. Verify only necessary facts, assess COPPA/other local duties and provider restrictions, and arrange authorized deletion with the appropriate person. If an account-specific restriction is unavailable, document and resolve the containment gap before resuming that processing. Never convert an under-18 account to “eligible” simply because a parent agrees: current Gemini client restrictions are a separate issue. Keep recovery/privacy contact and legally required rights routes available.

For real patient/client information, unnecessary health details, government IDs or third-party records: stop avoidable onward processing, locate the affected upload and derived review/transcript/feedback copies, limit access and assess deletion, legal basis and incident obligations. Ask for a fictional/deidentified replacement when appropriate. Do not forward the material to another AI tool for “legal review.” A warning against sensitive uploads does not erase obligations for data actually received.

Before accepting new formats, review the intended audience and data needs. Do not add child-directed practice, employer screening, human interview recording or emotion/identity analysis without a separate assessment. Handle personal material in contributions privately under [security guidance](../SECURITY.md); do not publish applicant records or proprietary interview banks.

## Review evidence

The [deployed release record](RELEASE-VALIDATION-2026-09-10.md) includes source/revision, policy versions, migration and focused evidence for: stale/missing assertions rejected before provider calls; legacy recovery/export/deletion accessible; resume/voice notices before transfer; deletion scope/cache behavior; and retention worker health. Exercise procedures with synthetic accounts/content. Preserve unresolved operator, contract, audience and manual-backup questions as open items rather than treating passing tests as legal clearance.
