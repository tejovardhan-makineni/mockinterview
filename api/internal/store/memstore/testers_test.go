package memstore

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/tejo/mockinterview-api/internal/store"
	"testing"
)

func TestTesterAccessRemovalAndAccountPrivacy(t *testing.T) {
	ctx := context.Background()
	m := New()
	for _, email := range []string{"verified@example.test", "unverified@example.test"} {
		if _, err := m.AddTester(ctx, email); err != nil {
			t.Fatal(err)
		}
		u, err := m.CreateUser(ctx, email, "unused")
		if err != nil {
			t.Fatal(err)
		}
		verified := email == "verified@example.test"
		u.EmailVerified = verified
		m.users[u.ID] = u
		export, err := m.ExportAccount(ctx, u.ID)
		if err != nil {
			t.Fatal(err)
		}
		var data struct {
			Tester *store.Tester `json:"tester_access"`
		}
		if err := json.Unmarshal(export, &data); err != nil {
			t.Fatal(err)
		}
		if (data.Tester != nil) != verified {
			t.Fatal("unverified user saw pre-added invitation")
		}
		if verified {
			r := store.Reservation{Session: store.Session{UserID: u.ID, QuestionID: "q", Funding: "platform", DurationMinutes: 15}, Identity: "tester", GlobalDailyLimit: 1}
			first, err := m.ReserveSession(ctx, r)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := m.AcquireLive(ctx, first.ID, "first"); err != nil {
				t.Fatal(err)
			}
			if _, err := m.ActivateLive(ctx, first.ID, "first"); err != nil {
				t.Fatal(err)
			}
			if err := m.UpdateSessionStatus(ctx, first.ID, "complete"); err != nil {
				t.Fatal(err)
			}
			second, err := m.ReserveSession(ctx, r)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := m.AcquireLive(ctx, second.ID, "second"); err != nil {
				t.Fatal(err)
			}
			if err := m.RemoveTester(ctx, email); err != nil {
				t.Fatal(err)
			}
			if _, err := m.ActivateLive(ctx, second.ID, "second"); !errors.Is(err, store.ErrQuota) {
				t.Fatal("removal did not restore limits for reserved session", err)
			}
			if _, err := m.AddTester(ctx, email); err != nil {
				t.Fatal(err)
			}
		}
		if err := m.DeleteUser(ctx, u.ID); err != nil {
			t.Fatal(err)
		}
		_, remains := m.testers[email]
		if remains == verified {
			t.Fatal("verified deletion must erase own tester entry; unverified cannot revoke invitation")
		}
	}
}
