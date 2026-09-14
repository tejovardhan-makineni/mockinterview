# Interview bank audit and expansion

Reviewed September 14, 2026. The public production API returned 143 scenarios,
16 professions, and six practice paths, matching the repository before this
change. The additions below are implemented in this checkout; this document is
not a deployment record.

## What the bank needs

The main opportunity is balanced coverage and better practice design, not more
variations of familiar software questions. Of the original 143 scenarios, 90
were available to software engineers and 51 to data scientists. These are
overlapping profession memberships, not independent scenario counts.

Only ten scenarios targeted entry or junior levels: seven entry and three
junior. The other 133 were mid, senior, or staff. Education, human resources,
and marketing each had one scenario in total. Sales and UX each had three.
Mechanical, electrical, and civil engineering each had three specialist
scenarios alongside shared behavioral practice. Profession totals therefore
overstated the depth of specialist coverage.

Only six scenarios used the explicit v1 content contract with scoring anchors,
conditional facts, and follow-up learning drills. The older material often has
substantial reference answers, but that alone does not establish consistent
interviewer behavior or reliable scoring. Existing content remains community
preview material.

The catalog also labeled `domain` as “Interview format.” That mixed skills such
as valuation and circuits with methods such as roleplay and work-sample review.
The bank needs separate dimensions:

1. **Career family:** a broad starting point.
2. **Profession:** the work the candidate is preparing for.
3. **Skill or topic:** what the scenario assesses.
4. **Interview format:** how the conversation or exercise proceeds.
5. **Workspace:** conversation, writing, code review, or whiteboard.
6. **Level and challenge:** role expectations and stretch, configured separately.

