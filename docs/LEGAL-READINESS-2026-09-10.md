# Legal readiness assessment — 10 September 2026

This report combines a source/data-flow audit and current official US and international sources. It is an applicability assessment for the hosted public beta, **not legal advice from counsel, an all-world certification, or a statement that every listed law applies**. Free access, open source and small size do not create a universal exemption.

## Scope and open owner decisions

The assessed purpose is private interview rehearsal: individuals receive AI practice feedback, without employer selection, advertising, data sale or paid checkout identified in this review. Camera self-view is local in the current client; audio and text can reach AI providers. These facts must be reassessed when the product changes.

**Still unanswered:** the operator's legal identity, establishment/state/country, commercial status, intended countries and actual age audience. Do not infer these from the domain, maintainer email or hosting region. Also confirm whole-business revenue, affiliates/headcount, complete provider contracts, and actual log/backup retention. The existing private contact is [makinenitejovardhan@gmail.com](mailto:makinenitejovardhan@gmail.com); it is not a substitute for identifying the legal controller. No new entity, regulator registration, representative appointment or contract acceptance has been performed.

## Evidence and implementation status

| Status at drafting | Evidence or outstanding work |
| --- | --- |
| Audited baseline | Source `83f17fa510ea614f39805d04400067c5b85499b1`: email verification/recovery; authenticated export, session/account deletion; private support; optional feedback-sharing flags; text practice; local optional camera preview; encrypted, expiring BYOK credentials. These controls do not establish legal compliance. |
| Provider fact verified | The hosted Gemini API key's parent project has active billing, checked through official provider metadata without a paid model request. Evidence is retained privately as `legal-provider-billing-check-2026-09-10.json`; no secret belongs in Git. User BYOK billing remains unverified. |
| New work pending validation/deployment | Versioned adult/terms/privacy acknowledgments and hosted-route enforcement; pre-upload/pre-voice notices; BYOK eligibility acknowledgment; disabling unused camera-analysis ingestion; resume deletion and more accurate privacy/terms copy. Presence in a working tree does not mean these controls are live. |
| Owner/legal work open | Identity/audience, lawful bases and sensitive-data policy, regional scope/representation, vendor agreements/transfers, retention decisions, DPIA screening and any needed local advice. |

The release owner must replace the pending status with exact tested source/revision evidence before claiming deployment. See [privacy operations](PRIVACY-OPERATIONS.md) and the [release runbook](RELEASE-RUNBOOK.md).

## Data that drives the assessment

| Flow | Relevant baseline behavior |
| --- | --- |
| Account and email | Email/password go to the API; password hashes and account data stay in PostgreSQL. Resend receives recipient/action-link data for verification and recovery. Browser storage contains authentication state. |
| Resumes | Upload immediately extracts/parses content through the configured reasoning provider; optional later interview inclusion is a different choice. Extracted text, profiles and reviews are retained. No original-file persistence was found in this upload path. |
| Interviews | Answers, transcript, workspace and reports are stored; reasoning providers receive relevant evidence. Voice streams through the API to Gemini Live. No application raw-audio recording store was found; this does not establish provider retention. |
| Camera/behavior | Current self-view sends no frames. The baseline API still accepted legacy gaze/expression-shaped samples; disabling it is pending, so a blanket claim that the whole service cannot receive these was unsupported. |
| Feedback | Comments are linked to an account; diagnostics-off does not mean anonymous. Session deletion does not automatically erase separately stored feedback. Optional context/transcript permissions are not public publication or unrestricted research consent. |
| Deletion limits | History/resumes have no automatic general expiry at baseline. Short-lived tokens/keys/usage records have cleanup jobs. Browser copies, downloaded exports, provider records and backups need separate handling. |

Detailed handling and retention evidence are in [PRIVACY-OPERATIONS.md](PRIVACY-OPERATIONS.md). Minimize sensitive and third-party submissions; fictional medical/law scenarios do not authorize uploading real patient/client records.

## Applicability matrix

The actions below are conditional on the stated trigger. Primary sources establish legal rules; applying them to this product remains a documented judgment.

