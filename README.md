# mockinterview.live

A realistic **AI mock-interview platform**. An interviewer with a human face and
voice asks questions, watches you work (a system-design canvas, a code editor, or
a written pad), interrupts with probing follow-ups, and scores you across every
dimension of a real interview — plus how you came across (eye contact, posture,
lighting, filler words, pauses). Everything is stored; you get a detailed report.

Supports multiple **modalities** (system design · coding · written · conversational)
and **domains** (software engineering, ML system design, medical residency/clinical,
law, consulting cases, product management, finance, behavioral).

## Stack

- **Web** — Next.js (App Router) + TypeScript + Tailwind v4, static export.
- **API** — Go (chi + pgx), single binary, embedded auto-migrations.
- **DB** — Postgres.
- **LLM** — swappable: **Gemini** (default, and the live native-audio voice),
  OpenAI, DeepSeek, Anthropic. A deterministic **stub** runs the whole product
  with **no API key** for offline/dev.
- **Avatar** — client-side 3D (no per-minute cost), swappable driver.
- **Behavioral** — MediaPipe in-browser (gaze/pose/lighting) + VAD (pauses/fillers).

## Run locally

You need Go 1.26+, Node 20+, and Postgres (Docker or local).

```bash
cp .env.example .env          # optional: add GEMINI_API_KEY for real interviews
make up                       # start Postgres (docker compose)
make dev                      # runs API (:8080) + web (:3000)
```

Open http://localhost:3000. With **no API key**, the app runs on the deterministic
stub — you can click through auth, resume parse/review, question selection, a
scored interview, and the report with zero cost. Add `GEMINI_API_KEY` (or another
provider's key + `LLM_PROVIDER`) to `.env` for real LLM evaluation and live voice.

**Fully offline UI:** the web app also has a mock mode needing no backend at all:
`cd web && NEXT_PUBLIC_MOCK=1 npm run dev`.

## Configuration

See `.env.example`. The only value needed for a real interview is `GEMINI_API_KEY`.
To use a different reasoning provider set `LLM_PROVIDER=openai|deepseek|anthropic`
and that provider's key; live voice always uses Gemini.

## Layout

```
api/    Go API (cmd/mockinterview, internal/*, embedded migrations, data/corpus)
web/    Next.js app (app/, components/, lib/ with the mock/HTTP client seam)
deploy/ GCP deploy scripts (Cloud Run + Cloud SQL + Firebase Hosting)
docs/   architecture + operations
```

## Tests

```bash
cd api && go build ./... && go vet ./... && go test ./...   # handlers run on an
                                            # in-memory store + LLM stub — no DB/keys
cd web && npm run lint && npm test && npm run build
```

The whole HTTP API is covered by `cmd/mockinterview/api_test.go` against the
in-memory store; the corpus is validated in CI via `go test ./internal/corpus/`
and the `./bin/mockinterview -validate-corpus <dir>` CLI. CI runs both suites on
every PR (`.github/workflows/ci.yml`).

## Contributing

This project is built to be modular — most improvements touch **one module per
layer**. See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the "I want to change X"
map, plus [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and
[`docs/TDD.md`](docs/TDD.md). Please also read the
[Code of Conduct](CODE_OF_CONDUCT.md) and [Security Policy](SECURITY.md).

## License

Licensed under the **GNU Affero General Public License v3.0** — see
[`LICENSE`](LICENSE). In short: you may use, modify, and self-host it, but if you
run a modified version as a network service you must offer users its source.
