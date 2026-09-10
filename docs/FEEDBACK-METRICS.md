# Interpreting beta product feedback

Instrument: **`post-interview-v1`**, defined in the [questionnaire](BETA-FEEDBACK-QUESTIONNAIRE.md). The private dashboard at `/admin/feedback/` and its API were deployed on 10 September 2026; see the [release validation](FEEDBACK-RELEASE-2026-09-10.md). The cohort/window contract below matches the deployed implementation. Supplementary operational measures identified below remain separate from these dashboard metrics.

## Administrator API

`GET /api/v1/admin/interview-feedback/metrics` requires an authenticated account with the stored `admin` role. It accepts `days` (integer 1–365, default 30) and `group_by` (default `subject`). Supported groupings are `subject`, `domain`, `question`, `mode`, `provider`, `format`, and `level`. Unsupported groupings and invalid lookbacks return a validation error.

The response contains `schema_version`, `days`, `group_by`, `generated_at`, overall `totals`, per-group `groups`, and a methodological `note`. It does not expose raw survey comments, transcripts, or account identities. Group totals use `eligible_sessions`, `responded_sessions`, `pending_sessions`, and `response_rate`. Each group's `questions` contains dimension distributions and summaries. Access to this endpoint does not authorize publishing its small groups or repurposing participant records for research.

## Qualitative suggestions

`GET /api/v1/admin/interview-feedback/comments?limit=25&before=<opaque cursor>` is a separate administrator view of nonempty optional comments. It rechecks the stored administrator role on every request. The default page size is 25 and the maximum is 100. Results are ordered by `updated_at DESC, session_id DESC`; pass the returned `next_cursor` unchanged as `before` to request the next page. A null cursor means no next page was returned.

The response is `{items, next_cursor}`. Each item contains `session_id`, `version`, `question_title`, `subject_key`, `subject_label`, `mode`, `provider`, `status`, `comment`, `share_transcript`, `submitted_at`, and `updated_at`. It contains no email address, owner ID, transcript, or diagnostic payload. Free-text comments and small contextual groups can still identify a person; this is a restricted view, not anonymized public data.

This list is distinct from aggregate JSON/CSV exports and does not define the aggregate cohort or its denominator. Comment pages contain only people who chose to write something; do not treat them as a representative sample of all survey responses. Edits change ordering, so a series of pages is not an immutable historical snapshot.

`share_transcript` records the user's optional permission for maintainers to inspect that interview's transcript to investigate feedback. The flag does not automatically fetch or export a transcript and does not authorize research, quotation, or publication. Qualitative review must respect the separate purpose, access, retention, and consent boundaries described below.

## Count the cohort before calculating a rate

Every aggregate must describe its window, eligibility rule, instrument version, numerator, and denominator. Select a cohort of attempts once and compute the entire aggregate from that cohort, not from the newest page of survey responses or the administrator's recent-feedback list.

The eligible population is newly created attempts assigned a survey version, with a non-null server `started_at` and status `scoring`, `feedback_failed`, `complete`, `abandoned`, or `expired`. Exclude legacy attempts and unused reservations. Pending scoring or scoring failure does not mean the participant's product experience is absent; report availability is represented separately in the questionnaire. These predicates match the deployed implementation and are covered by release validation.

The cohort query uses server `started_at >= from AND started_at < to`, a fixed UTC window over started attempts, and reads the full qualifying cohort without a recent-response limit. The upper bound is the response's `generated_at`. The lower bound is exactly `generated_at - days × 24 hours`; the default is 30 elapsed days, and the accepted range is 1–365. The bounds are not rounded to midnight and are independent of browser time zones or daylight-saving transitions. This is not a session-creation, completion, or survey-submission window.

Eligibility is evaluated from the retained session's current status, and its latest saved response is joined when the aggregate is queried. A qualifying response submitted or edited later therefore contributes if its attempt is still in the selected started-at cohort. This is a current snapshot of that cohort, not a historical reconstruction of what was known at the end of the window.

