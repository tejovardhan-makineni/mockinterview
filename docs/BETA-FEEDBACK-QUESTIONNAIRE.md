# Post-interview product feedback

Version: **`post-interview-v1`**. Deployed on 10 September 2026. This document defines the six-item questionnaire and its enforcement boundary. See the [release validation](FEEDBACK-RELEASE-2026-09-10.md) for the tested source, exact production artifacts and limits.

This is product feedback about an interview attempt, not the AI's assessment of the candidate and not enrollment in academic research. Ratings describe the user's experience. They do not establish learning gains, grading accuracy, hiring readiness, or clinical/legal competence.

## When feedback is required

New attempts carrying this survey version require feedback after they have started and ended. Eligible statuses are `scoring`, `feedback_failed`, `complete`, `abandoned`, and `expired`, with a non-null server `started_at`. An unanswered required survey prevents starting the **next new interview**. It must not prevent opening the existing report, history, settings, data export, deletion, or support. A scoring failure or an unavailable report must not force the user to claim they read a report.

Legacy attempts have no retroactive survey backlog. Unused reservations are excluded. The server determines whether an attempt started and ended; the browser cannot waive eligibility, forge completion, or satisfy the gate by hiding the form. The status selection above is enforced by the server and covered by the release validation.

Every item requires an answer, but an answer may be **Unable to judge**. All six answers may use that option. No rating is preselected, a favorable opinion is never required, and the comment is optional. Ordinary in-interview problem reports remain separate and do not satisfy this questionnaire.

## Questions and response choices

Store stable IDs and response codes, not display labels. Codes `"1"` through `"5"` are strings. Every item also accepts `"unable_to_judge"`, displayed as **Unable to judge**. The report item has two additional explicit responses.

| Dimension ID | Question | `1` | `2` | `3` | `4` | `5` |
| --- | --- | --- | --- | --- | --- | --- |
| `usability_ease` | How easy was it to use the app during this interview? | Very difficult | Difficult | Neither easy nor difficult | Easy | Very easy |
| `interviewer_realism` | Compared with interviews you have experienced, how realistic did the interviewer’s behavior feel? | Not at all realistic | Slightly realistic | Moderately realistic | Very realistic | Extremely realistic |
| `subject_probe_quality` | How well did the interviewer explore **[subject focus]**? | Not at all well | Slightly well | Moderately well | Very well | Extremely well |
| `challenge_fit` | For the level you selected, how challenging was this interview? | Much too easy | A little too easy | About right | A little too hard | Much too hard |
| `report_actionability` | After reading the report, how clear is what you should practice next? | Not at all clear | Slightly clear | Moderately clear | Very clear | Extremely clear |
| `disruption_severity` | How much did technical problems interrupt this interview? | No interruption | Minor interruption | Moderate interruption | Major interruption | Could not finish |

For `report_actionability`, also offer:

- `"report_not_read"`: **I have not read the report**.
- `"report_unavailable"`: **The report is unavailable**.

Explain near the realism question that users without comparable interview experience can choose **Unable to judge**. The same option applies when an attempt ended too early to assess a dimension. Do not turn these responses into zero, a midpoint, or a negative rating.

Optional comment: **What should we improve first? Please avoid sharing personal, confidential, or identifying information.** The API accepts at most 2,000 Unicode characters, requires valid UTF-8, trims surrounding whitespace, and redacts recognized credential patterns. Redaction is not a guarantee that all identifying or secret material will be removed. A validation error must preserve the user's completed answers.

## Subject-specific wording

Use the attempt's server-owned scenario domain to select the subject group and focus. Do not accept a client-supplied domain, group, prompt, or question ID as authoritative. The following mapping covers all **143 scenarios across 35 domains** in the corpus reviewed on 10 September 2026. Counts are a catalog snapshot, not usage or survey-response counts.

| Subject group | Scenario domains | Scenarios | Subject focus |
| --- | --- | ---: | --- |
| `software_design` | `system_design`, `low_level_design` | 42 | your reasoning about software design decisions |
| `ml_design` | `ml_system_design` | 14 | your reasoning about machine-learning system decisions |
| `coding` | `coding` | 17 | your reasoning about the coding solution |
| `work_sample` | `code_review`, `sql_review`, `ai_critique` | 3 | your reasoning about the work sample |
| `behavioral` | `behavioral` | 13 | the decisions you made in the experience you described |
| `consulting` | `case` | 4 | your reasoning about the business case |
| `engineering_fundamentals` | `circuits`, `geotechnical`, `mechanical_design`, `mechanics`, `power_systems`, `signals_systems`, `structural`, `thermodynamics`, `transportation` | 9 | your engineering reasoning |
| `clinical_reasoning` | `clinical_reasoning` | 4 | your reasoning about the fictional clinical case |
| `healthcare_scenarios` | `medical_residency`, `prioritization` | 9 | your decisions in the fictional healthcare scenario |
| `legal` | `issue_spotting`, `legal_practice` | 8 | your reasoning about the fictional legal scenario |
| `data_experimentation` | `experimentation` | 4 | your reasoning about data and evidence |
| `product_marketing` | `product_sense`, `go_to_market` | 4 | your reasoning about product or market decisions |
| `finance` | `valuation` | 4 | your financial reasoning |
| `ux` | `design_critique`, `portfolio_review` | 2 | your reasoning about user-experience decisions |
| `roleplay` | `sales_roleplay`, `stakeholder_roleplay`, `employee_relations`, `classroom_management` | 4 | your decisions during the role-play |
| `incident_response` | `incident_response` | 1 | your reasoning about incident response |
| `candidate_questions` | `candidate_questions` | 1 | the role-fit concerns behind your questions |
| **Total** | **35 domains** | **143** | |

