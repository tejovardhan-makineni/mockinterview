package config

import (
	"encoding/base64"
	"strings"
	"testing"
)

func productionEnv(t *testing.T) {
	t.Helper()
	for k, v := range map[string]string{
		"APP_ENV": "production", "MODE": "api", "LOCAL_UNLIMITED": "false", "USE_STUB_LLM": "false",
		"JWT_SECRET": strings.Repeat("j", 40), "SESSION_ENCRYPTION_KEY": base64.StdEncoding.EncodeToString([]byte(strings.Repeat("k", 32))),
		"GEMINI_API_KEY": "configured-test-only", "LLM_PROVIDER": "gemini", "PUBLIC_URL": "https://practice.example.com",
		"CORS_ALLOW": "https://practice.example.com", "RESEND_API_KEY": "configured-test-only", "MAIL_FROM": "Practice <noreply@example.com>", "DB_MAX_CONNS": "3",
	} {
		t.Setenv(k, v)
	}
}
func TestProductionRejectsUnsafeConfiguration(t *testing.T) {
	for _, tc := range []struct{ key, value string }{
		{"JWT_SECRET", "short"}, {"SESSION_ENCRYPTION_KEY", "short"}, {"LOCAL_UNLIMITED", "true"}, {"USE_STUB_LLM", "true"},
		{"PUBLIC_URL", "http://localhost:3000"}, {"CORS_ALLOW", "*"}, {"LLM_PROVIDER", "typo"}, {"DB_MAX_CONNS", "0"}, {"APP_ENV", "production-typo"},
	} {
		t.Run(tc.key, func(t *testing.T) {
			productionEnv(t)
			t.Setenv(tc.key, tc.value)
			if _, err := Load(); err == nil {
				t.Fatalf("accepted unsafe %s", tc.key)
			}
		})
	}
}
func TestProductionValidConfiguration(t *testing.T) {
	productionEnv(t)
	c, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if !c.Hosted || c.UseStubLLM || len(c.AdminEmails) != 0 {
		t.Fatal("unexpected production capabilities")
	}
}
