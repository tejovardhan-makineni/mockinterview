# Launch readiness and additional product concepts

> **Historical readiness assessment.** This checklist predates the current implementation; its 137-scenario baseline and unresolved-code findings are historical. Read [implementation validation](RELEASE-VALIDATION-2026-09-09.md) and the [release runbook](RELEASE-RUNBOOK.md) for completed checks, limitations and remaining launch actions.

Reviewed 2026-09-09. This supplements [IMPROVEMENT-PLAN.md](IMPROVEMENT-PLAN.md), [the code audit](AUDIT-2026-09-09.md), and [the deployment procedure](DEPLOYMENT-UPDATE-PLAN.md). It is a readiness assessment and proposed checklist, not a statement that the work is implemented. No repository visibility, cloud configuration, accounts or deployment were changed.

## Launch recommendation

Do not announce a broad public launch yet. First close the security, interview-recovery, data-durability and cost-control blockers, then run a small supported beta. Expand the public launch when ordinary candidates and first-time contributors can complete the core journeys independently.

More questions are not a prerequisite: the existing 137 scenarios already supply considerable breadth. Prioritize a dependable practice loop and a smaller set of reviewed experiences. Full photoreal video, every profession, multiplayer panels and elaborate gamification can follow.

The checklist below uses “required” as a product/release recommendation. It does not imply every open-source project requires the same governance structure or certification.

## Newly verified findings

| Area | Current evidence | Implication |
|---|---|---|
| GitHub visibility | Authenticated GitHub inspection reports the repository **private** | The public cannot clone or contribute; an AGPL license in the tree does not by itself make the repository publicly available |
| Main branch | Branch response reports `protected=false`, required checks off/empty; detailed protection/ruleset endpoints return a plan/visibility restriction | Configure and verify enforcement for the intended public repository before accepting external contributions |
| Repository security | Secret scanning, code scanning and vulnerability alerts reported disabled; private vulnerability reporting could not be verified | SECURITY.md currently directs people to a channel that may not be available |
| Community foundation | README, AGPL LICENSE, CONTRIBUTING, Code of Conduct, generic issue templates, PR template and CI exist | Improve and complete these; do not recreate them as if absent |
| Community gaps | No usable reporting contact in SECURITY/Code of Conduct; no release, release environment or dedicated scenario/format template; no asset provenance file found | New users/contributors need a working point of contact and reproducible, attributable releases |
| Avatar assets | Ready Player Me copyright metadata in two GLBs; another records a Blender generator | The code license does not establish redistribution permission for every model; verify origins/terms before public distribution |
| Account access | No email-verification/password-recovery flow; `auth.me` treats network/server errors as signed out | People can lose access or be misleadingly logged out; identity-based quotas are weak |
| Camera consent | Analysis consent is stored browser-wide and survives logout | A second account on the same browser can inherit a prior user's opt-in |
| Local private data | Resume critiques/job matches persist in localStorage; logout/deletion do not clear those caches | Server-side deletion alone leaves sensitive local artifacts on shared devices |
| Production mode | Missing reasoning key can select backend stub; frontend defaults API origin to localhost; mock feedback reports success without persistence | A green build or `/ping` cannot establish that real interviews and feedback work |
| Cloud monitoring | Cloud Monitoring uptime-check and alert-policy lists returned `[]` in `storybytes-495010` | Configure monitoring and a recipient before public launch; external monitoring was not checked |
| Runtime identity | API uses the default Compute service account, whose project bindings include Editor and Secret Manager Secret Accessor | Create an app-specific identity with narrow grants; do not remove a shared account's grants without checking other products |
| Cloud health checks | TCP startup probe present; no application-level liveness/readiness probe shown | Add suitable application readiness and independent end-to-end checks |
| Database backups | Automated backups enabled, seven retained; latest three listed backups successful, including September 9 | Backup creation is working; a restore rehearsal and acceptable recovery window are still needed |
| Database availability | Zonal Postgres 16 instance; point-in-time recovery enablement not established by returned configuration | Decide acceptable downtime/data-loss targets; do not claim PITR or regional failover is already available |

