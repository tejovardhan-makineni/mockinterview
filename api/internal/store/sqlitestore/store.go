// Package sqlitestore provides the packaged desktop application's durable local
// datastore. It does not connect to a hosted service or send analytics.
package sqlitestore

import (
	"context"
	"database/sql"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/tejo/mockinterview-api/internal/store"
	_ "modernc.org/sqlite"
)

//go:embed migrations/*.sql
var migrations embed.FS

// Store owns a SQLite connection pool. A single connection serializes reads and
// writes in this process; BEGIN IMMEDIATE also protects multi-statement writes
// against a second process. No cached state can get ahead of a failed commit.
type Store struct{ db *sql.DB }

var _ store.Datastore = (*Store)(nil)

// Open creates or upgrades an on-disk database. Callers must use a dedicated
// application-data directory, not the installation directory. Existing files
// are preserved on migration errors; newer schemas are rejected, never reset.
func Open(ctx context.Context, path string) (*Store, error) {
	if path == "" || path == ":memory:" {
		return nil, errors.New("a durable SQLite path is required")
	}
	absolute, err := filepath.Abs(path)
	if err != nil {
		return nil, err
	}
	dir := filepath.Dir(absolute)
	if err = os.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}
	if info, e := os.Lstat(dir); e != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return nil, errors.New("SQLite directory must be a real directory")
	}
	// Only restrict the dedicated database directory, never an ancestor.
	if err = os.Chmod(dir, 0700); err != nil {
		return nil, err
	}
	for _, suffix := range []string{"", "-wal", "-shm"} {
		name := absolute + suffix
		info, e := os.Lstat(name)
		if e == nil {
			if !info.Mode().IsRegular() {
				return nil, errors.New("SQLite files must be regular files")
			}
			if err = os.Chmod(name, 0600); err != nil {
				return nil, err
			}
		} else if !errors.Is(e, os.ErrNotExist) {
			return nil, e
		}
	}
	f, err := os.OpenFile(absolute, os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return nil, err
	}
	if err = f.Close(); err != nil {
		return nil, err
	}
	sqlitePath := filepath.ToSlash(absolute)
	if filepath.VolumeName(absolute) != "" {
		sqlitePath = "/" + sqlitePath
	}
	uri := &url.URL{Scheme: "file", Path: sqlitePath}
	params := url.Values{}
	for _, pragma := range []string{"foreign_keys(1)", "busy_timeout(5000)", "journal_mode(WAL)", "synchronous(FULL)", "secure_delete(ON)"} {
		params.Add("_pragma", pragma)
	}
	params.Set("_txlock", "immediate")
	uri.RawQuery = params.Encode()
	db, err := sql.Open("sqlite", uri.String())
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	s := &Store{db: db}
	fail := func(e error) (*Store, error) { _ = db.Close(); return nil, e }
	if err = db.PingContext(ctx); err != nil {
		return fail(err)
	}
	if err = s.migrate(ctx); err != nil {
		return fail(err)
	}
	// SQLite inherits the main file's permissions for WAL/SHM. Tighten existing
	// sidecars as well; Windows additionally uses the user's app-data ACL.
	for _, suffix := range []string{"-wal", "-shm"} {
		if err = os.Chmod(absolute+suffix, 0600); err != nil && !errors.Is(err, os.ErrNotExist) {
			return fail(err)
		}
	}
	var result string
	if err = db.QueryRowContext(ctx, "PRAGMA quick_check").Scan(&result); err != nil {
		return fail(err)
	}
	if result != "ok" {
		return fail(errors.New("SQLite integrity check failed; preserve the database for recovery"))
	}
	return s, nil
}
func (s *Store) Close() error                   { return s.db.Close() }
func (s *Store) Ping(ctx context.Context) error { return s.db.PingContext(ctx) }

func (s *Store) migrate(ctx context.Context) error {
	entries, err := migrations.ReadDir("migrations")
	if err != nil {
		return err
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].Name() < entries[j].Name() })
	return s.write(ctx, func(tx *sql.Tx) error {
		if _, e := tx.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)`); e != nil {
			return e
		}
		var current int
		if e := tx.QueryRowContext(ctx, `SELECT coalesce(max(version),0) FROM schema_migrations`).Scan(&current); e != nil {
			return e
		}
		if current > len(entries) {
			return errors.New("this database requires a newer desktop application")
		}
		for i, entry := range entries {
			version, e := strconv.Atoi(strings.SplitN(entry.Name(), "_", 2)[0])
			if e != nil || version != i+1 {
				return errors.New("invalid SQLite migration sequence")
			}
			if version <= current {
				continue
			}
			body, e := migrations.ReadFile("migrations/" + entry.Name())
			if e != nil {
				return e
			}
			if _, e = tx.ExecContext(ctx, string(body)); e != nil {
				return fmt.Errorf("SQLite migration %d: %w", version, e)
			}
			if _, e = tx.ExecContext(ctx, `INSERT INTO schema_migrations(version,applied_at) VALUES(?,?)`, version, nowMillis()); e != nil {
				return e
			}
		}
		return nil
	})
}
func (s *Store) write(ctx context.Context, fn func(*sql.Tx) error) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err = fn(tx); err != nil {
		return err
	}
	return tx.Commit()
}

type querier interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}
type executor interface {
	ExecContext(context.Context, string, ...any) (sql.Result, error)
}

func nowMillis() int64 { return time.Now().UTC().UnixMilli() }
func normalizeJSON(raw json.RawMessage) json.RawMessage {
	if len(raw) == 0 {
		return json.RawMessage(`{}`)
	}
	return raw
}
func readJSON[T any](ctx context.Context, q querier, statement string, args ...any) (T, error) {
	var out T
	var data []byte
	err := q.QueryRowContext(ctx, statement, args...).Scan(&data)
	if errors.Is(err, sql.ErrNoRows) {
		return out, store.ErrNotFound
	}
	if err != nil {
		return out, err
	}
	err = json.Unmarshal(data, &out)
	return out, err
}
func listJSON[T any](ctx context.Context, q querier, statement string, args ...any) ([]T, error) {
	rows, err := q.QueryContext(ctx, statement, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []T{}
	for rows.Next() {
		var data []byte
		var item T
		if err = rows.Scan(&data); err != nil {
			return nil, err
		}
		if err = json.Unmarshal(data, &item); err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, rows.Err()
}
func execJSON(ctx context.Context, q executor, statement string, value any, args ...any) error {
	raw, err := json.Marshal(value)
	if err != nil {
		return err
	}
	args = append(args, string(raw))
	_, err = q.ExecContext(ctx, statement, args...)
	return err
}
func affected(result sql.Result, err error, missing error) error {
	if err != nil {
		return err
	}
	n, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return missing
	}
	return nil
}
