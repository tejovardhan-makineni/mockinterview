# Corpus authoring standard — how to add interview questions

The corpus lives in `api/data/corpus/*.json` — **one JSON file per question**. It is
loaded + validated at startup (`internal/corpus`) and served client-safe (reference
answers never leave the server). This doc is the permanent standard; follow it to add
questions (by hand or by pointing an agent at it).

## Add a question in 3 steps

1. Create `api/data/corpus/<id>.json` following the schema below (`<id>` kebab-case,
   matches the `id` field and the filename).
2. Validate: `cd api && go build -o bin/mockinterview ./cmd/mockinterview && \
   ./bin/mockinterview -validate-corpus data/corpus` → must print `OK: N questions valid`.
3. It's live locally on restart; on prod it ships in the next `deploy-api.sh`.
   (`go test ./internal/corpus/` also validates the whole dir in CI.)

## Schema (every question)

```json
{
  "id": "kebab-case-unique",
  "title": "Human title",
  "track": "engineering | professional",
  "domain": "system_design | ml_system_design | coding | medicine | medical_residency | law | consulting_case | product_management | finance | behavioral | <new-domain>",
  "modality": "system_design | coding | written | conversational",
  "difficulty": "entry | junior | mid | senior | staff",
  "tags": ["...", "..."],
  "prompt": "The opening question/scenario the interviewer states.",
  "blurb": "One-sentence teaser shown to the candidate.",
  "rubric": [
    { "key": "snake_case", "label": "Human label", "description": "What a strong answer covers.", "weight": 1.0 }
  ],
  "reference": { /* modality-specific ideal-answer material — server only */ },
  "interviewer_notes": "How the AI should run this — when to interrupt, what to probe."
}
```

- **rubric**: 6–12 dimensions, each with a positive `weight` (0.6–1.4). These ARE the
  scoring dimensions for this question — the scorer reads them per-question, so tailor
  them to the domain. No hardcoded dimension list.
- **reference**: any valid JSON object; the scorer + director read it. Shape by modality:
  - `system_design`: `functional_requirements, nonfunctional_requirements,
    clarifying_questions, qualifying_questions, estimations{...}, core_components[],
    data_model[], api_design[], high_level_design, deep_dives[{topic,probe}],
    followup_bank[{trigger,question}], scaling[], bottlenecks[], tradeoffs[],
    alternative_solutions[], observability[], security[], reference_answer`.
    Include a `followup_bank` trigger on a datastore (CDC/Debezium) and one on a cache
    (eviction/stampede) — these drive the interviewer's interruptions.
  - `coding`: `constraints[], examples[{input,output,explanation}], test_cases[{input,expected}],
    optimal_time, optimal_space, approaches[{name,idea,time,space}], follow_ups[], reference_solution`.
    (Doc-style — no compiler; the LLM reads the code as text.)
  - `written` / `conversational` (professional): `scenario, model_points[],
    probes[{trigger,question}], red_flags[], follow_ups[], exemplar_answer`.

Read `api/data/corpus/url-shortener.json` as the depth/quality exemplar before authoring.

## Conventions

- `track`: `engineering` for design/coding, `professional` for everything else.
- Rubric keys are snake_case and domain-appropriate (e.g. behavioral:
  `situation_clarity, action_ownership, result_impact, reflection, communication`;
  clinical: `data_gathering, differential_diagnosis, clinical_reasoning, management_plan,
  safety, communication`).
- Content must be real, specific, senior-level. No placeholders. Don't invent facts about
  real companies or, for medical/legal, give prescriptive real-world advice — keep it
  educational/framework-based.
- Adding a **new domain** is free — just use a new `domain` string; the dashboard groups
  and filters by `track`/`domain`/`modality` automatically.

## Bulk authoring with agents

Point an agent at this doc + the exemplar, give it a batch of `(id, domain, modality,
difficulty, topic)` rows and a private output dir, and have it self-validate with
`./bin/mockinterview -validate-corpus <dir>` before reporting. Merge validated files
into `api/data/corpus/` and re-run the validator over the whole dir.