Repository findings are from authenticated read-only GitHub API calls; cloud findings are from `gcloud ... describe/list`. The existence of backup files does not establish that this application's restore procedure has been tested. The code findings have references below; the earlier audit contains detailed interview-engine evidence.

## 1. GitHub and open-source launch

### Required before the public repository release

- [ ] Fix the known admin-email authorization issue before exposing and promoting the application broadly.
- [ ] Scan the working tree **and Git history**, tracked binaries, example datasets and documentation for secrets/private candidate content. Rotate any exposed credentials; `.gitignore` is not a history scan. Review the new audit/runbook documents for information intended only for maintainers before publishing them.
- [ ] Establish provenance and redistribution rights for avatar assets, sample resumes, question sources, fonts and other bundled resources. Add an asset/source manifest and relevant notices. “Generated in Blender” is not license evidence. Community examples should use synthetic data and original scenarios.
- [ ] Make the repository publicly readable as a deliberate release step, then verify anonymous clone/access. No visibility change was performed in this assessment.
- [ ] Add the live URL, accurate description/topics, product screenshots, a short demonstration, limitations and roadmap to README/repository metadata. Make the app's Source/Contribute/Run locally links point to accessible content.
- [ ] Repair and test a fresh-clone quickstart, dependency installation and the documented Make targets. Supply keyless demo, real-provider local practice and self-host instructions; specify what runs locally versus calls a provider.
- [ ] Verify branch rules require relevant CI checks and reviewed changes appropriate to the maintainer team; block force pushes/deletion and document an emergency path. Do not require an impossible second approval if there is only one active maintainer.
- [ ] Enable available secret/dependency alerts and code scanning; add a maintained dependency-update workflow. Keep untrusted fork CI away from production credentials, use read-only workflow permissions by default, and pin third-party actions to reviewed immutable revisions.
- [ ] Make private vulnerability reporting work, or publish a monitored private contact. The current “email the maintainer” instruction lacks an address. Add an actual Code of Conduct reporting route and a practical response commitment. GitHub requires repository-level enablement for its private reporting channel. [GitHub private reporting](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-vulnerability-reporting/configure-for-a-repository).
- [ ] Tag an initial beta release with known limitations, tested model/browser capabilities, migration instructions and changelog. Give users a stable version to self-host and an explicit source link for the deployed version.

### Contribution guidance that matters for this product

Provide separate, low-friction routes for **scenario authors, format authors, domain reviewers, translators, designers and code contributors**. The current developer-oriented guide should not make someone learn Go merely to improve an interview question.

Add scenario/format proposal templates with role, level, purpose, duration, private facts, permissible tools/assistance, expected follow-ups, acceptable alternatives, rubric anchors, sources/license and sample conversations. Include a fully valid completed example and local preview instructions. Explain the difference between adding a question and adding a new stage/workspace capability.

Use a contributor declaration of authorship and redistribution rights, plus a clear inbound contribution-license policy compatible with the repository license. DCO or CLA adoption is an explicit project choice, not a prerequisite to every small OSS release. Keep it simple until there is a concrete need for more legal process.

Require content changes to pass schema checks and behavioral fixtures. High-impact professional content needs a competent domain reviewer. Route bugs, question errors and assessment disagreements separately; public issue templates should warn against including keys, real resumes or private transcripts. Add reviewer ownership, good-first-issue labels and clear triage states; use Discussions only if someone will maintain it.

Treat support as part of launch: publish where to ask questions, what versions are supported, which issues are urgent and how volunteers can help. A logo, sponsor program, contributor leaderboard, foundation, certification or complex governance process can wait.

## 2. App safety, access and trustworthy behavior

### Required for an external beta