For a selected cohort, report at least:

- **Eligible attempts:** the denominator for survey completion.
- **Submitted surveys:** eligible attempts with one valid persisted response for the assigned version.
- **Outstanding surveys:** eligible attempts without that response.
- **Completion rate:** submitted surveys / eligible attempts. The API returns `null` when the denominator is zero; render that as **No eligible attempts**, not 0% or 100%.

The survey is editable and stored once per session; analyze its current response once, not each submission or edit as another participant. Session/account deletion cascades to the survey and can change retained cohorts. Describe counts as a snapshot of retained application records; no separate immutable aggregate-retention mechanism is implied.

The API represents rates as fractions in `[0, 1]`; the UI displays percentages. For example, `0.75` renders as `75%`, not `0.75%`. Include raw counts to make rounding and small samples visible.

## Dimension distributions

For each dimension show five rated counts, each permitted unrated count, **rated n**, and **unrated n**. In the API, `distribution` maps each response code to its count, `answered_count` means **rated n** despite its broader-sounding name, and `unrated_count` means **unrated n**. `favorable_count`, `favorable_rate`, and `favorable_label` describe the version-specific summary below. Among submitted surveys, `rated n + unrated n` must equal that dimension's answer count. Missing surveys belong in completion statistics, not in an item's unrated category.

`unable_to_judge`, `report_not_read`, and `report_unavailable` are distinct responses, not zeros or neutral midpoints. Use rated n as the denominator for summaries of numeric choices. `favorable_rate` is `null` when rated n is zero; render that as **No rated responses**. Use total submitted answers for an unrated-response share. Never silently exclude these categories from the displayed sample size.

| Dimension | Descriptive summary | Required companion detail |
| --- | --- | --- |
| `usability_ease` | Positive share = (`4` + `5`) / rated n | All five counts and unable-to-judge count |
| `interviewer_realism` | Positive share = (`4` + `5`) / rated n | All five counts; people without comparable experience can be unrated |
| `subject_probe_quality` | Positive share = (`4` + `5`) / rated n | Subject group and wording version; all counts |
| `challenge_fit` | About-right share = `3` / rated n | Too easy = (`1` + `2`) / rated n; too hard = (`4` + `5`) / rated n; all five counts |
| `report_actionability` | Positive share = (`4` + `5`) / rated n | Separate unable-to-judge, not-read, and unavailable counts |
| `disruption_severity` | No-interruption share = `1` / rated n | Keep minor (`2`), moderate (`3`), major (`4`), and could-not-finish (`5`) counts and shares separately; `2` is not counted as favorable |

Example: 20 submitted surveys yield 15 rated usability answers, five unable-to-judge answers, and 12 ratings of `4` or `5`. The positive share is **12/15 = 80% among rated answers**. The unable-to-judge share is **5/20 = 25% of submitted answers**. Neither number is the survey-completion rate, whose denominator is all eligible attempts.

These are separate dimensions with different scale directions. **Do not average all items into an overall score.** Difficulty's preferred point is `3`, disruption's favorable response is `1` (no interruption), and the other dimensions increase positively. The API supplies a descriptive ordinal `mean` for the four positive-direction items when rated n is nonzero; `mean` is null for difficulty and disruption. It is also null for any item with no rated answers. Favor distributions and clearly labeled response shares over presenting a decimal mean as a precise scientific measurement. No benchmark or target threshold is validated merely by defining these formulas.

## Context that belongs on the server

Users should not have to type their scenario, difficulty, provider, model, attempt status, or dates into the survey. Derive those attributes from the session and available frozen scenario/configuration metadata. The client may select a session it owns, but its claims about that session are untrusted.

