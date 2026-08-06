# Technical Design Document — mockinterview.live

Status: living document · Audience: contributors and reviewers · Companion to
[`ARCHITECTURE.md`](ARCHITECTURE.md) (the map) — this doc explains the *why* and
the *contracts*.

---

## 1. Problem & goals

Build a realistic AI mock-interview platform: an interviewer that speaks with a
human voice + 3D face, watches the candidate work on a whiteboard / code editor /
written pad, asks and probes like a real interviewer, and produces a scored,
corpus-driven report plus behavioral feedback — across engineering **and**
professional domains (medicine, law, consulting, PM, finance, …).

**Design goals, in priority order**

1. **Runs locally with only a Gemini key** — and fully offline (deterministic
   stub) with no key at all, so the whole product is clickable for dev and demos.
2. **Modular & extensible** — improving one feature (resume review, results,
   voices, faces, a provider, a modality) touches **one module per layer**.
3. **Cheap to run** — client-side behavioral analysis, scale-to-zero Cloud Run,
   shared Cloud SQL, static-export web, batched/end-of-interview scoring.
4. **Correct & testable** — the full API is exercised in CI with no DB and no
   external keys.

**Non-goals (for now):** multi-tenant orgs, real-time collaborative interviews,
mobile-native apps, a plugin marketplace.

---

## 2. High-level architecture

A **Go modular monolith** API (chi + pgx, single binary, embedded migrations)
behind a **Next.js static export** (Firebase Hosting). Postgres for state. Gemini
for live native-audio voice, TTS previews, and reasoning/scoring — with all
*reasoning* behind a provider-agnostic interface (Gemini/OpenAI/DeepSeek/xAI/
Meta/Anthropic + stub); the *voice transport* is always Gemini Live.

See `ARCHITECTURE.md` for the diagrams. The rest of this doc is the module
contracts that make the system modular.

---

## 3. The modularity contract (the core design decision)

Two symmetric rules, one per side of the wire.

### 3.1 Backend: consumer-defined interfaces over a shared datastore

Handlers **never** depend on the concrete database. Each feature package declares
the *narrow* interface it actually needs, next to the code that uses it:

```go
// internal/resume/resume.go
type Repo interface {
    SaveResume(ctx, userID, filename, parsedText string, parsedJSON json.RawMessage) (store.Resume, error)
    LatestResume(ctx, userID string) (store.Resume, error)
    SaveResumeReview(ctx, userID, resumeID, provider, model string, result json.RawMessage) (string, error)
}
func New(st Repo, ai llm.Client, reasonModel string) *Service { … }
```

- `*store.Store` (Postgres) implements every feature's `Repo` — it's the
  production wiring in `cmd/mockinterview/app.go`.
- `store/memstore.Mem` (in-memory) also implements them — it's the test wiring.
- `store.Datastore` is the **union** of all feature methods; the composition root
  holds one `Datastore` value and passes it to every `New()`. A compile-time
  assertion (`var _ store.Datastore = (*Store)(nil)` and the same for `Mem`)
  guarantees both implementations stay complete.
- `scoring.ReportStore` and `live.Store` are the same pattern for those packages.

**Why:** a contributor changing resume review reads a 3-method interface, not a
30-method god object. Tests inject a fake without a database. Swapping Postgres
for something else means one new `Datastore` implementation, zero handler edits.

**The rule when you add a store method:** add it to (1) the feature's `Repo`,
(2) `store.Datastore`, (3) `memstore`. CI fails if you miss one.

### 3.2 Frontend: feature slices behind one composed seam

Every feature is one file under `web/lib/features/` exporting three things:

```ts
export interface ResumeSlice { uploadResume(f: File): Promise<Resume>; … }
export const resumeHttp: ResumeSlice = { … };   // talks to the Go API
export const resumeMock: ResumeSlice = { … };   // localStorage-backed, offline
```

`lib/api.ts` is a *thin composer* — it intersects the slice interfaces into one
`Api` type and picks `http` vs `mock` per `NEXT_PUBLIC_MOCK`:

```ts
export type Api = AuthSlice & ProfileSlice & ResumeSlice & CatalogSlice & InterviewSlice;
export const api: Api = useMock
  ? { ...authMock, ...profileMock, ...resumeMock, ...catalogMock, ...interviewMock }
  : { ...authHttp, ...profileHttp, ...resumeHttp, ...catalogHttp, ...interviewHttp };
```

**Rules:** components never call `fetch()` — they call `api`. Every `http` method
has a `mock` twin so offline mode never lies. Types live with the feature that
owns them; `lib/types.ts` is only a back-compat barrel.

---

## 4. Key module contracts

### 4.1 Persona catalogs (`internal/persona`)

Voices, faces, and personalities are **data registries**, one file each, with
`ValidX(id)` + lookup helpers. Adding a voice is a one-line append; nothing else
changes. `GeminiVoiceName(id)` is the single mapping from our stable voice id to
the provider voice name — used by both the live relay and the TTS preview (no
duplicated maps).

