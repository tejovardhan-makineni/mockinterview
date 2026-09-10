package store

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"
)

func TestPostgresPolicyAcknowledgmentPersistenceExportAndDeletion(t *testing.T) {
	s := postgresRuntime(t)
	ctx := context.Background()
	legacy, err := s.CreateUser(ctx, "legacy-policy@example.test", "private-test-hash")
	if err != nil {
		t.Fatal(err)
	}
	legacy, err = s.UserByID(ctx, legacy.ID)
	if err != nil || legacy.PoliciesAcceptedAt != nil || legacy.AdultConfirmedAt != nil || legacy.TermsVersion != "" {
		t.Fatal("migration manufactured existing user acknowledgment")
	}
	before := time.Now().Add(-time.Second)
	u, err := s.CreateUserWithPolicies(ctx, "new-policy@example.test", "private-test-hash", "2026-09-10", "2026-09-10")
	if err != nil {
		t.Fatal(err)
	}
	if u.PoliciesAcceptedAt == nil || u.AdultConfirmedAt == nil || u.PoliciesAcceptedAt.Before(before) || u.PoliciesAcceptedAt.After(time.Now()) {
		t.Fatal("server timestamps missing or outside request")
	}
	if _, err = s.CreateUserWithPolicies(ctx, u.Email, "different-test-hash", "different", "different"); err == nil {
		t.Fatal("duplicate registration accepted")
	}
	byEmail, err := s.UserByEmail(ctx, u.Email)
	if err != nil || byEmail.TermsVersion != "2026-09-10" || byEmail.PrivacyVersion != "2026-09-10" {
		t.Fatal("duplicate registration corrupted policy record")
	}
	accepted, err := s.AcceptPolicies(ctx, legacy.ID, "2026-09-09", "2026-09-09")
	if err != nil || accepted.AdultConfirmedAt == nil || accepted.PoliciesAcceptedAt == nil {
		t.Fatal("legacy acknowledgment failed")
	}
	repeated, err := s.AcceptPolicies(ctx, legacy.ID, "2026-09-09", "2026-09-09")
	if err != nil || !accepted.PoliciesAcceptedAt.Equal(*repeated.PoliciesAcceptedAt) {
		t.Fatal("repeat acknowledgment rewrote original timestamp")
	}
	updated, err := s.AcceptPolicies(ctx, legacy.ID, "2026-09-10", "2026-09-10")
	if err != nil || updated.TermsVersion != "2026-09-10" || updated.PrivacyVersion != "2026-09-10" || !updated.AdultConfirmedAt.Equal(*accepted.AdultConfirmedAt) || !updated.PoliciesAcceptedAt.After(*accepted.PoliciesAcceptedAt) {
		t.Fatal("new document acknowledgment did not update versions/time while preserving the original adult assertion")
	}
	exported, err := s.ExportAccount(ctx, legacy.ID)
	if err != nil {
		t.Fatal(err)
	}
	var decoded struct {
		Account map[string]any `json:"account"`
	}
	if err = json.Unmarshal(exported, &decoded); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"adult_confirmed_at", "policies_accepted_at", "terms_version", "privacy_version"} {
		if decoded.Account[key] == nil || decoded.Account[key] == "" {
			t.Fatalf("export omitted %s", key)
		}
	}
	if _, ok := decoded.Account["password_hash"]; ok {
		t.Fatal("export disclosed password hash")
	}
	if decoded.Account["terms_version"] != "2026-09-10" || decoded.Account["privacy_version"] != "2026-09-10" {
		t.Fatal("export did not include the latest acknowledged documents")
	}
	if err = s.DeleteUser(ctx, legacy.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = s.UserByID(ctx, legacy.ID); !errors.Is(err, ErrNotFound) {
		t.Fatal("deleted account retains policy row")
	}
	if _, err = s.AcceptPolicies(ctx, legacy.ID, "2026-09-10", "2026-09-10"); !errors.Is(err, ErrNotFound) {
		t.Fatal("acknowledgment recreated deleted account")
	}
}
