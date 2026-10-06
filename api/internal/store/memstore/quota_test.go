package memstore

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/tejo/mockinterview-api/internal/store"
)

func TestLifetimeFundedQuotaDoesNotLimitPersonalKeys(t *testing.T) {
	m := New()
	ctx := context.Background()
	u, _ := m.CreateUser(ctx, "practice@example.test", "hash")
	reserve := func(funding string) (store.Session, error) {
		return m.ReserveSession(ctx, store.Reservation{Identity: "same-user", Session: store.Session{UserID: u.ID, Funding: funding, DurationMinutes: 5, Mode: "text"}})
	}
	finish := func(a store.Session) {
		t.Helper()
		if _, err := m.AcquireLive(ctx, a.ID, "live"); err != nil {
			t.Fatal(err)
		}
		if _, err := m.ActivateLive(ctx, a.ID, "live"); err != nil {
			t.Fatal(err)
		}
		if err := m.ReleaseLive(ctx, a.ID, "live"); err != nil {
			t.Fatal(err)
		}
		if err := m.DeleteSession(ctx, a.ID); err != nil {
			t.Fatal(err)
		}
	}
	// Several personal-key interviews neither consume nor block the one free one.
	for i := 0; i < 3; i++ {
		a, err := reserve("byok")
		if err != nil {
			t.Fatal(err)
		}
		finish(a)
	}
	usage, _ := m.Usage(ctx, u.ID, "same-user", false)
	if !usage.FundedAvailable || usage.NextFundedAt != nil {
		t.Fatalf("own-key practice consumed free allowance: %+v", usage)
	}
	free, err := reserve("platform")
	if err != nil {
		t.Fatal(err)
	}
	finish(free)
	if _, err = reserve("platform"); !errors.Is(err, store.ErrQuota) {
		t.Fatalf("second one free interview: %v", err)
	}
	personal, err := reserve("byok")
	if err != nil {
		t.Fatalf("own key blocked after free practice: %v", err)
	}
	finish(personal)
	m.mu.Lock()
	for i := range m.runtimeUsage {
		if m.runtimeUsage[i].funding == "platform" {
			m.runtimeUsage[i].at = time.Now().Add(-25 * time.Hour)
		}
	}
	m.mu.Unlock()
	if _, err = reserve("platform"); !errors.Is(err, store.ErrQuota) {
		t.Fatalf("lifetime allowance incorrectly reset: %v", err)
	}
}

func TestExpiredPreparationReleasesMemoryAdmissionAndKey(t *testing.T) {
	m := New()
	ctx := context.Background()
	u, _ := m.CreateUser(ctx, "expired@example.test", "hash")
	r := store.Reservation{Preparing: true, Identity: "expired", Credential: []byte("encrypted"), CredentialExpires: time.Now().Add(time.Hour), Session: store.Session{UserID: u.ID, Funding: "platform", Mode: "text"}}
	a, err := m.ReserveSession(ctx, r)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := m.AcquireLive(ctx, a.ID, "early"); !errors.Is(err, store.ErrSessionConflict) {
		t.Fatal("incomplete plan connected")
	}
	m.mu.Lock()
	expired := time.Now().Add(-time.Second)
	m.sessions[a.ID].sess.ReservedUntil = &expired
	m.mu.Unlock()
	usage, err := m.Usage(ctx, u.ID, r.Identity, false)
	if err != nil || usage.ActiveSessionID != "" || !usage.FundedAvailable {
		t.Fatalf("expired preparation kept quota: %+v %v", usage, err)
	}
	if _, err := m.SessionCredential(ctx, a.ID); !errors.Is(err, store.ErrCredentialExpired) {
		t.Fatal("expired preparation retained key")
	}
	if err := m.CompletePreparation(ctx, a.ID, "late", nil, nil); !errors.Is(err, store.ErrSessionConflict) {
		t.Fatal("expired planner could resurrect session")
	}
	if _, err := m.ReserveSession(ctx, r); err != nil {
		t.Fatal("expired preparation blocked fresh attempt", err)
	}
}

