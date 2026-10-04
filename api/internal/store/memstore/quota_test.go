package memstore

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/tejo/mockinterview-api/internal/store"
)

func TestDailyFundedQuotaDoesNotLimitPersonalKeys(t *testing.T) {
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
	// Several personal-key interviews neither consume nor block the daily free one.
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
		t.Fatalf("second daily free interview: %v", err)
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
	if _, err = reserve("platform"); err != nil {
		t.Fatalf("daily allowance did not reset: %v", err)
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