The implemented groupings use the session's frozen scenario domain/title/format, subject mapping, question ID, mode, provider, or `target_level` in session config. Missing metadata is grouped as `unspecified` where relevant; an unknown domain uses the questionnaire's `general` subject fallback. The level grouping recognizes `entry`, `junior`, `mid`, `senior`, and `staff`.

Scenario revision, selected challenge, workspace modality, provider model, and release can be useful additional context, but are not separate selectable groupings in this endpoint. Only expose a new breakdown after confirming that the implementation stores and joins the field correctly. In particular, a scenario's default difficulty is not necessarily the level selected for the attempt, and current catalog text is not necessarily the text used in an older attempt.

Avoid splitting a small cohort by every available dimension. Show sample counts and missing metadata. A low rating attached to one provider does not establish that provider caused it: scenario mix, user familiarity, chosen level, device/network conditions, release changes, and quota restrictions can differ. Do not publish small groups that make participants identifiable.

## Objective operational measures

Use actual server records for started/finished attempt counts, terminal status, report availability, scoring attempts, and recorded latency. Define the start and stop events for every duration. A timestamp difference does not automatically equal active user time. Do not ask users to estimate facts already recorded reliably.

The following are useful future or supplementary measures **only when the necessary records and definitions exist**:

- Report-production failures and retry recovery, distinguished from a survey response that the report was unavailable at the time.
- Recorded connection errors and reconnect events, distinguished from perceived interruption. Low turn counts do not prove a dropped connection.
- Next-attempt return after 7 or 30 days, using cohorts with enough follow-up time and accounting for weekly funded/daily personal-key limits.
- Survey-form completion time or drop-off, only with appropriate disclosed instrumentation. Server submission time alone does not reveal when a person started answering.

Do not imply these are implemented dashboard metrics without inspecting the code and validating the underlying records. Never infer camera attention, emotion, identity, or competence from ordinary survey/session metadata.

## Interpretation and research boundaries

The survey measures reported product experience. A high actionability score means respondents said the next practice step was clear; it does not show they learned the skill. Realism is a perception conditioned on interview experience. Subject-probe ratings do not verify subject-matter correctness. A favorable disruption rating is not evidence that no technical error occurred.

Mandatory response before the next interview can itself affect return behavior and invite minimal-effort answers. Users who never return, abandon an interview, cannot finish the flow, or decline to continue may be underrepresented. Report completion coverage and unrated rates alongside favorable shares. Do not claim that the sample represents all job seekers, all university students, or all users.

Before claiming skill improvement, arrange an appropriate study with independent outcomes, such as blinded human evaluation of a later interview, a justified comparison condition, and a predefined analysis. Observed changes after a release are descriptive unless the research design supports a causal claim. Do not substitute AI-generated report scores for independent validation.

Administrator access to account-associated feedback does not authorize publication, research enrollment, quotation, transcript reuse, or sharing records with a university. Keep required product feedback separate from optional research participation and optional contact/data-sharing choices. Discuss consent, institution review where applicable, access, retention, withdrawal, and deidentification before a study. Public source availability does not make participant records public.

## Maintainer checks before publishing numbers

1. Verify that the documented window/status predicates match the query and that aggregation covers the full cohort, not a paginated list.
2. Verify count identities, zero-denominator behavior, string-code validation, duplicate handling, and decimal-to-percentage formatting.
3. Check that legacy attempts, unused reservations, and explicitly identified test fixtures are treated as documented. Do not silently remove inconvenient low ratings.
4. Separate instrument versions and material wording changes; preserve the version-specific scale meanings and subject mapping.
5. Include the time window, source release, instrument version, eligible/submitted counts, rated/unrated counts, and known exclusions with any shared chart.
6. Review small-group and free-text disclosure risk before external sharing. Never publish raw comments or account-linked exports merely to substantiate an aggregate.

See [privacy operations](PRIVACY-OPERATIONS.md) for data-rights and retention limits. Final release validation must confirm the documented endpoint/window behavior and add evidence, while preserving unresolved research and legal decisions.