- [ ] Complete the original P1 transport, admin, quota, finish/persistence and recovery fixes. Test failure injection against real PostgreSQL and a simulated provider; current green unit checks do not cover these paths.
- [ ] Implement verified hosted identity, password recovery or a well-supported managed sign-in path, and session revocation. Distinguish authentication expiry from a temporary API/network failure. Account recovery must not rely on posting personal information in GitHub.
- [ ] Scope camera-analysis consent to the authenticated user/attempt, clear it on logout/account switch and show current capture state. Permission for self-view does not imply consent to analysis or upload.
- [ ] Fail production configuration explicitly when the frontend uses mock mode, lacks its deployed API origin, or backend provider selection unexpectedly resolves to a stub. Provide a safe release/capabilities endpoint and test a real supported interview mode.
- [ ] Add visible support, privacy/data-use, retention/deletion and service-rules pages. Explain which services receive audio/text/resumes, whether anything is recorded, how personal keys are handled and what AI feedback means. Match these statements to implementation and actual provider settings.
- [ ] Provide a short policy before starting: simulation or coaching, allowed tools, duration, use of hints, cost/funding and allowance consumption. Verify the weekly/own-key daily policy on the server, including duplicate requests and recovery.
- [ ] Keep user practice data private by default. Test account/session ownership, downloads, export and deletion; redact support diagnostics and obtain explicit choice before attaching transcript excerpts.
- [ ] Clear private local resume/report caches on logout, deletion and account switch. Test both server records and browser storage; preserve only non-sensitive preferences where appropriate.
- [ ] Implement and observe the promised retention purge. Do not display unmeasured camera-derived numbers as objective feedback; a static default or brightness heuristic is not validated gaze/posture measurement.
- [ ] Make existing reports, work and recovery states usable during a provider outage. Never silently substitute a fabricated evaluation. Add bounded retry/circuit-breaker behavior, controlled session-start limits and a per-feature disable switch.

Candidate self-view can launch without camera analysis. I recommend postponing camera-derived coaching until its signals and wording are validated; it currently adds trust and accessibility complexity to the core interview product. This is separate from improving the interviewer avatar.

Evidence: [auth feature](../web/lib/features/auth.ts), [auth handlers](../api/internal/auth/auth.go), [camera behavior](../web/lib/behavior.ts), [backend config](../api/internal/config/config.go), [frontend transport](../web/lib/http.ts), [mock feedback](../web/lib/features/feedback.ts), [retention mechanism](../api/internal/store/behavior.go).

Local-cache evidence: [resume review](../web/app/resume-review/page.tsx) and [account settings](../web/app/settings/page.tsx). The normal UI keys caches by resume ID; the concern is retained private data, not a claim that all other users see it automatically.

## 3. Deployment and ongoing operation