Unknown future domains use group `general` with focus **your reasoning about this scenario**. The fallback keeps a valid new format usable; contributors should add a more appropriate mapping and update coverage tests when introducing a domain. Modality and profession can be shared across domains, so neither the first listed profession nor a browser navigation category is a reliable substitute for this mapping.

## Data contract and trust boundaries

The deployed routes below require authentication; ownership checks apply to session routes.

| Route | Purpose |
| --- | --- |
| `GET /api/v1/feedback/required` | List this user's eligible attempts that still need a response. Returns `items` and `total`. |
| `GET /api/v1/sessions/{id}/feedback` | Read eligibility, report availability, the server-generated questionnaire, and any saved response for an owned attempt. |
| `PUT /api/v1/sessions/{id}/feedback` | Validate and persist a response for an eligible owned attempt, then return its updated envelope. |

The envelope contains `session_status`, the attempt's `feedback_version`, `required`, `eligible`, `report_available`, `questionnaire`, and `response`. The questionnaire carries `version`, `subject_key`, `subject_label`, and the six questions with their permitted options. Clients should render those server-provided definitions rather than maintaining a separate authoritative copy of domain mappings or accepted answers.

The submission shape uses `version` plus an `answers` object containing exactly the six known dimensions. Optional `comment` and independent `share_transcript` fields may be included. For example:

```json
{
  "version": "post-interview-v1",
  "answers": {
    "usability_ease": "4",
    "interviewer_realism": "unable_to_judge",
    "subject_probe_quality": "3",
    "challenge_fit": "3",
    "report_actionability": "report_unavailable",
    "disruption_severity": "2"
  }
}
```

The session is identified by the owner-scoped API contract. The server must validate ownership, survey version, attempt eligibility, exact dimension keys, and allowed response codes. Reject unsupported versions, missing or extra dimensions, numeric values in place of strings, and report-only codes on other dimensions. Never trust a claimed completion flag or client-provided timestamps, session metadata, or aggregate scores.

The store keeps one editable response per session. Saving again replaces its answers, comment, and optional transcript-sharing choice; it does not add another response. `submitted_at` remains the first submission time, while `updated_at` changes when those values change. An identical retry leaves the original timestamps intact. A successful save is authoritative only after persistence. The form must preserve answers on failure and must not unlock a new interview based on optimistic browser state. Release validation must exercise the implemented routes and retry behavior.

Session or account deletion cascades to this dedicated survey record. Ordinary ad hoc feedback has a separate lifecycle and must not be confused with that behavior. The survey must be included in the owner's data export; release validation must verify export and deletion scope.

The feedback is account-associated. Display that fact before submission. Do not describe a survey without a visible name field as anonymous. Session linkage and ordinary operational metadata do not authorize access to a transcript for research or public distribution. Keep private comments out of public GitHub issues, analytics labels, and model prompts.

Administrators can review nonempty optional comments through a separate, paginated suggestions route. It checks the stored administrator role on each request and returns limited interview context plus the recorded transcript-inspection choice; it does not return email addresses, owner IDs, transcripts, or diagnostics. Comments may still contain identifying material supplied by the user. This view is separate from the aggregate export and does not authorize public quotation or research reuse. See the [metrics and suggestions API](FEEDBACK-METRICS.md#qualitative-suggestions) for its contract.

## Product feedback and optional research

Required product feedback must not bundle permission to join a study, share interview transcripts, share additional browser diagnostics, be contacted, or publish a quotation. Those choices require a separate explanation and must be optional, unchecked, and independent of the next-interview gate. Refusing them must not invalidate the six survey answers.

Before inviting academic collaborators to use participant data, agree on the study protocol, necessary institution review, consent and withdrawal handling, access, retention, and publication rules. An open-source software license does not license users' interview data. See [privacy operations](PRIVACY-OPERATIONS.md) for account-linked data, deletion scope, backups, and private rights requests.

## Maintaining the questionnaire

- Preserve dimension IDs and response meanings within a version. Do not silently change a question, numeric anchor, group meaning, or eligibility rule while comparing its results as one instrument.
- Use a new version for substantive wording or scoring changes. Keep historical definitions available and accept only the version assigned to the attempt; a release must not manufacture a legacy backlog.
- Derive subject metadata from the frozen attempt context where available. Later edits to the catalog must not relabel an earlier response as if it used the new scenario.
- Adding a new format should include subject-mapping review, an unknown-domain fallback check, and questionnaire coverage. No domain-specific medical, legal, or hiring claim follows from a positive user rating.
- Test all-unable responses, unavailable/unread reports, authorization boundaries, duplicate submission/retry, legacy and unused-reservation exclusions, and continued access to existing reports and data rights routes.

Read [feedback metrics](FEEDBACK-METRICS.md) before interpreting or publishing results.
