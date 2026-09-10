package auth

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/tejo/mockinterview-api/internal/store"
	"github.com/tejo/mockinterview-api/internal/store/memstore"
)

// These hooks place a revocation at the exact boundary where fresh version
// lookup used to turn an old authentication decision into a valid new session.
type revokingRepo struct {
	*memstore.Mem
	revokeAfterEmail  bool
	revokeAfterChange bool
}

func (r *revokingRepo) UserByEmail(ctx context.Context, email string) (store.User, error) {
	u, err := r.Mem.UserByEmail(ctx, email)
	if err == nil && r.revokeAfterEmail {
		_ = r.Mem.RevokeSessions(ctx, u.ID)
	}
	return u, err
}
func (r *revokingRepo) ChangePassword(ctx context.Context, uid, previous, next string) error {
	err := r.Mem.ChangePassword(ctx, uid, previous, next)
	if err == nil && r.revokeAfterChange {
		err = r.Mem.RevokeSessions(ctx, uid)
	}
	return err
}

func TestLoginDoesNotReviveConcurrentRevocation(t *testing.T) {
	repo := &revokingRepo{Mem: memstore.New(), revokeAfterEmail: true}
	s := New(repo, "test-secret", time.Hour)
	hash, _ := s.hash("long old password")
	_, _ = repo.CreateUser(context.Background(), "person@example.com", hash)
	w := httptest.NewRecorder()
	s.Login(w, httptest.NewRequest(http.MethodPost, "/login", strings.NewReader(`{"email":"person@example.com","password":"long old password"}`)))
	var response authResponse
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &response) != nil {
		t.Fatal(w.Body.String())
	}
	if _, err := s.parse(response.Token); err == nil {
		t.Fatal("concurrent revocation revived by login")
	}
}

func TestPasswordChangeDoesNotReviveLaterRevocation(t *testing.T) {
	repo := &revokingRepo{Mem: memstore.New(), revokeAfterChange: true}
	s := New(repo, "test-secret", time.Hour)
	hash, _ := s.hash("long old password")
	u, _ := repo.CreateUser(context.Background(), "person@example.com", hash)
	req := httptest.NewRequest(http.MethodPost, "/password/change", strings.NewReader(`{"current_password":"long old password","password":"long new password"}`))
	req = req.WithContext(context.WithValue(req.Context(), userIDKey, u.ID))
	w := httptest.NewRecorder()
	s.ChangePassword(w, req)
	var response authResponse
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &response) != nil {
		t.Fatal(w.Body.String())
	}
	if _, err := s.parse(response.Token); err == nil {
		t.Fatal("concurrent revocation revived by password change")
	}
}

func TestWSTicketKeepsAuthenticatedTokenVersion(t *testing.T) {
	repo := memstore.New()
	s := New(repo, "test-secret", time.Hour)
	u, _ := repo.CreateUser(context.Background(), "person@example.com", "unused")
	token, _ := s.issue(u.ID)
	handler := s.Required(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := repo.RevokeSessions(r.Context(), u.ID); err != nil {
			t.Fatal(err)
		}
		s.WSTicket(w, r)
	}))
	req := httptest.NewRequest(http.MethodGet, "/ws-ticket", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	var response map[string]string
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &response) != nil {
		t.Fatal(w.Body.String())
	}
	if _, err := s.parseTicket(response["ticket"]); err == nil {
		t.Fatal("old bearer produced valid ticket after revocation")
	}
}

func TestPasswordChangeInvalidatesOutstandingRecovery(t *testing.T) {
	repo := memstore.New()
	ctx := context.Background()
	u, _ := repo.CreateUser(ctx, "person@example.com", "old-hash")
	if err := repo.SaveAuthAction(ctx, u.ID, "reset", "previous-reset", time.Now().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	if err := repo.ChangePassword(ctx, u.ID, "old-hash", "new-hash"); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.ConsumeAuthAction(ctx, "previous-reset", "reset", "attacker-hash"); err == nil {
		t.Fatal("old recovery token survived password change")
	}
	updated, _ := repo.UserByID(ctx, u.ID)
	if updated.PasswordHash != "new-hash" || updated.TokenVersion != u.TokenVersion+1 {
		t.Fatal("password change was not atomic")
	}
}
