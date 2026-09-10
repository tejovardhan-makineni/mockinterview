# Interview content contract

A **profession** selects relevant work. A **format** defines the interaction and
stages. A **workspace** is a tool: `coding`, `system_design`, `written` or
`conversational`. A **scenario** supplies original task facts and its rubric. A
**drill** is a short self-guided exercise after the interview. Avoid treating these
as interchangeable catalog categories.

## Version 1

The machine-readable schemas live in `api/data/schemas`. Runtime validation in
`api/internal/corpus` additionally checks references, supported professions,
format compatibility and unique rubric keys. Legacy scenarios are adapted at load
time to revision 1 and preview status without inventing provenance.

Each `api/data/corpus/<id>.json` uses its filename as its kebab-case `id` and has:

- `schema_version: 1`, positive `revision`, a matching `format_id`,
  `review_status: "preview"`, and `minutes` between 3 and 90.
- `title`, `track` (`engineering` or `professional`), `domain`, `areas`,
  `modality`, `difficulty` (entry/junior/mid/senior/staff), `tags`, a candidate
  `prompt` and a concise `blurb`.
- `rubric` with unique snake-case keys, labels, observable descriptions,
  positive weights up to 5 and optional score anchors keyed `"0"` through `"4"`.
  Prefer a small set of independent dimensions over redundant scoring categories.
- `reference`, `interviewer_notes` and `provenance` with `authorship` and
  `license`; optional `sources` must identify material actually used. A
  `reviewed` entry also requires an actual `reviewer` and `reviewed_at` date.
- Optional `learning_drills`: unique `id`, `title`, `prompt`, 1–20 `minutes`
  and a nonempty `checklist`. These are self-guided, without a model request.

Start from `work-sample-reservation-review.json`, `ai-output-critique-forecast.json`
or `incident-triage-checkout.json`. They are original AI-assisted **drafts**, not
calibrated reference assessments. Describe expected behavior at each score anchor
and replace generic anchors with concrete evidence as review improves the content.

## Private interviewer material

The director receives the full authored notes, reference and conditional probes.
The candidate receives only a safe summary. Runtime snapshots include the resolved
format definition; source files must reference formats by ID.

Required reference fields depend on the workspace:

| Workspace | Required reference fields |
|---|---|
| coding | `constraints`, `examples`, `test_cases`, `approaches` |
| system_design | `functional_requirements`, `deep_dives`, `followup_bank` |
| written / conversational | `scenario`, `model_points`, `probes` |

Use `facts: [{id, value, reveal_when}]` for conditional information. Never rely on
the model to invent a patient's vitals, a company policy or an incident metric.
`probes` and `followup_bank` contain `{trigger, question}` objects. Coding
`follow_ups` may contain strings. Make triggers specific enough to decide when to
ask, including sensible alternative approaches and corrections. Put the answer
key and reference solutions here, not in the initial candidate prompt.

Simulation allows clarification and neutral probes; it does not hand over a
solution before assessment. Coaching explicitly allows graduated assistance.
Target level and challenge are separate session settings. An approachable style
must not silently turn a simulation into coaching. Timing scales with the session
length, leaving most of a short station for the actual task.

## Reusable formats

`api/data/formats/<id>.json` contains `schema_version: 1`, positive `revision`,
`id`, `name`, `interviewer_role`, supported `workspaces`, `tool_policy` and
2–8 `stages`. Stages have a unique `id`, `title`, `kind`, `guidance` and a
positive `share`; all shares sum to 1. The first stage is `intro`, the last `wrap`.
Time shares are applied to the chosen duration. Keep introductions brief.

Current examples include work-sample defense, AI-output critique, incident
simulation, stakeholder simulation and reverse interviewing. Tool policy must
state whether execution or external AI is available. The current code and SQL
workspaces do not run code, and interviewers must not claim that they did.

## Validate and review

```bash
make new-scenario ID=my-original-scenario
# Edit scratch/content/corpus and its sibling formats directory.
cd api
go run ./cmd/mockinterview -validate-corpus ../scratch/content/corpus
cd ..
make validate-content
make preview-format ID=work-sample-reservation-review
```

The preview prints private director context for authors. Tests in
`internal/live/fixtures_test.go` consume `data/fixtures/director-context.json` and
check that conditional facts and probe triggers reach the director. These are
context-contract checks, not conversations with a real model. Add independent
candidate turn examples and provider evaluations when assessing behavior.

Scoring accepts only known rubric dimensions and exact quotes from candidate
turns or saved workspace evidence. Server rubric weights determine the aggregate.
Unobserved dimensions are not assessed; they are not scored as failure. Evidence
IDs must point to actual sources. The complete transcript is retained up to an
explicit 512 KiB scoring-evidence limit; larger inputs produce a recoverable error
instead of silently discarding late corrections. Quotes alone do not prove a
rating is correct: rubric reliability requires human review and calibration.

Content edits increment `revision`; behavioral format edits increment its
revision too. Session snapshots preserve the actual question, resolved format
and configuration. Avoid changing IDs to make a reused question appear new.
Fresh variants are preferred in packs; repeat practice remains useful but must
not be represented as an independent readiness measurement.

Before moving a draft into the catalog, verify original/licensed provenance,
fact consistency, fair difficulty, timing, plausible alternatives, accessibility
and evidence-based anchors. Do not copy proprietary questions or imply employer
endorsement. Consult [CONTRIBUTING.md](../CONTRIBUTING.md) for the review workflow.
