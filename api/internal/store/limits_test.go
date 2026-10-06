package store

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"testing"
	"time"
)

func TestPostgresConcurrentGlobalBudgetAndLifetimeClaims(t *testing.T) {
	s := postgresRuntime(t)
	ctx := context.Background()
	today := UTCDayStart(time.Now())
	// Seed 199 tester-funded starts exactly at UTC midnight and one yesterday.
	for i := 0; i < 200; i++ {
		at := today
		if i == 199 {
			at = today.Add(-time.Microsecond)
		}
		if _, err := s.Pool.Exec(ctx, `INSERT INTO interview_usage(session_id,identity,funding,activated_at,tester_exempt) VALUES($1,$2,'platform',$3,true)`, NewID(), fmt.Sprintf("previous-%d", i), at); err != nil {
			t.Fatal(err)
		}
	}
	var wg sync.WaitGroup
	wins := make(chan Session, 20)
	errs := make(chan error, 20)
	for i := 0; i < 20; i++ {
		u, err := s.CreateUser(ctx, fmt.Sprintf("race-%d@example.test", i), "hash")
		if err != nil {
			t.Fatal(err)
		}
		wg.Add(1)
		go func() {
			defer wg.Done()
			r := reserveFor(u.ID, u.Email, "platform")
			r.GlobalDailyLimit = 200
			a, err := s.ReserveSession(ctx, r)
			if err == nil {
				wins <- a
			} else {
				errs <- err
			}
		}()
	}
	wg.Wait()
	close(wins)
	close(errs)
	if len(wins) != 1 {
		t.Fatalf("concurrent requests exceeded cap: %d winners", len(wins))
	}
	for err := range errs {
		if !errors.Is(err, ErrGlobalQuota) {
			t.Fatal(err)
		}
	}
	a := <-wins
	if _, err := s.AcquireLive(ctx, a.ID, "live"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.ActivateLive(ctx, a.ID, "live"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.ActivateLive(ctx, a.ID, "live"); err != nil {
		t.Fatal(err)
	}
	usage, err := s.Usage(ctx, a.UserID, a.UsageIdentity, false, 200)
	if err != nil || usage.GlobalDailyRemaining == nil || *usage.GlobalDailyRemaining != 0 || usage.FundedAvailable || !usage.FreeInterviewUsed || !usage.GlobalResetAt.Equal(today.AddDate(0, 0, 1)) {
		t.Fatalf("bad exhausted state: %+v %v", usage, err)
	}
	if err = s.ReleaseLive(ctx, a.ID, "live"); err != nil {
		t.Fatal(err)
	}
	// Even deleting the account and aged daily ledger cannot mint another free try.
	if err = s.DeleteUser(ctx, a.UserID); err != nil {
		t.Fatal(err)
	}
	if _, err = s.Pool.Exec(ctx, `DELETE FROM interview_usage`); err != nil {
		t.Fatal(err)
	}
	u, err := s.CreateUser(ctx, a.UsageIdentity, "hash")
	if err != nil {
		t.Fatal(err)
	}
	r := reserveFor(u.ID, a.UsageIdentity, "platform")
	r.GlobalDailyLimit = 200
	if _, err = s.ReserveSession(ctx, r); !errors.Is(err, ErrQuota) {
		t.Fatalf("lifetime claim reset: %v", err)
	}
	r.Session.Funding = "byok"
	if _, err = s.ReserveSession(ctx, r); err != nil {
		t.Fatalf("personal key blocked: %v", err)
	}
}

func TestPostgresLifetimeMigrationBackfillsRetainedLedgerAndOldSessions(t *testing.T) {
	s := postgresRuntime(t)
	ctx := context.Background()
	u, err := s.CreateUser(ctx, "historical@example.test", "hash")
	if err != nil {
		t.Fatal(err)
	}
	a, err := s.ReserveSession(ctx, reserveFor(u.ID, "old-session", "platform"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Pool.Exec(ctx, `UPDATE sessions SET status='complete',started_at=now()-interval '30 days' WHERE id=$1`, a.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = s.Pool.Exec(ctx, `INSERT INTO interview_usage(session_id,identity,funding,activated_at) VALUES($1,'retained-ledger','platform',now())`, NewID()); err != nil {
		t.Fatal(err)
	}
	if _, err = s.Pool.Exec(ctx, `DROP TABLE free_interview_claims`); err != nil {
		t.Fatal(err)
	}
	migration, err := migrationsFS.ReadFile("migrations/0015_lifetime_free_interview.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Pool.Exec(ctx, string(migration)); err != nil {
		t.Fatal(err)
	}
	for _, identity := range []string{"old-session", "retained-ledger"} {
		usage, err := s.Usage(ctx, u.ID, identity, false)
		if err != nil || usage.FundedAvailable || !usage.FreeInterviewUsed {
			t.Fatalf("backfill missed %s: %+v %v", identity, usage, err)
		}
	}
}
