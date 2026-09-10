package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestAuthLimitsSeparateAccountsBehindSharedProxy(t *testing.T) {
	handler := authRateLimit("stable-test-key")(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]string
		if json.NewDecoder(r.Body).Decode(&body) != nil || body["password"] != "preserved" {
			t.Error("limiter consumed credential request body")
		}
		w.WriteHeader(204)
	}))
	hit := func(email, spoofedIP string) int {
		r := httptest.NewRequest("POST", "/auth/login", strings.NewReader(`{"email":"`+email+`","password":"preserved"}`))
		r.RemoteAddr = "10.0.0.1:1234"
		r.Header.Set("X-Forwarded-For", spoofedIP)
		r.Header.Set("X-Real-IP", spoofedIP)
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w.Code
	}
	for i := 0; i < 10; i++ {
		if got := hit("one@example.com", "forged"); got != 204 {
			t.Fatalf("request %d=%d", i, got)
		}
	}
	if got := hit("one@example.com", "new-forged-ip"); got != 429 {
		t.Fatalf("forged forwarding header bypassed limit=%d", got)
	}
	if got := hit("other@example.com", "same-edge"); got != 204 {
		t.Fatalf("shared proxy blocked independent account=%d", got)
	}
}
