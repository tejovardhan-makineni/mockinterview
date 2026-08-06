package auth

import (
	"testing"
	"time"

	"golang.org/x/crypto/bcrypt"
)

func newService() *Service {
	return New(nil, "test-secret", time.Hour)
}

func TestHashVerify(t *testing.T) {
	s := newService()
	h, err := s.hash("hunter2")
	if err != nil {
		t.Fatal(err)
	}
	if bcrypt.CompareHashAndPassword([]byte(h), []byte("hunter2")) != nil {
		t.Error("correct password should verify")
	}
	if bcrypt.CompareHashAndPassword([]byte(h), []byte("wrong")) == nil {
		t.Error("wrong password must not verify")
	}
}

func TestTokenRoundTrip(t *testing.T) {
	s := newService()
	tok, err := s.issue("user-123")
	if err != nil {
		t.Fatal(err)
	}
	uid, err := s.parse(tok)
	if err != nil {
		t.Fatalf("parse valid token: %v", err)
	}
	if uid != "user-123" {
		t.Errorf("round-trip uid = %q, want user-123", uid)
	}
}

func TestTokenRejectsWrongSecret(t *testing.T) {
	tok, _ := New(nil, "secret-a", time.Hour).issue("user-123")
	if _, err := New(nil, "secret-b", time.Hour).parse(tok); err == nil {
		t.Error("token signed with a different secret must be rejected")
	}
}

func TestExpiredTokenRejected(t *testing.T) {
	s := New(nil, "test-secret", -time.Hour) // already expired
	tok, _ := s.issue("user-123")
	if _, err := s.parse(tok); err == nil {
		t.Error("expired token must be rejected")
	}
}
