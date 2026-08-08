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

// The long-lived session JWT must NOT be accepted as a WebSocket ticket, and a
// ws ticket must carry the right subject — this is what keeps a JWT leaked from
// a URL/log from opening a socket.
func TestWSTicketAudienceSeparation(t *testing.T) {
	s := New(nil, "test-secret", time.Hour)

	jwtTok, _ := s.issue("user-123")
	if _, err := s.parseTicket(jwtTok); err == nil {
		t.Error("a normal session JWT must be rejected as a ws ticket (no ws audience)")
	}

	ticket, err := s.issueTicket("user-123")
	if err != nil {
		t.Fatal(err)
	}
	uid, err := s.parseTicket(ticket)
	if err != nil || uid != "user-123" {
		t.Errorf("valid ws ticket should parse to its subject, got uid=%q err=%v", uid, err)
	}

	// SEC-5/GO-10: the reverse must also hold — a 90s ws ticket (which rides in a
	// URL/log) must NOT be accepted as a full API bearer token.
	if _, err := s.parse(ticket); err == nil {
		t.Error("a ws ticket must be rejected as a full API bearer (wrong audience)")
	}
	if uid, err := s.parse(jwtTok); err != nil || uid != "user-123" {
		t.Errorf("a normal session JWT should parse as an API bearer, got uid=%q err=%v", uid, err)
	}
}