- [ ] Isolate staging data, credentials and service configuration. Test old accounts/reports through migrations, then promote immutable versions with recorded rollback targets.
- [ ] Move this app to a dedicated runtime service account with only its required database/provider/secret permissions. Use separate deployment credentials and Secret Manager references; avoid copying platform keys into browser configuration. Centralized secret storage, least privilege and rotation are recommended operational controls. [OWASP secrets guidance](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html).
- [ ] Add process health and dependency readiness checks suited to Cloud Run. Do not call a paid model on every health probe. Test model capability separately with a bounded synthetic check. A provider outage should disable affected starts without repeatedly restarting otherwise healthy app containers. [Cloud Run health checks](https://docs.cloud.google.com/run/docs/configuring/healthchecks).
- [ ] Monitor public landing/API availability, session-start success, disconnect recovery, final-save failures, feedback queue age/errors, database pressure and provider spend. Configure an actual recipient and verify an alert reaches them through a controlled drill.
- [ ] Define a small incident runbook: who investigates, where sanitized diagnostics live, how to pause new sessions while preserving history, how to switch off a broken provider/format, and how to communicate an outage.
- [ ] Set app-specific usage budgets and hard admission limits. Alerts-only billing budgets notify; they do not stop spending. Do not disable billing for the shared project as an app-level cost control. [Google Cloud budget behavior](https://docs.cloud.google.com/billing/docs/how-to/budgets).
- [ ] Test restoring this app's data into an isolated destination. Choose acceptable recovery time/data-loss windows and verify whether PITR is enabled before relying on it. Preserve other databases on the shared instance. Regional HA can follow a deliberate availability/cost decision; working backup/restore is needed first.
- [ ] Load-test concurrent long-lived voice sessions and scoring against the chosen pool/instance limits. The current concurrency setting is capacity configuration, not evidence that 80 simultaneous interviews per instance work. Test cold starts and instance termination during live work.
- [ ] Add compatible security headers, including a tested CSP, referrer policy and framing protections. Check Monaco, Excalidraw, workers, audio and avatar resources under the actual production policy. Verify exact CORS origins and trusted proxy handling.
- [ ] Publish support/status information, source/release version and known limitations. Resolve `.live` versus `.io`, canonical metadata and redirects before broad marketing. Keep sitemap/indexing for public content and private report URLs out of discovery; access control remains the real privacy boundary.

The existing successful backups are a useful foundation. Monitoring, dedicated identity, restore evidence and an operational owner are the additional launch needs, not a wholesale infrastructure migration.

## 4. Usability gates

Run task-based sessions with approximately 8–12 representative testers as an initial discovery exercise, including first-time users, people with differing speech/access needs and slower devices/networks. This sample is a practical starting point, not statistical proof of quality.

Have each participant find a relevant format, understand the allowance, enter with camera off, answer/probe/interrupt, recover from a controlled disconnect, finish, locate evidence in the report and find their next eligible practice/local option. Observe where help is needed; don't coach them through confusing controls.

Before a public beta, verify:

- A visitor understands the available formats and basic limits before creating an account.
- A new user reaches a suitable interview with a short setup and optional advanced choices.
- Mic level means local capture; provider-ready and acknowledged input have separate honest states.
- Denied media access offers a working text path. Advertised languages/browser combinations are actually supported; browser speech recognition must not be described as necessarily local/offline.
- A user can read earlier transcript turns, keep the brief visible, mute, disable camera and finish by keyboard. Reports/menus handle focus correctly, and status does not rely on color alone.
- The room works on advertised devices without obscuring code/drawings. Large avatar assets load lazily with a usable fallback; current bundled models range from roughly 1.3 to 12 MB.
- Every answer/save/report has clear pending, saved, failed and retry states; a transient fetch failure is not an empty history or signed-out user.
- People can explain at least one useful next step from their feedback. They can disagree with an assessment through a visible feedback path.

Use WCAG 2.2 AA as the engineering accessibility target and test manually alongside automated checks; do not claim conformance based on a single scanner. [W3C accessibility guidance](https://www.w3.org/WAI/standards-guidelines/wcag/).

Browser speech recognition has limited availability, and some implementations send audio to a remote recognition service. Keep that processing path visible in the data-use explanation and distinguish it from the app's native voice relay. An unanswered permission prompt must offer Cancel or Continue with text. [MDN SpeechRecognition](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition), [MDN getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia).

## 5. Interview coverage and better product concepts

### What to promote at launch

Start with roughly four dependable families selected from existing strengths: structured behavioral, system design, coding walkthrough/review, and a fixed-fact product/business case. Promote a case track only when its facts, follow-ups and rubric have been reviewed. Aim initially for about six distinct scenarios and two calibrated levels per promoted format; these are scope proposals, not universal thresholds.

Keep the rest of the corpus discoverable with accurate experimental/review status, without claiming every track has equal validation. The seven reference experiences in the main plan remain the expansion quality target. Do not require a new work-sample platform or every medical/legal specialty before the first narrow release.

Executable coding requires an isolated runner, supported language/runtime versions, test execution and appropriate resource limits. Until that exists, name the feature code walkthrough/review and explain that execution is unavailable. Microsoft's own preparation guidance includes running/compiling and testing code, illustrating why a plain editor is only one part of that format. [Microsoft technical interviews](https://careers.microsoft.com/v2/global/en/hiring-tips/technical-interviewing.html).

### Additional concepts, in priority order

| Priority | Concept | What makes it useful / scope |
|---|---|---|
| Early | Prepare, then defend | Review a small code change, architecture brief, portfolio artifact or analysis before discussing and improving it live; build on existing document/code workspaces |
| Early | Recover and revise | Introduce a correction/new constraint and assess adaptation; reward good reasoning after a mistake instead of grading only the first answer |
| Early | Candidate questions | Practice the final few minutes asking relevant questions about role expectations, priorities and trade-offs, with follow-up assessment |
| Early | A learning pack after each interview | Bundle evidence-linked feedback, an answer-repair exercise, alternate acceptable approaches and a next-scenario recommendation with the completed report |
| Next | AI-output critique and verification | Supply a fixed AI-generated draft/code sample and ask the candidate to identify errors, verify claims and defend improvements; specify whether tools are permitted |
| Next | Incident/debugging simulation | Reveal logs, symptoms or customer reports in response to investigation; assess hypothesis testing, prioritization and communication |
| Next | SQL/data interpretation | Query a bounded dataset, explain uncertainty and recommend action; executable versions need an isolated environment |
| Next | Stakeholder roleplay | Practice discovery, objections, negotiation or conflicting requirements with one clearly identified counterpart at a time |
| Later | Written brief → presentation → challenge | Create a recommendation, present it and handle questions; useful for product, finance, consulting and leadership |
| Later | Panels and multi-round loops | Explicit speaker roles, varied evidence and cross-round context; avoid cosmetic avatar switching that does not change the interview behavior |

GitLab documents advance review of a self-contained merge request followed by a technical discussion and live improvements, supporting the prepare/defend direction. McKinsey describes cases, experience/expertise interviews and some writing/group/role simulations. These are sources for format shapes; author original content rather than copying assessment questions. [GitLab technical interviewing](https://handbook.gitlab.com/handbook/hiring/interviewing/technical/), [McKinsey interviewing](https://www.mckinsey.com/careers/interviewing).

Store **allowed tools and assistance per format**. GitLab's guidance encourages AI within its rules, while McKinsey restricts real-time generated answers unless permitted. A universal “always allow AI” or “never give hints” policy cannot reflect both; show practice rules and account for assistance when interpreting the result. These rules vary by role/date and must be sourced/reviewed rather than promised as exact company replication.

### Make the weekly allowance valuable throughout the week

After the report, keep static/offline reflection and practice available: rewrite a weak answer, outline three clarifying questions, explain a trade-off, find a counterexample, or compare against annotated acceptable approaches. Invite self-assessment before revealing feedback and link the next eligible interview to a skill the user worked on.

Use repetition to learn, then a fresh scenario to test transfer. Label repeat attempts so memorization is not mistaken for increased readiness. Keep comparisons within compatible formats, levels and rubric versions. Any new AI-powered drill needs an explicit cost/quota policy; do not create an unlimited funded interview loophole by renaming sessions “drills.”

### Reviewer calibration is a launch gate

For each promoted format, have two competent reviewers independently assess strong, mixed, weak, incomplete and self-correcting example attempts, then resolve rubric disagreements. Require evidence for scores and accept alternate valid approaches. Re-run the examples when the model, prompt or rubric changes.

OPM's structured-interview guidance supports job-related questions, defined rating criteria and consistent assessment. It does not validate this product's AI scores; the product needs its own evidence. Avoid portraying a practice score as an actual offer probability or professional credential. [OPM structured interviews](https://www.opm.gov/policy-data-oversight/assessment-and-selection/other-assessment-methods/structured-interviews/).

## Release gates and ownership

| Gate | Evidence required | Suggested accountable role |
|---|---|---|
| Safe external beta | Original P1 fixes, identity/consent boundaries, production mode checks, quotas/BYOK, data durability and private support route | App/API maintainer |
| Operable beta | Successful restore exercise, deployment rollback, alert delivery, per-app service identity and cost controls | Deployment owner |
| Public OSS release | Anonymous clone, history/asset review, useful quickstart, enforced checks, working private reporting and tagged release | Repository maintainer |
| Useful interview beta | Reviewed promoted formats, calibration fixtures and usable reports | Format/domain reviewers |
| Broad public launch | Independent user journeys pass; observed completion/recovery/report metrics and support workload justify widening access | Product maintainer |

Launch to a bounded cohort after the safety/operability gates. Review actual failures and usefulness before increasing admissions. Existing unit-test success, a deployed homepage or a large question count is not sufficient release evidence. The project does not need a payment system, microservices, mandatory photoreal streaming, a large moderator hierarchy or every new concept above to begin a useful beta.