| Area | Trigger, current date and practical consequence |
| --- | --- |
| US truthful claims/security | FTC jurisdiction can apply without a large-user threshold. Privacy and AI-performance promises must match reality: no guaranteed jobs, perfect security or unsupported “never trained/retained” claims. California's commercial-service privacy-notice law can apply below CCPA thresholds. [FTC AI privacy guidance](https://www.ftc.gov/policy/advocacy-research/tech-at-ftc/2024/01/ai-companies-uphold-your-privacy-confidentiality-commitments), [CalOPPA §22575](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=BPC&sectionNum=22575.) |
| US state privacy scope | CCPA's current revenue threshold is $26,625,000, alongside other statutory tests; user count alone does not decide coverage. Other states use different business/sensitive-data tests. Confirm business model, affiliates, audience and sale/sharing facts; do not claim a universal small-service exemption. [CCPA definition](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CIV&sectionNum=1798.140.), [adjusted threshold](https://privacy.ca.gov/laws-and-regulations/monetary-thresholds-in-the-ccpa/), [Texas AG](https://www.texasattorneygeneral.gov/es/node/259071) |
| Children | COPPA covers child-directed services and general services with actual knowledge of under-13 collection. Most revised-rule compliance was due **22 April 2026**. An adult assertion is a scope control, not verified age or a defense to known minors. Provider and UK rules extend beyond under-13s. [FTC compliance guide](https://www.ftc.gov/business-guidance/resources/childrens-online-privacy-protection-rule-six-step-compliance-plan-your-business), [final rule](https://www.federalregister.gov/documents/2025/04/22/2025-05904/childrens-online-privacy-protection-rule) |
| Recording/biometrics | State recording laws require context-specific analysis; browser microphone permission does not explain provider processing or protect bystanders. BIPA distinguishes voiceprints/face geometry from ordinary audio/photos. Keep voice identification, face analysis and sensitive-trait inference outside scope; verify vendor behavior. [California §632](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=PEN&sectionNum=632.), [BIPA definitions](https://witnessslips.ilga.gov/legislation/ilcs/fulltext?DocName=074000140K10) |
| Consumer health | Washington's health-data law can reach small businesses and health disclosures/inferences outside HIPAA. Fictional cases differ from linked real health data. Assess sensitive uploads, collection/sharing, deletion and any separate notice requirement; Nevada has separate rules. [Washington law](https://app6.leg.wa.gov/rcw/default.aspx?cite=19.373&full=true), [Nevada law](https://www.leg.state.nv.us/nrs/nrs-603a.html), [HIPAA scope](https://www.hhs.gov/hipaa/for-professionals/covered-entities/index.html) |
| US employment/chatbots | Private practice differs from employer hiring tools under NYC/Illinois rules. Colorado's replacement consequential-decision law and separate conversational-AI law require review before **1 January 2027**; narrow-topic exclusions are conditional, not automatic. Keep roleplay visibly AI and do not present fictional licensed professions as actual professional advice. [NYC](https://www.nyc.gov/site/dca/about/automated-employment-decision-tools.page), [Illinois](https://www.ilga.gov/documents/legislation/ilcs/documents/082000420K5.htm), [Colorado SB26-189](https://leg.colorado.gov/bills/sb26-189), [HB26-1263](https://leg.colorado.gov/bills/hb26-1263) |
| EEA GDPR scope/representation | EEA establishment, intentional offers (free counts), or monitoring can trigger GDPR. Mere website accessibility is insufficient alone. A non-EEA operator under Article 3(2) must evaluate Article 27 representation; recurring hosted accounts weaken the narrow occasional-processing exception. [EDPB Articles 3/27 guidance](https://www.edpb.europa.eu/sites/default/files/files/file1/edpb_guidelines_3_2018_territorial_scope_after_public_consultation_en_1.pdf) |
| GDPR lawful processing/notice | Determine Article 6 basis per purpose; special-category processing also needs an Article 9 condition. Voice is not automatically biometric identification, but answers/resumes may expose health or beliefs. Article 13 notices need real identity, purposes/bases, recipients, transfers, retention and rights. Policy acknowledgment is not blanket sensitive-data consent. [EDPB lawful bases](https://www.edpb.europa.eu/sme/be-compliant/process-personal-data-lawfully_en), [Commission notice obligations](https://commission.europa.eu/law/law-topic/data-protection/information-business-and-organisations/obligations_en) |
| GDPR vendors/transfers/risk | Article 28 processor agreements, transfer mechanisms/assessments and risk-appropriate security are separate requirements. Screen for an Article 35 DPIA; a full assessment is needed where likely high risk. A statutory DPO is conditional, not automatic for every small AI app. US hosting alone neither proves illegality nor resolves transfers. [EDPB processors](https://www.edpb.europa.eu/sme/learn-the-basics/data-controller-or-data-processor_en), [transfers](https://www.edpb.europa.eu/sme/be-compliant/international-data-transfers_en), [DPC DPIAs](https://www.dataprotection.ie/en/organisations/know-your-obligations/data-protection-impact-assessments), [DPO criteria](https://www.edpb.europa.eu/sme/be-compliant/data-protection-officer_en) |
| EU AI Act | Article 50 transparency applies **2 August 2026**: first-interaction AI disclosure and, where applicable, technical marking/detectability of generated content. A visible badge alone does not resolve audio marking. Following the July 2026 Omnibus, Annex III high-risk duties start **2 December 2027**, Annex I embedded-product duties **2 August 2028**. Private candidate practice is not automatically employment high risk. [Commission transparency FAQ](https://digital-strategy.ec.europa.eu/en/faqs/transparency-obligations-under-article-50-ai-act), [current dates](https://digital-strategy.ec.europa.eu/en/news/ai-omnibus-enters-force), [employment examples](https://ai-act-service-desk.ec.europa.eu/pl/node/464) |
| EU prohibited practices/accessibility | Avoid workplace/education emotion inference and prohibited sensitive biometric categorization. Open source is not a blanket Article 5/50 exception. The EAA covers listed services including e-commerce, not every website; service microenterprises have a conditional exemption (<10 people and turnover or balance sheet ≤€2m). Confirm actual scope; pursue accessibility regardless. [Article 5](https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-5), [EAA guidance](https://www.ccpc.ie/enforcement-and-regulation/market-surveillance/accessibility/accessibility-for-businesses/european-accessibility-act-guidelines-for-microenterprises) |
| UK | Assess UK GDPR separately and the Children's Code where relevant services are likely accessed by under-18s. PECR covers browser storage/pixels, not only cookies. Necessary authentication can be exempt; current April 2026 guidance includes conditional statistical exceptions. Do not invent an analytics opt-out for nonexistent analytics. [ICO age assurance](https://ico.org.uk/about-the-ico/what-we-do/information-commissioners-opinions/age-assurance-for-the-children-s-code/6-expectations-for-age-assurance-and-data-protection-compliance/), [current storage guidance](https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guidance-on-the-use-of-storage-and-access-technologies/) |
| Canada/Québec | PIPEDA commercial-activity scope is not decided by a free feature alone. Québec adds privacy governance, relevant system-development assessments and an assessment/agreement before out-of-Québec transfers. Determine local nexus, meaningful consent, rights and vendor accountability. [OPC commercial activity](https://www.priv.gc.ca/en/privacy-topics/privacy-laws-in-canada/the-personal-information-protection-and-electronic-documents-act-pipeda/pipeda-compliance-help/pipeda-interpretation-bulletins/interpretations_03_ca/?wbdisable=true), [CAI Law 25](https://www.cai.gouv.qc.ca/protection-renseignements-personnels/sujets-et-domaines-dinteret/principaux-changements-loi-25) |
| Brazil | LGPD can apply through processing/collection in Brazil or offers/data concerning people located there, regardless of foreign hosting. Assess sensitive data, rights and Brazilian transfer mechanisms; EU SCCs are not automatically enough. [LGPD Article 3](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm), [ANPD transfers](https://www.gov.br/anpd/pt-br/assuntos/assuntos-internacionais/transferencia-internacional-de-dados/international-affairs) |
| India | Principal DPDP private-sector obligations are phased to **May 2027**, eighteen months after November 2025 Gazette publication; some institutional provisions are already effective. Do not label everything operative today or assume existing IT/consumer/security duties disappear. Confirm the operator's Indian connection and exact commencement when planning. [Official commencement notification](https://www.meity.gov.in/static/uploads/2025/11/c56ceae6c383460ca69577428d36828b.pdf), [Rules](https://www.meity.gov.in/static/uploads/2025/11/53450e6e5dc0bfa85ebd78686cadad39.pdf) |

Further targeted-country review is required. For example, Switzerland has its own representative conditions, Australia has qualified small-business exemptions, and New Zealand's indirect-collection notice rule started May 2026. These are not interchangeable GDPR tests. [FDPIC](https://www.edoeb.admin.ch/en/representatives-in-accordance-with-article-14-fadp), [OAIC](https://www.oaic.gov.au/privacy/privacy-guidance-for-organisations-and-government-agencies/organisations/small-business), [NZ OPC](https://www.privacy.org.nz/resources-and-learning/a-z-topics/ipp3a/)

## Audience review: concrete catalog findings

A source search of the landing page, catalog, packs and scenarios found no explicit K–12, high-school, teen or undergraduate-admissions offering. `teacher-classroom` addresses a teaching professional; `mba-admissions` asks about an existing career; `medicine-mmi` already describes residency-style practice. The individual `mmi-teamwork` prompt says only “students,” and the Education label is broad. These are audience ambiguities, not proof of child-directed use.

Recommended bounded changes: make 18+ personal practice clear on landing/catalog pages, label teaching-professional practice clearly, and give the MMI student scenario explicit adult medical-training context. Withhold/remove any future minor-directed admissions formats from hosted Gemini pending a separate provider/legal solution. There is no basis to remove adult MBA/teacher scenarios merely for mentioning schools. Actual marketing and user evidence still matter; a source search cannot prove minors are unlikely to access the service.

## Provider eligibility and contracts

Gemini's current terms require 18+ use and prohibit clients directed toward or likely accessed by minors. EEA/UK/Swiss clients must use Paid Services; API paid status depends on an active billing account. Unpaid services permit improvement/human review and prohibit personal/sensitive/confidential inputs. Paid input/output receives different treatment, including a processor agreement; do not generalize “no training” across providers or plans. [Gemini terms, effective 23 March 2026](https://ai.google.dev/gemini-api/terms)

Hosted billing is verified. A separate unchecked BYOK confirmation of authorized use and active project billing, recorded/enforced server-side, is a practical minimum control. It is **an attestation, not verified billing or a contractual safe harbor**. Reject known ineligible keys; resolve residual uncertainty or restrict the mode. Do not request keys or billing documents in public support.

Confirm accepted agreements and applicable entities for [Google processor terms](https://business.safety.google/processorterms/), [Google Cloud DPA](https://cloud.google.com/terms/data-processing-addendum) and [Resend DPA](https://resend.com/legal/dpa). Record recipients, countries, subprocessors, retention and transfer safeguards. These documents differ by service; no contract was accepted during this review.

## Open-source rights, brand and accessibility

The public repository provides the AGPL-3.0 license, contribution/license rules,
private vulnerability reporting, conduct guidance, original interviewer artwork
provenance and source access. Preserve the corresponding source of the deployed
version and third-party copyright/license notices when distributing or modifying
the app. AGPL network-source duties do not grant rights in unrelated question
text, employer trademarks or historical assets. [GNU license guidance](https://www.gnu.org/licenses/),
[AGPL remote source provision](https://www.gnu.org/licenses/agpl-3.0.de.html).

The unverified legacy avatar binaries were removed from public Git history with a
verified private backup retained. **Older question-corpus authorship remains
unverified**, as disclosed in NOTICE.md; a preview label is not copyright
permission. The maintainer must review provenance and replace/remove material
without adequate rights before claiming complete content clearance. No automatic
DCO/CLA requirement applies to every project; current explicit inbound licensing
is documented.

A private copyright contact is available. If relying on US section512 safe
harbors, assess eligibility and the appropriate registered/public designated
agent, notice/counter-notice and repeat-infringer procedures. A general contact
email alone does not establish safe-harbor qualification. Registration was not
performed. [US Copyright Office section512 guidance](https://www.copyright.gov/512/index.html).

Before investing in broad branding, commission appropriate trademark clearance.
Owning mockinterview.live and publishing open-source code do not establish rights
to mockinterview.io or clear similar service names. A federal database search is
only part of a comprehensive search; no trademark clearance is claimed.
[USPTO clearance guidance](https://www.uspto.gov/trademarks/search/comprehensive-clearance-search-similar-trademarks).

The app offers text-only practice, optional camera, a plain-text editor alternative
and reduced-motion support. New form labels and deliberate unchecked choices are
reviewed as implementation controls, not WCAG certification. Private-business ADA
TitleIII scope depends on the operator/service and jurisdiction; do not import the
TitleII government-web deadline. Run keyboard/screen-reader and timed-interview
accommodation testing with participants and retain a private accessibility route.
[DOJ web accessibility guidance](https://www.ada.gov/resources/web-guidance/).

## Closure criteria

1. Owner supplies identity/location/audience and confirms business/provider facts; update notices accurately.
2. Validate and deploy the pending controls, including rejection before provider calls and continued access to recovery/export/deletion for legacy users.
3. Complete processing/retention records, vendor/transfer review and regional representative/DPIA/counsel decisions; audit generated-audio marking.
4. Exercise rights, incident, underage/sensitive-upload and backup-restoration procedures in [privacy operations](PRIVACY-OPERATIONS.md). Triage **all 50 US states plus DC/territories and relevant foreign laws** when an incident's affected population requires it; this report is not that exhaustive incident-specific survey.
5. Reassess before minors, employer/school decisions, emotion/identity analysis, new providers, marketing, paid plans or new target countries. Automated tests and legal notices cannot establish zero bugs or universal legal compliance.
