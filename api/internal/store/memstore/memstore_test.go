package memstore

import (
	"context"
	"testing"

	"github.com/tejo/mockinterview-api/internal/store"
)

// The in-memory store must satisfy the full production contract, so tests that
// wire it into the app exercise the same interface the real store implements.
var _ store.Datastore = (*Mem)(nil)

func TestUserRoundTripAndCascade(t *testing.T) {
	ctx := context.Background()
	m := New()

	u, _ := m.CreateUser(ctx, "a@b.com", "hash")
	if got, _ := m.UserByEmail(ctx, "a@b.com"); got.ID != u.ID {
		t.Fatal("UserByEmail did not return the created user")
	}

	// A session + report tied to the user.
	sess, _ := m.CreateSession(ctx, u.ID, "q1", "system_design", "engineering", nil)
	_ = m.SaveReport(ctx, sess.ID, 3.0, nil, nil, nil, "", true, "")

	list, _ := m.ListUserSessions(ctx, u.ID, 50)
	if len(list) != 1 || list[0].Overall == nil || *list[0].Overall != 3.0 {
		t.Fatalf("expected 1 session with overall 3.0, got %+v", list)
	}

	// Deleting the account cascades to sessions + reports.
	_ = m.DeleteUser(ctx, u.ID)
	if _, err := m.UserByEmail(ctx, "a@b.com"); err != store.ErrNotFound {
		t.Error("user should be gone after delete")
	}
	if _, _, err := m.GetReport(ctx, sess.ID); err != store.ErrNotFound {
		t.Error("report should be cascaded on account delete")
	}
}

func TestConfigDefaults(t *testing.T) {
	ctx := context.Background()
	m := New()
	c, _ := m.GetConfig(ctx, "nobody")
	if c != store.DefaultConfig() {
		t.Errorf("unknown user should get default config, got %+v", c)
	}
}