func TestConcurrentGlobalCapacityIncludesTestersAndResetsAtUTCMidnight(t *testing.T) {
	ctx := context.Background()
	m := New()
	today := store.UTCDayStart(time.Now())
	for i := 0; i < 199; i++ {
		m.runtimeUsage = append(m.runtimeUsage, usageRec{funding: "platform", at: today, testerExempt: true})
	}
	// Yesterday is excluded even when it lies within the last rolling 24 hours.
	m.runtimeUsage = append(m.runtimeUsage, usageRec{funding: "platform", at: today.Add(-time.Nanosecond)})
	var wg sync.WaitGroup
	wins := make(chan store.Session, 20)
	errs := make(chan error, 20)
	for i := 0; i < 20; i++ {
		u, err := m.CreateUser(ctx, fmt.Sprintf("capacity-%d@example.test", i), "hash")
		if err != nil {
			t.Fatal(err)
		}
		wg.Add(1)
		go func() {
			defer wg.Done()
			a, err := m.ReserveSession(ctx, store.Reservation{Identity: u.Email, GlobalDailyLimit: 200, Session: store.Session{UserID: u.ID, Funding: "platform", DurationMinutes: 5}})
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
		t.Fatalf("admitted %d at capacity 199/200", len(wins))
	}
	for err := range errs {
		if !errors.Is(err, store.ErrGlobalQuota) {
			t.Fatal(err)
		}
	}
	winner := <-wins
	usage, err := m.Usage(ctx, winner.UserID, winner.UsageIdentity, false, 200)
	if err != nil || usage.GlobalDailyRemaining == nil || *usage.GlobalDailyRemaining != 1 {
		t.Fatalf("own reservation was counted twice: %+v %v", usage, err)
	}
	if _, err = m.AcquireLive(ctx, winner.ID, "owner"); err != nil {
		t.Fatal(err)
	}
	if _, err = m.ActivateLive(ctx, winner.ID, "owner"); err != nil {
		t.Fatal(err)
	}
	if _, err = m.ActivateLive(ctx, winner.ID, "owner"); err != nil {
		t.Fatal(err)
	}
	usage, err = m.Usage(ctx, winner.UserID, winner.UsageIdentity, false, 200)
	if err != nil || usage.FundedAvailable || !usage.FreeInterviewUsed || *usage.GlobalDailyRemaining != 0 || !usage.GlobalResetAt.Equal(today.AddDate(0, 0, 1)) {
		t.Fatalf("wrong capacity after activation: %+v %v", usage, err)
	}
	if len(m.runtimeUsage) != 201 {
		t.Fatal("reconnect consumed an extra place")
	}
}

func TestFreeClaimSurvivesAccountDeletionAndUsageCleanup(t *testing.T) {
	ctx := context.Background()
	m := New()
	u, _ := m.CreateUser(ctx, "once@example.test", "hash")
	r := store.Reservation{Identity: "stable-identity", Session: store.Session{UserID: u.ID, Funding: "platform", DurationMinutes: 5}}
	a, err := m.ReserveSession(ctx, r)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = m.AcquireLive(ctx, a.ID, "owner"); err != nil {
		t.Fatal(err)
	}
	if _, err = m.ActivateLive(ctx, a.ID, "owner"); err != nil {
		t.Fatal(err)
	}
	if err = m.ReleaseLive(ctx, a.ID, "owner"); err != nil {
		t.Fatal(err)
	}
	if err = m.DeleteUser(ctx, u.ID); err != nil {
		t.Fatal(err)
	}
	m.runtimeUsage = nil
	u, _ = m.CreateUser(ctx, "once@example.test", "hash")
	r.Session.UserID = u.ID
	if _, err = m.ReserveSession(ctx, r); !errors.Is(err, store.ErrQuota) {
		t.Fatalf("account recreation reset lifetime claim: %v", err)
	}
}
