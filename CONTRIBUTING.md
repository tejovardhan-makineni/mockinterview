# Contributing to mockinterview.live

Help make interviews realistic, understandable and useful to learn from. We
welcome developers, interviewers, candidates, educators and accessibility testers.
Follow the [Code of Conduct](CODE_OF_CONDUCT.md). Report vulnerabilities privately
using [SECURITY.md](SECURITY.md).

## Start locally

Follow the [README setup](README.md#run-locally), including `make install` before
`make dev`. The development demo needs no API key or mail account. Real-provider
checks are optional and billable; never put keys or real candidate records in a PR.

Choose a focused change and open a branch or fork. A small fix does not need an
issue first. For a new workspace or broad format, use the format proposal issue
to explain the candidate task, interviewer role and feedback you intend to support.

## Add interview content

Read [docs/CORPUS.md](docs/CORPUS.md) for the versioned contract and examples.
`make new-scenario ID=my-original-scenario` and `make new-format ID=my-format`
create editable drafts under `scratch/content`, without changing the catalog.

1. Write an original scenario. Disclose AI assistance, authorship, licensing and
   sources. Do not copy confidential, paid or leaked interview questions.
2. Give the candidate enough starting information. Keep hidden facts explicit
   with reveal conditions. Include realistic probes for a partial answer, an
   alternative solution and a correction; do not force one memorized exemplar.
3. Define observable rubric dimensions, positive weights and level-appropriate
   anchors. Include what cannot be assessed and how coaching affects interpretation.
4. Add deterministic context fixtures and example turns for clarification,
   partial reasoning, a late correction, silence and wrap-up. Cover scoring
   evidence rejection when changing scoring behavior.
5. Validate drafts with `cd api && go run ./cmd/mockinterview -validate-corpus
   ../scratch/content/corpus`. Copy accepted drafts and referenced formats into
   `api/data/`, run `make validate-content`, and include the author preview in
   your own review. Do not put private answers in candidate-facing UI.
6. Submit a PR with the content checklist. New entries stay `preview`. A
   practitioner review records a real reviewer/date and the review's scope;
   it does not establish model calibration or hiring validity.

The reviewer checks task realism, timing, factual consistency, alternatives,
accessibility, provenance and rubric evidence against varied sample responses.
Before claiming a format is reliable, separately evaluate real-provider sessions,
compare independent reviewers' ratings, record disagreements and failure cases,
and test regression behavior on a held-out set. Do not invent a pass rate or
calibration result. Domain-sensitive scenarios need an appropriately qualified
reviewer and must remain educational practice.

## Code map

| Change | Main locations |
|---|---|
| Scenario, format, profession | `api/data/corpus`, `api/data/formats`, `api/internal/corpus` |
| Interview behavior, timing | `api/internal/live/director.go`, `policy.go` |
| Rubric scores, evidence, exercises | `api/internal/scoring` |
| Multi-round practice packs | `api/data/packs`, `api/internal/pack` |
| Session lifecycle, quota, history | `api/internal/interview`, `api/internal/store` |
| Workspace and room | `web/components/studio`, `web/app/interview` |
| Auth, profile, reports | Matching `api/internal` and `web/lib/features` modules |
| Original interviewer artwork | `web/components/studio/Avatar3D.tsx`, `ARTWORK.md` |

Keep backend handlers dependent on their small repository interfaces; update
both PostgreSQL and the memory store when a contract changes. Frontend data
access belongs in the owning feature API seam, with compatible mock behavior.
Prefer targeted tests of behavior and failure recovery over implementation copies.

```bash
make test
make lint
make build
make validate-content
```

CI must pass. Describe the concrete before/after behavior, validation, limitations
and screenshots when useful. Explain migrations and recovery for durable-state
changes. Never use real resumes, transcripts, provider keys or customer data in
fixtures. Contributor submissions use the project's AGPL v3 license unless an
explicit compatible exception is documented and approved.

## Audience and privacy boundaries

The hosted AI service is for adults 18+ practicing independently. New formats
must make that audience clear. Do not add minor-directed admissions, employer
selection, covert recording, face/emotion scoring or real patient/client workflows
without a separate product, provider and legal assessment. Use original fictional
fixtures, keep AI identity clear during roleplay, and avoid promises of guaranteed
jobs, professional competence or error-free feedback.

See the [legal readiness assessment](docs/LEGAL-READINESS-2026-09-10.md) and
[privacy operations guide](docs/PRIVACY-OPERATIONS.md) before changing data flows,
providers or sharing defaults. The hosted terms do not replace the code license;
private interviews and product feedback are not public source contributions.
