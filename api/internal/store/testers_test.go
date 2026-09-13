package store

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

func TestPostgresTesterAccountExportAndDeletion(t *testing.T) {
	s := postgresRuntime(t)
	ctx := context.Background()
	for _, email := range []string{"verified@example.test", "unverified@example.test"} {
		if _, err := s.AddTester(ctx, email); err != nil {
			t.Fatal(err)
		}
		u, err := s.CreateUser(ctx, email, "unused")
		if err != nil {
			t.Fatal(err)
		}
		verified := email == "verified@example.test"
		if _, err := s.Pool.Exec(ctx, `UPDATE users SET email_verified=$2 WHERE id=$1`, u.ID, verified); err != nil {
			t.Fatal(err)
		}
		export, err := s.ExportAccount(ctx, u.ID)
		if err != nil {
			t.Fatal(err)
		}
		var data struct {
			Tester *Tester `json:"tester_access"`
		}
		if err := json.Unmarshal(export, &data); err != nil {
			t.Fatal(err)
		}
		if (data.Tester != nil) != verified || data.Tester != nil && data.Tester.Email != email {
			t.Fatal("exported another person's tester invitation", string(export))
		}
		if err := s.DeleteUser(ctx, u.ID); err != nil {
			t.Fatal(err)
		}
		var remains bool
		if err := s.Pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM tester_emails WHERE email=$1)`, email).Scan(&remains); err != nil || remains == verified {
			t.Fatal("account deletion tester privacy/ownership", verified, remains, err)
		}
	}
}

func TestNormalizeTesterEmail(t *testing.T) {
	for _, input := range []string{"", "missing-at", "Name <valid@example.com>", "<valid@example.com>", "a@example.com,b@example.com", "a@example.com\nBcc: b@example.com", "a\x00@example.com", strings.Repeat("a", 245) + "@example.com"} {
		if _, err := NormalizeTesterEmail(input); !errors.Is(err, ErrInvalidTesterEmail) {
			t.Fatalf("accepted invalid mailbox %q", input)
		}
	}
	if got, err := NormalizeTesterEmail("  First.Last+test@Example.COM  "); err != nil || got != "first.last+test@example.com" {
		t.Fatalf("normalization: %q %v", got, err)
	}
}

func TestPostgresTestersVerifiedAllowlistAndUnlimitedPractice(t *testing.T) {
	s := postgresRuntime(t)
	ctx := context.Background()
	first, err := s.AddTester(ctx, " Tester@Example.COM ")
	if err != nil {
		t.Fatal(err)
	}
	second, err := s.AddTester(ctx, "tester@example.com")
	if err != nil || !first.CreatedAt.Equal(second.CreatedAt) {
		t.Fatal("duplicate add was not idempotent", err)
	}
	u, err := s.CreateUser(ctx, "tester@example.com", "unused")
	if err != nil {
		t.Fatal(err)
	}
	if ok, err := s.IsTester(ctx, u.ID); err != nil || ok {
		t.Fatal("unverified mailbox got access", err)
	}
	if _, err := s.Pool.Exec(ctx, `UPDATE users SET email_verified=true WHERE id=$1`, u.ID); err != nil {
		t.Fatal(err)
	}
	if ok, err := s.IsTester(ctx, u.ID); err != nil || !ok {
		t.Fatal("verified mailbox missing access", err)
	}
	if user, err := s.UserByID(ctx, u.ID); err != nil || user.Role == "admin" {
		t.Fatal("tester membership changed role", err)
	}
	alias, err := s.CreateUser(ctx, "tester+alias@example.com", "unused")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Pool.Exec(ctx, `UPDATE users SET email_verified=true WHERE id=$1`, alias.ID); err != nil {
		t.Fatal(err)
	}
	if ok, err := s.IsTester(ctx, alias.ID); err != nil || ok {
		t.Fatal("unlisted alias got access", err)
	}
	r := reserveFor(u.ID, "tester-identity", "platform")
	r.GlobalDailyLimit = 1
	r.Session.FeedbackVersion = InterviewFeedbackVersion
	for range 3 {
		a, err := s.ReserveSession(ctx, r)
		if err != nil {
			t.Fatal("tester blocked on repeated reservation", err)
		}
		if _, err := s.ReserveSession(ctx, r); !errors.Is(err, ErrSessionConflict) {
			t.Fatal("tester bypassed active-session integrity", err)
		}
		if _, err := s.AcquireLive(ctx, a.ID, "test"); err != nil {
			t.Fatal(err)
		}
		if _, err := s.ActivateLive(ctx, a.ID, "test"); err != nil {
			t.Fatal("tester activation", err)
		}
		if err := s.UpdateSessionStatus(ctx, a.ID, "complete"); err != nil {
			t.Fatal(err)
		}
		if err := s.ReleaseLive(ctx, a.ID, "test"); err != nil {
			t.Fatal(err)
		}
		if pending, err := s.PendingInterviewFeedback(ctx, u.ID); err != nil || len(pending) != 0 {
			t.Fatal("tester feedback was mandatory", err)
		}
	}
	usage, err := s.Usage(ctx, u.ID, r.Identity, false)
	if err != nil || !usage.TesterUnlimited || usage.LocalUnlimited || !usage.FundedAvailable || usage.NextStartAt != nil || usage.NextFundedAt != nil {
		t.Fatalf("tester usage %+v %v", usage, err)
	}
	// Tester starts do not exhaust the ordinary global budget.
	ordinary := reserveFor(alias.ID, "ordinary", "platform")
	ordinary.GlobalDailyLimit = 1
	if _, err := s.ReserveSession(ctx, ordinary); err != nil {
		t.Fatal("testers exhausted regular global budget", err)
	}
	// Tester can reserve and activate even while ordinary reservations fill it.
	a, err := s.ReserveSession(ctx, r)
	if err != nil {
		t.Fatal("global cap blocked tester", err)
	}
	if _, err := s.AcquireLive(ctx, a.ID, "test"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.ActivateLive(ctx, a.ID, "test"); err != nil {
		t.Fatal("global cap blocked tester activation", err)
	}
	if err := s.UpdateSessionStatus(ctx, a.ID, "complete"); err != nil {
		t.Fatal(err)
	}
	if err := s.ReleaseLive(ctx, a.ID, "test"); err != nil {
		t.Fatal(err)
	}
	if err := s.RemoveTester(ctx, " TESTER@example.com "); err != nil {
		t.Fatal(err)
	}
	if err := s.RemoveTester(ctx, "tester@example.com"); err != nil {
		t.Fatal("idempotent removal", err)
	}
	usage, err = s.Usage(ctx, u.ID, r.Identity, false)
	if err != nil || usage.TesterUnlimited || usage.FundedAvailable || usage.NextStartAt == nil || usage.NextFundedAt == nil {
		t.Fatalf("removal did not restore quota %+v %v", usage, err)
	}
	if pending, err := s.PendingInterviewFeedback(ctx, u.ID); err != nil || len(pending) != 4 {
		t.Fatal("removal did not restore required feedback", len(pending), err)
	}
	if _, err := s.ReserveSession(ctx, r); !errors.Is(err, ErrInterviewFeedbackRequired) {
		t.Fatal("feedback gate after removal", err)
	}
	if items, err := s.ListTesters(ctx); err != nil || len(items) != 0 {
		t.Fatal("removed email still listed", err)
	}
}

func TestPostgresTesterRemovalRechecksReservedActivation(t *testing.T) {
	for _, gate := range []string{"personal", "global"} {
		t.Run(gate, func(t *testing.T) {
			s := postgresRuntime(t)
			ctx := context.Background()
			u, err := s.CreateUser(ctx, "tester@example.com", "unused")
			if err != nil {
				t.Fatal(err)
			}
			if _, err := s.Pool.Exec(ctx, `UPDATE users SET email_verified=true WHERE id=$1`, u.ID); err != nil {
				t.Fatal(err)
			}
			if _, err := s.AddTester(ctx, u.Email); err != nil {
				t.Fatal(err)
			}
			r := reserveFor(u.ID, "identity", "platform")
			r.GlobalDailyLimit = 1
			if gate == "personal" {
				a, err := s.ReserveSession(ctx, r)
				if err != nil {
					t.Fatal(err)
				}
				if _, err := s.AcquireLive(ctx, a.ID, "first"); err != nil {
					t.Fatal(err)
				}
				if _, err := s.ActivateLive(ctx, a.ID, "first"); err != nil {
					t.Fatal(err)
				}
				if err := s.UpdateSessionStatus(ctx, a.ID, "complete"); err != nil {
					t.Fatal(err)
				}
				if err := s.ReleaseLive(ctx, a.ID, "first"); err != nil {
					t.Fatal(err)
				}
				if err := s.DeleteSession(ctx, a.ID); err != nil {
					t.Fatal(err)
				}
			} else {
				other, err := s.CreateUser(ctx, "regular@example.com", "unused")
				if err != nil {
					t.Fatal(err)
				}
				otherR := reserveFor(other.ID, "regular", "platform")
				otherR.GlobalDailyLimit = 1
				if _, err := s.ReserveSession(ctx, otherR); err != nil {
					t.Fatal(err)
				}
			}
			a, err := s.ReserveSession(ctx, r)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := s.AcquireLive(ctx, a.ID, "reserved"); err != nil {
				t.Fatal(err)
			}
			if err := s.RemoveTester(ctx, u.Email); err != nil {
				t.Fatal(err)
			}
			if _, err := s.ActivateLive(ctx, a.ID, "reserved"); !errors.Is(err, ErrQuota) {
				t.Fatal("reserved tester retained stale bypass after removal", err)
			}
			var exempt bool
			if err := s.Pool.QueryRow(ctx, `SELECT quota_exempt FROM sessions WHERE id=$1`, a.ID).Scan(&exempt); err != nil || exempt {
				t.Fatal("tester persisted local bypass", err)
			}
		})
	}
}
