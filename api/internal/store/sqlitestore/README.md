# Desktop persistence

`sqlitestore.Open(ctx, path)` is the desktop implementation of `store.Datastore`.
The packaged API owns it; the browser renderer never reads the database file.
SQLite is embedded through the pinned [modernc.org/sqlite](https://pkg.go.dev/modernc.org/sqlite@v1.60.1)
pure-Go driver, so macOS, Windows and Linux packages need no PostgreSQL, C toolchain,
network database or database installer. Hosted deployments continue using PostgreSQL.

## Data model

Foreign-key relations and indexes live in `migrations/0001_local.sql`. Small,
versioned application records use checked JSON documents inside relational rows;
append-only data has separate rows, so recording a turn does not rewrite the
interview's history. This is a database implementation, not an in-memory store
periodically serialized to disk.

| Owner | Persisted records |
| --- | --- |
| User | Profile/settings, policy acknowledgments, interviewer configuration, single-use hashed auth actions, latest résumé and its reviews |
| Session | Frozen custom question/configuration, status/deadline/lease, operational error count, ordered turns, versioned code/writing/drawing workspace, canvas snapshots, behavior samples and events |
| Session result | Scoring job with immutable input and fencing attempt, scores and report, expiring encrypted provider credential |
| Community/consent | Interview feedback and transcript-sharing choice, product feedback, template requests, beta application, tester access, copies of explicitly shared results and their consent version |

The public `Session` and `Resume` JSON shapes omit private fields. Dedicated
storage documents explicitly retain the session owner, frozen question,
quota identity and original résumé text. Never replace these documents with
ordinary API JSON serialization.

## Transactions and recovery

- Every write is committed before its API call succeeds. WAL mode and
  `synchronous=FULL` provide SQLite's documented crash durability. Foreign keys
  are enabled on each connection; `secure_delete=ON` removes deleted content
  from reusable database pages (this does not erase OS backups or guarantee
  that old WAL pages are immediately overwritten).
- A one-connection pool avoids local writer contention; `BEGIN IMMEDIATE` and
  a bounded busy timeout protect read-modify-write operations even if a second
  process opens the same file. All operations honor request cancellation.
- Admission, activation and quota ledger updates are atomic. Workspace revisions
  use compare-and-swap semantics; event IDs prevent duplicate transcript turns.
- Scoring claim attempts fence stale workers. Frozen inputs and leases survive
  restart. Report, scores, terminal status, job completion and credential deletion
  commit together; a disk/validation failure rolls them all back.
- Migrations run in one transaction. A newer schema or integrity error fails
  startup without resetting data. The application never silently starts a fresh
  database in response to an unreadable or damaged one.
- The maintenance worker removes expired credentials/actions and raw behavior
  telemetry after the existing 30-day retention period. It never ages out
  interview transcripts, saved workspaces or final reports. Deleting a user
  cascades through all owned records. The short-lived pseudonymous usage ledger
  follows the hosted contract and expires separately after seven days.

## Files, credentials and backup

Use the OS-specific application-data directory, independently of installer files.
The dedicated directory is mode `0700`; SQLite, WAL and SHM files are mode `0600`
on Unix. On Windows the user's application-data ACL is the access boundary.
Symlink database files and a symlink immediate parent directory are rejected.
Windows drive paths are encoded as `file:///C:/…`, as specified by
[SQLite URI filenames](https://www.sqlite.org/uri.html).

The store accepts already-encrypted, expiring provider credential bytes. It never
receives a plaintext provider key through the credential API. Installation
secrets and OS keychain handling belong to the Electron shell. Interview content
is not database-encrypted; device encryption and the OS account protect it.

The account export takes one consistent transaction and excludes hashes, auth
and lease secrets, encrypted provider credentials and quota identities. For a
complete restore backup, quit the app fully and copy its application-data
folder, including installation keys. Never copy only a live `.sqlite` file while
ignoring its WAL, and never delete installation keys separately from their data.

## Verification

`go test -race ./internal/store/sqlitestore` exercises durable restart of a custom
interview and all result artifacts, a child process exiting without SQLite
cleanup, independent connections racing reservations and workspace revisions,
injected scoring-write rollback, stale worker fencing, feedback/consent/auth
round trips, account cascades, restrictive permissions and future-schema refusal.
Native packaging CI must run the runtime smoke on all supported operating systems;
cross-compilation alone is not proof of installer or filesystem behavior.
