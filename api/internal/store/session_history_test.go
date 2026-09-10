package store

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestPostgresHistoryTimestampsPreserveAbsoluteInstant(t *testing.T) {
	s := postgresRuntime(t)
	ctx := context.Background()
	u, err := s.CreateUser(ctx, "history-time@example.test", "unused")
	if err != nil {
		t.Fatal(err)
	}
	a, err := s.CreateSession(ctx, u.ID, "history-question", "conversational", "engineering", "history-pack", "round-1", nil)
	if err != nil {
		t.Fatal(err)
	}
	// Exercise the read queries with a non-UTC database session as well: adding
	// a literal Z without normalizing would mislabel this wall-clock value.
	readConfig := s.Pool.Config()
	readConfig.ConnConfig.RuntimeParams["timezone"] = "America/Los_Angeles"
	readPool, err := pgxpool.NewWithConfig(ctx, readConfig)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(readPool.Close)
	reader := &Store{Pool: readPool}
	// A non-UTC input offset represents the same instant a browser must show in
	// the viewer's timezone. PostgreSQL stores it at microsecond precision.
	expected := time.Date(2026, 9, 10, 9, 0, 1, 123456000, time.FixedZone("PDT", -7*60*60))
	if _, err = s.Pool.Exec(ctx, `UPDATE sessions SET created_at=$2 WHERE id=$1`, a.ID, expected); err != nil {
		t.Fatal(err)
	}
	for _, list := range []struct {
		name string
		read func() ([]SessionSummary, error)
	}{
		{"history", func() ([]SessionSummary, error) { return reader.ListUserSessions(ctx, u.ID, 50) }},
		{"pack history", func() ([]SessionSummary, error) { return reader.SessionsForPack(ctx, u.ID, "history-pack") }},
	} {
		t.Run(list.name, func(t *testing.T) {
			rows, err := list.read()
			if err != nil || len(rows) != 1 {
				t.Fatalf("history rows=%d err=%v", len(rows), err)
			}
			got, err := time.Parse(time.RFC3339Nano, rows[0].CreatedAt)
			if err != nil {
				t.Fatalf("timestamp must carry an RFC3339 timezone: %q", rows[0].CreatedAt)
			}
			if !got.Equal(expected) {
				t.Fatalf("timestamp changed absolute instant: got%s want%s", got, expected)
			}
			_, offset := got.Zone()
			if offset != 0 {
				t.Fatal("history API should normalize timestamps to UTC")
			}
		})
	}
}
