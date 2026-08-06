# Contributing to mockinterview.live

Thanks for your interest! This project is built to be **modular** — almost every
improvement should touch **one file (or one small module) per layer**. This guide
shows you where things live so you can make a focused change with confidence.

## Ground rules

- Be kind. See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
- Keep changes scoped to one feature/module. If a change forces edits across
  many unrelated files, that's usually a smell — open an issue to discuss first.
- Every PR must pass CI: `go build/vet/test` for the API and `lint`/`test`/`build`
  for the web app (see [`.github/workflows/ci.yml`](.github/workflows/ci.yml)).
- No secrets in the repo. Copy `.env.example` → `.env` (gitignored) for local keys.

## Run it locally

You only need a Gemini key for a *real* interview; without one the app runs on a
deterministic offline stub.

```bash
cp .env.example .env         # optionally add GEMINI_API_KEY
make up                      # Postgres via docker-compose
make dev                     # API (:8080) + web (:3000)
# or click through with zero backend:
cd web && NEXT_PUBLIC_MOCK=1 npm run dev
```

Tests:

```bash
make test          # go test ./...  +  web unit tests
cd api && go test ./...
cd web && npm test && npm run lint
```

## The architecture in one paragraph

A Go modular monolith (`api/`) behind a Next.js static export (`web/`). Each
**feature** is an isolated slice on both sides. On the backend a feature is a
package under `api/internal/` that depends on a small **consumer-defined
interface**, not the concrete database. On the frontend a feature is one file
under `web/lib/features/` that owns its types + HTTP calls + mock. See
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and [`docs/TDD.md`](docs/TDD.md)
for the full picture and diagrams.

## "I want to change X" — where to go

| Change | Backend | Frontend | Data |
|---|---|---|---|
| **Resume review** logic | `internal/resume/resume.go` | `lib/features/resume.ts`, `app/resume-review/page.tsx` | `store/resumes.go` |
| **Interview results / scoring / report** | `internal/interview/`, `internal/scoring/` | `lib/features/interview.ts`, `app/results`, `app/report` | `store/sessions.go`, `store/reports.go` |
| **Add / change a voice** | `internal/persona/voices.go` (one line) | — | — |
| **Add / change a face (avatar)** | `internal/persona/faces.go` (one line) | register a builder in `web/components/studio/avatars/` under the same id | — |
| **Add an interviewer personality** | `internal/persona/personalities.go` + prompt in `internal/live/director.go` | — | — |
| **Interviewer behavior / pacing** | `internal/live/director.go` | — | — |
| **Add an LLM provider** | `internal/llm/` (implement the `Client` interface) | — | — |
| **Add an interview question** | drop a JSON file in `api/data/corpus/` (validated on load) | — | — |
| **Add an interview modality/domain** | corpus `modality`/`domain` + director/scoring read it from the rubric | labels in the relevant `lib/features/*` | — |
| **A new API endpoint** | feature package handler + route in `cmd/mockinterview/app.go` | a method on the owning `lib/features/*` slice | — |

## Golden rules that keep it modular

1. **Handlers depend on interfaces, not `*store.Store`.** Each feature package
   declares the `Repo` interface it needs. `*store.Store` (Postgres) and
   `memstore.Mem` (tests) both satisfy it. If you add a store method, add it to
   the feature's `Repo`, to `store.Datastore`, and to `memstore`.
2. **The frontend never calls `fetch()` directly.** Everything goes through the
   `api` seam. Add new calls to the owning `lib/features/*` slice and implement
   both the `http` and `mock` versions so mock mode never lies.
3. **Catalogs are registries, not scattered constants.** Voices, faces,
   personalities, and questions are data — add a row, don't thread a new literal
   through the codebase.
4. **Add a test.** Backend handlers get a test in `cmd/mockinterview/api_test.go`
   (uses `memstore` + the LLM stub — no DB/keys). Frontend logic gets a Vitest
   test next to it in `lib/`.

## Commit / PR

- Branch off `main`, keep PRs focused, write a clear description of *what* and *why*.
- Reference any related issue. Fill in the PR template.
- Green CI is required before review.