Grouping related occupations is consistent with the organizing principle used
by [O*NET career clusters](https://www.onetonline.org/find/career). The seven
families below are a product navigation choice, not a reproduction of O*NET's
official classification or a claim to cover every occupation.

## Implemented categorization

There are now 30 professional areas plus a cross-career foundations area,
organized into seven families. The backend profession registry supplies the
family labels, profession labels, search aliases, and specialist profiles.

| Career family | Professional areas |
| --- | --- |
| Career foundations | First jobs, screening, transferable skills, returning to work, evidence stories, written responses, panel practice, candidate questions, and offer conversations |
| Technology & data | Software engineering, data science, **cybersecurity**, **IT support**, **quality assurance** |
| Engineering & skilled trades | Mechanical, electrical, civil engineering, **skilled trades** |
| Business, finance & operations | Product management, consulting, finance, **accounting**, **project management**, **business operations**, HR, **supply chain** |
| Customer, sales & creative | Sales, marketing, UX/product design, **customer support**, **retail & hospitality**, **creative communications** |
| Healthcare & care | Medicine, nursing, **social work** |
| Education, research & public service | Education, **research**, law, **public service** |

Bold professional areas are newly added. Career foundations is also new and is
available through every profession filter. General behavioral scenarios and
candidate-question practice have been extended across the catalog. When a
profession is selected, equally relevant scenarios primarily authored for that
profession appear ahead of shared practice.

The catalog now separates formats from topics, supports profession aliases,
shows the assigned AI interviewer, and offers filters for family, profession,
format, skill, level, and workspace. The setup page shows the scenario's
specialist when that information is available. Practice paths can be filtered
by profession.

## Specialist agents

A specialist must change the interview's behavior, not simply its avatar or
voice. Each profession now has an AI interviewer profile with a focus and
instructions used by the interview director. Scenario-specific facts, probes,
format stages, and rubrics determine the exercise and assessment.

Examples of meaningful specialization:

| Specialist | What it should investigate |
| --- | --- |
| Cybersecurity | Evidence quality, scope of access, incident escalation, proportionate controls |
| IT support | Safe troubleshooting order, identity checks, user communication, escalation notes |
| QA | Reproduction, coverage, severity versus priority, release decisions and missing evidence |
| Accounting | Reconciliation, source documents, control failures, uncertainty in records |
| Project management | Dependencies, ownership, scope, credible recovery plans |
| Customer support | Discovery, policy-aware options, clear commitments, escalation and follow-through |
| Skilled trades | Role boundaries, hazard recognition, supervisor handoffs, safe prioritization |
| Research | Claims versus evidence, study design, limitations, reproducibility |
| Social work | Listening, consent, referral constraints, confidentiality, appropriate supervision |
| Career foundations | Truthful evidence, transferable skills, relevant questions, realistic learning plans |

These are specialized profiles using the existing shared AI runtime. They do
not run separate autonomous services, train separate models, or produce
independent expert opinions. A panel simulation explicitly uses one AI to
alternate perspectives; it is not three independent agents or raters.
Specialist instructions are saved with new question snapshots so subsequent
registry changes do not silently change those instructions for saved attempts.

## Added scenarios and practice paths

This expansion adds **42 scenarios**, taking the bank from **143 to 185**:

- **28 specialist scenarios:** two for each of the 14 new professional areas.
  Every pair includes an entry/junior exercise and a mid/senior exercise.
- **Four additional scenarios** for existing sparse areas: education, HR,
  marketing, and sales.
- **Ten cross-career scenarios** for the wider job-search journey.

Entry/junior coverage grows from ten to **32 scenarios**: 24 entry and eight
junior. The remaining scenarios are 94 mid, 51 senior, and eight staff.
Twelve existing behavioral scenarios also receive scoring-visible revisions so
qualitative outcomes, transferable experience, and appropriate boundaries can
earn credit without mandatory business metrics or a rigid answer formula.

Each new scenario has original task facts, controlled follow-up disclosures,
specific probes, observable scoring anchors, and a short self-guided drill.
They are AI-assisted drafts awaiting practitioner review and calibration.

| New professional area | Starting exercise | Deeper exercise |
| --- | --- | --- |
| Cybersecurity | Phishing triage | Vendor access review |
| IT support | Account access | Office outage |
| QA | Checkout test plan | Release risk decision |
| Project management | Coordinator handoff | Delivery recovery |
| Business operations | Scheduling review | Backlog redesign |
| Accounting | Invoice reconciliation | Close-control review |
| Customer support | Delivery recovery | Escalation pattern |
| Retail & hospitality | Return conversation | Overbooking recovery |
| Supply chain | Receiving discrepancy | Shortage allocation |
| Skilled trades | Apprentice safety handoff | Maintenance priorities |
| Public service | Application assistance | Service backlog |
| Social work | Referral intake | Case handoff |
| Research | Evidence summary | Study-design review |
| Creative communications | Brief review | Campaign recovery |

The new cross-career concepts are:

| Concept | Who it helps | Practice outcome |
| --- | --- | --- |
| First-job introduction | First-time applicants, graduates, apprentices | Explain a strength using everyday evidence |
| Recruiter screen | Applicants in any field | Connect experience to responsibilities and ask useful questions |
| Career-change explanation | Career changers and transitioning veterans | Translate a skill while acknowledging differences between roles |
| Return-to-work conversation | Returners and people with employment gaps | Discuss current strengths and learning without compulsory personal disclosure |
| Evidence story | Anyone practicing behavioral answers | Explain personal contribution and an honest outcome |
| Offer conversation | Candidates considering an offer | Clarify terms, make a reasoned request, or accept/decline thoughtfully |
| Panel perspective simulation | Candidates facing multiple stakeholders | Reconcile competing priorities and summarize a decision |
| Job-description evidence map | Applicants tailoring preparation | Separate demonstrated strengths, partial matches, and learning gaps |
| Written screening response | Applicants facing asynchronous screening | Write a clear plan using supplied facts and uncertainties |
| Feedback recovery | Candidates who lose their thread or receive a probing follow-up | Correct an answer with truthful evidence and a useful next step |

Four reusable formats were added: recruiter screen, experience/transferable
skills, panel perspective simulation, and written response/discussion. Existing work-sample, stakeholder,
incident, AI-critique, and reverse-interview formats support the other content.

Seventeen new paths take the collection from six to **23 practice paths**:
First Job Foundations, Career Change and Return to Work, From Recruiter Screen
to Offer, and one path for each new professional area. Each round remains a
separate interview attempt under the user's allowance; a path does not bypass
usage limits.

## Improvements to prioritize next

| Priority | Improvement | Concrete completion criterion |
| --- | --- | --- |
| 1 | Practitioner review and stronger scoring anchors | Review each new role pair with a practitioner; use independently rated candidate examples, including reasonable alternative answers and “not assessed” cases |
| 1 | Add depth to existing professions | Give UX, marketing, HR, education, physical engineering, finance, and product accessible work samples plus deeper variants; avoid counting shared behavioral questions as specialist depth |
| 1 | Test the actual interviewer | Run complete provider conversations for each new family, checking conditional facts, neutral probes, corrections, pacing, and whether feedback cites genuine evidence |
| 2 | Job-description-based preparation | Let a candidate confirm role duties and competency weights, then suggest an existing vetted path; mark inferred requirements and gaps explicitly |
| 2 | Learning progression | Start with a baseline, offer drills tied to missing evidence, then use a fresh scenario to test transfer; distinguish replay improvements from new-scenario evidence |
| 2 | Technical breadth | Add frontend accessibility/debugging, backend API review, mobile, DevOps/SRE, data engineering, ML evaluation, security architecture, and manual/automation QA tracks inside their parent professions |
| 2 | Leadership breadth | Add first-time manager, delegation, performance coaching, cross-functional influence, strategy presentation, and executive decision simulations with level-appropriate rubrics |
| 2 | Broader access | Verify text-only parity, keyboard and screen-reader use, thinking time, plain-language prompts, and supported interview languages with human checks |
| 3 | Distinct multi-agent panels | If needed, implement explicit turn coordination and separately preserved evaluations; do not relabel a single-model roleplay as independent consensus |
| 3 | New workspaces | Add sandboxed code/SQL execution, real spreadsheet exercises, portfolio attachments, and one-way video only when their behavior and privacy controls are implemented |

Use observable, job-related competencies and consistent rating criteria.
[OPM's structured interview guidance](https://www.opm.gov/policy-data-oversight/assessment-and-selection/structured-interviews/)
supports this design principle. Adaptive follow-ups in this product are practice
features; they should not be advertised as a standardized hiring assessment.

Every regulated or safety-sensitive area needs practitioner review grounded in
the relevant setting. Fictional organization rules in a scenario must stay
distinct from medical treatment, professional certification, or jurisdictional
legal requirements. Current scenario execution and schema tests do not establish
professional competence.

## Domains to add after this expansion

Prioritize using unmet searches, interview-start demand, practitioner access,
and role-specific feedback. No market-demand ranking was measured in this audit.

| Next domain | Useful original interview concepts |
| --- | --- |
| Healthcare administration, allied health, pharmacy operations | Scheduling constraints, service handoffs, documentation checks, escalation within role |
| Manufacturing and industrial quality | Defect investigation, production handoff, continuous improvement, maintenance coordination |
| Agriculture, food production, and environmental services | Seasonal planning, resource allocation, quality checks, field-team handoffs |
| Transportation and warehouse operations | Dispatch disruption, inventory discrepancies, delivery communication, safe escalation |
| Construction management and building services | Work sequencing, change requests, contractor coordination, site documentation |
| Insurance, banking operations, and compliance | Document review, claim or case triage, controls, customer explanations using supplied policies |
| Nonprofit programs and fundraising | Program prioritization, grant narrative review, donor discovery, impact-evidence critique |
| Real estate and property operations | Tenant-service roleplay, maintenance triage, listing critique, vendor tradeoffs |
| Creative specialties | Editorial review, design portfolio defense, production planning, client feedback |
| Academic and admissions preparation | Research presentation, supervisor conversation, teaching demonstration, admissions motivation |

Admissions already exists in the legacy bank. It should eventually have its own
goal-based navigation so applicants seeking employment are not routed into an
MBA or medical-school admissions station accidentally.

“Anyone looking for a job” is a coverage goal, not a claim this bank already
represents every occupation, country, language, or hiring process. The current
hosted service is for adults 18 and older. The broadly shared foundations and
entry-level scenarios make the bank useful to more people immediately, while
the matrix above gives a concrete route to deeper coverage.

## Verification

Completed locally:

- Full Go test suite, `go vet ./...`, and API build passed.
- All **139 web tests**, ESLint, TypeScript, and production static export passed.
- `make validate-content` passed for all **185 scenarios** and pack/runtime
  fixtures; all **23 paths** resolve to real scenarios.
- JSON Schema validation passed for all **48 v1 scenarios** and **nine custom
  formats**. Legacy scenarios also passed the Go runtime content validator.
- Content progression tests verify real specialist entry/junior and deeper
  coverage for each new profession, plus cross-career availability.
- Checks verified that the mock preview contains current public summaries,
  with no private references or interviewer instructions, and that every new
  path round fits every profession advertised by that path.
- Browser inspection of the catalog at desktop and mobile sizes passed;
  profession selection surfaced specialist scenarios first. The paths page
  showed 23 paths, and selecting Skilled Trades returned its dedicated path
  plus the three shared career paths. Pinned-round setup and session creation
  were covered by a web test.
- Independent content review corrected mismatches between scoring anchors and
  valid alternatives, including digital delivery, written customer updates,
  count-based research comparisons, offer decisions, and ambiguous trial
  periods. Twelve shared behavioral references were revised for broader use.

No live-provider interviews, human scoring-calibration study, or production
deployment was performed for this expansion. No new content is marked
practitioner-reviewed solely because automated tests pass.
