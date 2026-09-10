package memstore

import (
	"context"
	"github.com/tejo/mockinterview-api/internal/store"
	"testing"
	"time"
)

func TestHistoryTimestampsPreserveAbsoluteInstant(t *testing.T) {
	m := New()
	ctx := context.Background()
	u, _ := m.CreateUser(ctx, "history@example.test", "unused")
	a, _ := m.CreateSession(ctx, u.ID, "q", "conversational", "engineering", "pack", "round", nil)
	expected := time.Date(2026, 9, 10, 9, 0, 1, 123456789, time.FixedZone("PDT", -7*60*60))
	m.mu.Lock()
	m.sessions[a.ID].created = expected
	m.mu.Unlock()
	for _, read := range []func() ([]store.SessionSummary, error){func() ([]store.SessionSummary, error) { return m.ListUserSessions(ctx, u.ID, 50) }, func() ([]store.SessionSummary, error) { return m.SessionsForPack(ctx, u.ID, "pack") }} {
		rows, err := read()
		if err != nil || len(rows) != 1 {
			t.Fatalf("rows=%d err=%v", len(rows), err)
		}
		got, err := time.Parse(time.RFC3339Nano, rows[0].CreatedAt)
		if err != nil || !got.Equal(expected) {
			t.Fatalf("timestamp lost timezone or precision: %q err=%v", rows[0].CreatedAt, err)
		}
		_, offset := got.Zone()
		if offset != 0 {
			t.Fatal("history should normalize to UTC")
		}
	}
}
