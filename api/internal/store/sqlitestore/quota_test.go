package sqlitestore

import (
	"context"
	"errors"
	"github.com/tejo/mockinterview-api/internal/store"
	"path/filepath"
	"testing"
	"time"
)

func TestSQLiteLifetimeClaimSurvivesRetentionAccountDeletionAndRestart(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "data", "interviews.sqlite")
	s := openTest(t, path)
	u := testUser(t, s)
	r := store.Reservation{Identity: "stable-identity", GlobalDailyLimit: 200, Session: store.Session{UserID: u.ID, Funding: "platform", DurationMinutes: 5}}
	a, err := s.ReserveSession(ctx, r)
	must(t, err)
	_, err = s.AcquireLive(ctx, a.ID, "owner")
	must(t, err)
	_, err = s.ActivateLive(ctx, a.ID, "owner")
	must(t, err)
	must(t, s.ReleaseLive(ctx, a.ID, "owner"))
	must(t, s.DeleteUser(ctx, u.ID))
	_, err = s.db.ExecContext(ctx, `DELETE FROM interview_usage`)
	must(t, err)
	must(t, s.Close())
	s = openTest(t, path)
	u = testUser(t, s)
	r.Session.UserID = u.ID
	_, err = s.ReserveSession(ctx, r)
	if !errors.Is(err, store.ErrQuota) {
		t.Fatalf("reopened lifetime claim reset: %v", err)
	}
	usage, err := s.Usage(ctx, u.ID, r.Identity, false, 200)
	must(t, err)
	if !usage.FreeInterviewUsed || usage.NextFundedAt != nil || usage.GlobalDailyRemaining == nil || *usage.GlobalDailyRemaining != 200 {
		t.Fatalf("incorrect lifetime usage: %+v", usage)
	}
	r.Session.Funding = "byok"
	_, err = s.ReserveSession(ctx, r)
	must(t, err)
}

func TestSQLiteMigrationBackfillsOldSessionAndLedger(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "data", "interviews.sqlite")
	s := openTest(t, path)
	u := testUser(t, s)
	a, err := s.ReserveSession(ctx, store.Reservation{Identity: "old-session", Session: store.Session{UserID: u.ID, Funding: "platform", DurationMinutes: 5}})
	must(t, err)
	must(t, s.changeSession(ctx, a.ID, func(d *sessionDocument) error {
		past := time.Now().Add(-30 * 24 * time.Hour)
		d.Session.StartedAt = &past
		d.Session.Status = "complete"
		return nil
	}))
	_, err = s.db.ExecContext(ctx, `INSERT INTO interview_usage(session_id,identity,funding,activated_at) VALUES(?,'retained-ledger','platform',?)`, store.NewID(), time.Now().UnixMilli())
	must(t, err)
	_, err = s.db.ExecContext(ctx, `DROP TABLE free_interview_claims`)
	must(t, err)
	_, err = s.db.ExecContext(ctx, `DELETE FROM schema_migrations WHERE version=2`)
	must(t, err)
	must(t, s.Close())
	s = openTest(t, path)
	for _, identity := range []string{"old-session", "retained-ledger"} {
		usage, err := s.Usage(ctx, u.ID, identity, false)
		must(t, err)
		if usage.FundedAvailable || !usage.FreeInterviewUsed {
			t.Fatalf("migration missed %s: %+v", identity, usage)
		}
	}
}
