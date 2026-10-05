# Run mockinterview on your computer

## Desktop app

The Electron desktop app bundles the interface, Go interview service, interview
catalog and SQLite database. Package availability is listed on the
[Downloads page](https://mockinterview.live/downloads/); installers are hosted as
[GitHub Release assets](https://github.com/tejovardhan-makineni/mockinterview/releases).
Only links to verified published assets are displayed. Source support for a
platform does not mean its signed installer has been published.

1. Download the package matching your operating system and processor, install it,
   and open mockinterview.
2. Add your own AI key in Settings or interview setup and validate the connection.
3. Choose a template or custom interview. The interview room and saved reports
   work the same way as the hosted app.

**All desktop AI practice requires your own provider key. No free interviews are
included.** The website provides standard verified accounts one platform-funded
interview every rolling 24 hours; approved beta testers and personal keys retain
their separate access rules. Cloud models require internet, and provider charges
and rate limits apply. Gemini supports native voice; other configured providers
support text interviews. A connection check can make a small billable request.

The desktop app creates a local profile automatically. Interviews, transcripts,
workspaces, reports, resumes, preferences and feedback survive ordinary app
restarts in the bundled database. Export records in Settings and delete individual
interviews in History. Uninstalling an app is not a guaranteed deletion of its
operating-system data directory. Back up important exports separately.

Provider keys remain in memory for the current app session and are not stored in
browser preferences. The API can store an encrypted short-lived session copy to
support reconnection and scoring; expired credentials require re-entry. Add your
key again after restarting or reloading. The local database is not fully encrypted; protect
your operating-system account and backups.

### Desktop sharing

**Share analytics** starts on for new installations and can be turned off and sends new interview usage/error metrics only
when a hosted account is connected. **Include interview results** is a separate
choice for new scores and written feedback, which may contain personal details.
Consent choices survive restarts; the hosted login is memory-only and must be
reconnected each app session. The saved local history supplies retry candidates
when the project API is reachable. Upload failures are quiet and never block
practice; this is not a backup or cross-device synchronization service.

Feedback and template requests are saved locally. A separate unchecked **Send to
the project admin** choice sends the submitted message only when sharing is
connected; the app confirms whether that copy was delivered. GitHub, Discord and
Reddit are available from the app navigation/footer and Help menu.

## Developer launcher

The source also runs as a local web app on macOS, Windows and Linux. This path needs **Git,
Node.js 22 with npm 10, and Go 1.26.8 or newer**; Docker is optional. Python 3 is
only needed for content-authoring and some repository checks.

Download prerequisites from [Git](https://git-scm.com/downloads),
[Node.js](https://nodejs.org/en/download) and [Go](https://go.dev/dl/).
Use the Node 22 installer/archive, because newer Node releases may be offered by
default. Restart your terminal after installation so the tools are on PATH.
Windows users can run the commands in PowerShell without WSL or Make. macOS and
Linux users can use their usual terminal. The Go toolchain can download its
required version when `go.mod` asks for a newer one; the first build needs network
access. Downloaded dependency caches are reused on later builds.

## First run: no Docker, database or provider key

```sh
git clone https://github.com/tejovardhan-makineni/mockinterview.git
cd mockinterview
node scripts/local.mjs
```

The launcher checks prerequisites, installs the web dependencies, builds the API
in your operating system's temporary directory, and starts both services bound
to loopback. It does not overwrite `.env`. Open `http://localhost:3000`, create a
local account and choose **Text conversation**. Ctrl+C stops both services and
removes the temporary API binary.

**This default mode stores accounts, interviews and feedback in memory. They are
lost when the API stops.** Without a provider key the model is a clearly labeled
deterministic demo: responses and scores are examples, not an assessment of your
answers. Initial installation/build needs internet access. No paid model service
is needed for the demo.

Useful options:

```sh
node scripts/local.mjs --help
node scripts/local.mjs --check
node scripts/local.mjs --skip-install
```

`--check` checks tools and free ports without installing or starting services.
`--skip-install` reuses dependencies; omit it after pulling dependency changes.
The API and web default to ports 8080 and 3000. If those are occupied, set
`MOCKINTERVIEW_API_PORT` and `MOCKINTERVIEW_WEB_PORT` to two different free ports
before running the launcher. The script updates the API origin and allowed
browser origins to match.

## Keep history with PostgreSQL

Use this mode for ongoing practice. Install PostgreSQL 16 for your OS from
[the official download page](https://www.postgresql.org/download/). macOS can use
a native installer or package manager; Windows has an installer with pgAdmin;
Linux uses its distribution's PostgreSQL packages. Run PostgreSQL locally.

In `psql` or pgAdmin, connect as the local database administrator and create an
application login and database. Choose a unique password; the example text below
is a placeholder, not a supplied credential.

```sql
CREATE ROLE mockinterview LOGIN PASSWORD 'REPLACE_WITH_YOUR_LOCAL_PASSWORD';
CREATE DATABASE mockinterview OWNER mockinterview;
```

Create the environment file (one time only):

```sh
# macOS / Linux / Git Bash
cp .env.example .env
```

```powershell
# Windows PowerShell
Copy-Item .env.example .env
```

Set the following in `.env`, using your chosen password (URL-encode special
characters in a connection URL). Keep this file private.

```dotenv
DATABASE_URL=postgres://mockinterview:REPLACE_WITH_YOUR_LOCAL_PASSWORD@localhost:5432/mockinterview?sslmode=disable
APP_ENV=development
LOCAL_UNLIMITED=true
LOCAL_MEMORY=false
```

Start the app:

```sh
node scripts/local.mjs --persistent
```

The API runs its embedded database migrations before serving requests. Accounts,
interviews, reports and feedback survive API restarts. Back up PostgreSQL if you
need to retain them across reinstallations. The memory demo and PostgreSQL are
separate stores; demo accounts do not automatically migrate. Register a new
local account for the persistent installation.

For local verification/recovery, development auth responses provide the action
link, so you do not need a mail account. This is development configuration for
your computer, not a public hosted deployment.

## Real models and live voice

Set `GEMINI_API_KEY` in `.env` for Gemini, or choose another `LLM_PROVIDER` and
set its corresponding key. The current default text/feedback model is
`gemini-2.5-flash`. Provider model access changes; verify that your own project has
access before relying on that model. Run `make check-llm` (or `cd api` then
`go run ./cmd/mockinterview -check-llm`) for an **optional billable** connectivity
check. It checks every provider key present, so remove unrelated keys first.

You can also select a supported provider/model and validate a personal key in
interview setup. Personal keys are kept out of browser storage. The API encrypts
short-lived session credentials; provider charges and rate limits still apply.
Native live voice uses Gemini's audio model. Other personal providers use text
interviews and their own feedback model.

A stable `SESSION_ENCRYPTION_KEY` lets an interrupted personal-key session survive
API restarts until its credentials expire. Generate a local key without Python:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Save it in `.env`. Do not commit it. Changing the key makes earlier encrypted
session keys unreadable; re-enter the provider key in the app when asked.

## Optional analytics sharing

Your ordinary account/history belongs to the API installation you are using.
A self-hosted installation does not automatically upload that history to the
project maintainer. For optional central analytics, set
`NEXT_PUBLIC_ANALYTICS_API_BASE` in **web/.env.local** to the intended HTTPS
analytics API origin before starting/building the web app.

The user must separately sign in to that API and enable **Share analytics**.
Shared practice results and feedback are visible to its administrator. Remote
sharing credentials remain in memory and require sign-in after restarting or
reloading. Web consent remains a per-account browser preference until disabled.
Optional uploads fail quietly if the server is unavailable and do not block
local practice. They are best-effort, not a guaranteed backup or cross-device
history sync. No server address or central credential is bundled by the launcher.
Read the app's Privacy page for data categories and controls.

The packaged desktop app has its own default-on analytics and default-off result-sharing
preferences, saved on the computer. Its optional project connection uses the
bundled local API bridge; see [desktop setup and storage](#desktop-app).

## Optional Docker web stack

Install Docker with Compose v2. Copy `.env.example` to `.env` as above, then run:

```sh
docker compose --profile app up --build
```

Open `http://localhost:3000`. Docker runs the API, static web app and PostgreSQL;
only loopback ports 3000, 8080 and 5432 are published. Inside the API container,
`LISTEN_HOST=0.0.0.0` allows the published port to reach the process. This does not
expose the host port beyond loopback. The named PostgreSQL volume preserves data.

```sh
# Stop services; preserve your database.
docker compose --profile app down
```

Do not use `down -v` unless you intend to delete the database volume. This stack
has no public TLS, production secrets or production mail settings. For hosting,
follow [the release runbook](RELEASE-RUNBOOK.md).

## Troubleshooting

| Symptom | Next step |
|---|---|
| `node`, `npm` or `go` is missing | Install prerequisites and reopen the terminal. |
| Wrong Node/npm version | Select Node 22 and npm 10, as pinned by `web/package.json`. |
| Port is in use | Stop an old local service or select different launcher ports. |
| Database connection refused | Start PostgreSQL, verify DATABASE_URL and use --persistent only when ready. |
| History disappeared in demo mode | In-memory history is temporary; use PostgreSQL for future sessions. |
| Voice unavailable | Use text for the demo, or configure Gemini and grant microphone access. |
| Provider key rejected | Validate the selected model with an account that can access it; check provider billing. |

For contributors using Make, `make local` and `make local-persistent` invoke the
same launcher. Existing `make install`, `make up`, `make dev`, and `make local-stack`
remain available for the traditional development workflow.