### 4.2 The interviewer (`internal/live`)

- `director.go` — **the entire interviewer personality**: system-prompt assembly
  from persona + intensity + phase + per-domain pacing (`domainGuidance`) + the
  question's rubric/deep-dive material + a rolling canvas summary. One file.
- `relay.go` — the transport: proxies the Gemini Live WebSocket (so the key never
  reaches the browser), taps both transcripts, handles turn-taking/VAD, the
  `end_interview` tool, and persists candidate turns (critical for scoring).

### 4.3 Scoring (`internal/scoring`)

Corpus-driven: rubric dimensions come from the question, so one engine scores
system-design, coding, and professional interviews. Guards against fabricating
scores: `< 40` candidate words ⇒ *not scored*; per-dimension `assessed` flag ⇒
unassessed dims don't drag the weighted overall. Deterministic under the stub.

### 4.4 LLM providers (`internal/llm`)

One `Client` interface; concrete clients for Gemini + OpenAI-compatible
(OpenAI/DeepSeek/xAI/Meta) + Anthropic + a stub. Selected by `LLM_PROVIDER`.
Adding a provider = one file implementing `Client`.

### 4.5 Corpus (`api/data/corpus/*.json`)

Each question is a self-contained JSON file validated on load (`corpus.Validate`,
gated in CI). Carries its own `rubric[]`, so questions and scoring dimensions are
data, not code. Client only ever sees a trimmed summary (reference material stays
server-side).

### 4.6 Live client & resilience (`web/lib/live.ts`)

`LiveSession` abstracts three transports (real Gemini voice / browser
text-director / local mock) behind one event API (`caption`, `speaking`,
`amplitude`, `connection`, `ended`, …). Connection resilience:

- Unexpected socket close ⇒ **exponential-backoff auto-reconnect** (up to 5
  attempts: 0.5s → 8s), emitting `connection: "reconnecting"`.
- Exhausted ⇒ `connection: "failed"`; the studio shows a **Reconnect** button
  beside Send.
- Reconnect is idempotent: the old socket's callbacks are detached before a new
  attempt, and mic/speech-recognition are guarded so a re-fired `ready` can't
  stack duplicate audio pipelines.

---

## 5. Data model

`users · resumes · resume_reviews · interview_configs · sessions ·
transcript_turns · canvas_snapshots · workspace_snapshots · behavior_samples ·
events · scores · reports`. UUIDv7 keys. Every child is `ON DELETE CASCADE` from
`users`, so account deletion erases everything. Schema changes are additive,
tracked migration files under `internal/store/migrations/` applied automatically
on boot.

---

## 6. Security

- Email/password with bcrypt + short-lived JWT (`internal/auth`); optional
  Firebase-verifier seam behind the same middleware.
- The live WebSocket authenticates via `?token=` (browsers can't set WS headers);
  it's a bearer credential and validated by the same auth code.
- Secrets only in gitignored `.env` / `deploy/*.env`. The API key never reaches
  the browser — the server proxies Gemini Live.
- Tiering: free users get `FREE_DAILY_LIMIT` interviews/day (429 past it); admin
  allowlist bypasses. Enforced in `internal/interview`.

---

## 7. Testing strategy

| Layer | What | How |
|---|---|---|
| Corpus | every question valid, no leaked reference fields | `corpus_test.go` (CI gate) |
| Persona | voice/face/personality validation + fallback | `persona_test.go` |
| Scoring | not-enough guard, weight math, unassessed handling | `scoring_test.go` (stub LLM) |
| Auth | bcrypt verify, JWT round-trip, wrong-secret / expiry | `auth_test.go` |
| Store | in-memory contract + cascade semantics | `memstore_test.go` (+ `Datastore` assertion) |
| **API integration** | register→config→session→finish→report, auth-required, daily-limit + admin bypass | `cmd/mockinterview/api_test.go` (memstore + stub, **no DB/keys**) |
| Frontend | fuzzy search, mock feature slices round-trips | Vitest (`lib/**/*.test.ts`) |

CI (`.github/workflows/ci.yml`) runs gofmt/vet/build/test for the API and
lint/test/build (mock mode) for the web on every PR.

---

## 8. Deployment

Cloud Build → Cloud Run (`us-west1`, scale-to-zero) + shared Cloud SQL; web
static export → Firebase Hosting. Shell scripts in `deploy/`. Model IDs are
single config values (Gemini Live is preview and IDs move); see
`docs/OPERATIONS.md`.

---

## 9. Known tradeoffs & future work

- **Modular monolith, not microservices** — deliberate: one binary is cheaper and
  simpler; the package/interface boundaries mean a service could be extracted
  later without rewrites.
- **Reconnect starts a fresh director session** — transcripts persist server-side
  so scoring is unaffected, but in-flight audio context is lost on reconnect.
- **Behavioral scoring is heuristic** (client-side MediaPipe + events), reported
  separately from the rubric, never as pass/fail.
- Future: per-user provider/model override; richer resume diff UI; more corpus
  domains; optional photoreal avatar driver (seam already exists).
