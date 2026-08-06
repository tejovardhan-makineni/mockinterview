# Operations runbook — mockinterview.live

## Local

```bash
cp .env.example .env          # add GEMINI_API_KEY (and others) — see .env
make up                       # Postgres via docker (or use local Postgres)
make dev                      # API :8080 + web :3000
make check-llm                # verify every provider key in .env with a real call
```
No key at all → the app runs on the deterministic stub (auth, resume, a scored
interview, report — all work offline). `NEXT_PUBLIC_MOCK=1` renders the web UI
with no backend.

## LLM providers (swappable)

`LLM_PROVIDER` = `gemini` (default) | `openai` | `deepseek` | `xai` | `meta` | `anthropic`.
The **live voice always uses Gemini** (native-audio Live API), regardless of
`LLM_PROVIDER`. `LLM_MODEL` overrides the model; else provider default. Verify
with `make check-llm`. Gemini "thinking" is disabled for structured calls so
2.5-flash returns complete JSON.

Status (last `make check-llm`): gemini ✓, openai ✓, deepseek ✓, xai ✓,
anthropic ✓, meta ✓ (muse-spark-1.2, api.meta.ai).

## GCP deploy (reuses the StoryBytes project + shared Cloud SQL)

Project `storybytes-495010`, region `us-west1`, shared Cloud SQL Postgres.

### One-time prerequisites (you run these)
1. `gcloud auth login` and `gcloud config set project storybytes-495010`.
2. Find the shared instance connection name:
   `gcloud sql instances list --project=storybytes-495010`
3. `cp deploy/mockinterview.env.template deploy/mockinterview.env` and fill in
   `CLOUDSQL_INSTANCE`, a strong `DB_PASSWORD`, `JWT_SECRET`, `GEMINI_API_KEY`.
4. Create this app's DB + user on the shared instance:
   `bash deploy/setup-db.sh` (then run the printed GRANT once as the admin user).

### Deploy
```bash
bash deploy/deploy-api.sh      # Cloud Build image → Cloud Run, wired to Cloud SQL
# copy the printed API URL into deploy/mockinterview.env as WEB_API_BASE
firebase login                 # one-time, interactive (web deploy only)
bash deploy/deploy-web.sh      # Next static export → isolated Firebase site
```
Migrations auto-apply on API start. **Smoke: `curl <API_URL>/api/v1/ping`**
(Google Frontend swallows the literal path `/healthz` on run.app before it
reaches the container — use `/api/v1/ping` for health checks; everything else
routes to the app normally.)

### Current deploy (live)
- API: `https://mockinterview-api-661893776515.us-west1.run.app` (Cloud Run,
  us-west1, shared Cloud SQL `storybytes-beta-db`, DB `mockinterview`). Verified:
  register/login, 52 questions, real-Gemini scoring end-to-end.
- Web: static export built against the API in `web/out`; deploy to the isolated
  Firebase site `mockinterview-live` (needs `firebase login` first — it can't be
  automated headlessly). A dedicated site avoids overwriting summon/storybytes.

### Notes
- The API talks to Cloud SQL over the unix socket `/cloudsql/<INSTANCE>` (the
  `--add-cloudsql-instances` flag mounts it); `DATABASE_URL` uses `host=/cloudsql/...`.
- `DB_MAX_CONNS=5` and `--max-instances 5` keep connection use bounded on the
  shared instance (cost + connection-limit friendly).
- Live WebSocket voice works through Cloud Run (HTTP/1.1 WS upgrade is supported;
  `--timeout 3600` allows long interviews).
- To move keys into Secret Manager instead of env, push them and swap the
  `--set-env-vars` secret entries for `--set-secrets` (see push-secrets.sh).
- Custom domain: map `mockinterview.live` → Firebase Hosting, and
  `api.mockinterview.live` → the Cloud Run service; update `CORS_ALLOW` +
  `WEB_API_BASE` accordingly.

## Where things live
- API: `api/` (Go, chi+pgx, embedded migrations in `internal/store/migrations`,
  corpus in `api/data/corpus`).
- Web: `web/` (Next static export; API client seam in `web/lib/api.ts`).
- Corpus: `api/data/corpus/*.json` — add a file, run
  `./api/bin/mockinterview -validate-corpus api/data/corpus`, redeploy.
- Model IDs (incl. the moving Gemini Live preview id): env vars, see `.env.example`.
