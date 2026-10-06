package config

import (
	"encoding/base64"
	"strings"
	"testing"
)

func productionEnv(t *testing.T) {
	t.Helper()
	for k, v := range map[string]string{
		"LOCAL_MEMORY": "false", "APP_ENV": "production", "MODE": "api", "LOCAL_UNLIMITED": "false", "USE_STUB_LLM": "false",
		"JWT_SECRET": strings.Repeat("j", 40), "SESSION_ENCRYPTION_KEY": base64.StdEncoding.EncodeToString([]byte(strings.Repeat("k", 32))),
		"GEMINI_API_KEY": "configured-test-only", "LLM_PROVIDER": "gemini", "PUBLIC_URL": "https://practice.example.com",
		"CORS_ALLOW": "https://practice.example.com", "RESEND_API_KEY": "configured-test-only", "MAIL_FROM": "Practice <noreply@example.com>", "DB_MAX_CONNS": "3", "HOSTED_DAILY_START_LIMIT": "200",
	} {
		t.Setenv(k, v)
	}
}
func TestProductionRejectsUnsafeConfiguration(t *testing.T) {
	for _, tc := range []struct{ key, value string }{
		{"LOCAL_MEMORY", "true"}, {"JWT_SECRET", "short"}, {"SESSION_ENCRYPTION_KEY", "short"}, {"LOCAL_UNLIMITED", "true"}, {"USE_STUB_LLM", "true"},
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

func TestDBMaxConnsCannotWrapOrDefaultInvalidValues(t *testing.T) {
	for _, value := range []string{"4294967297", "8589934602", "-4294967286", "2147483648", "-2147483649", "9223372036854775808", "1.5", "not-a-number", "21"} {
		t.Run(value, func(t *testing.T) {
			productionEnv(t)
			t.Setenv("DB_MAX_CONNS", value)
			if _, err := Load(); err == nil {
				t.Fatalf("accepted unsafe DB_MAX_CONNS=%q", value)
			}
		})
	}
	for _, value := range []string{"1", "20"} {
		t.Run("valid-"+value, func(t *testing.T) {
			productionEnv(t)
			t.Setenv("DB_MAX_CONNS", value)
			c, err := Load()
			if err != nil {
				t.Fatal(err)
			}
			if c.DBMaxConns < 1 || c.DBMaxConns > 20 {
				t.Fatalf("invalid parsed pool size: %d", c.DBMaxConns)
			}
		})
	}
}

func TestHostedDailyLimitCannotBeDisabledOrExceedBetaBudget(t *testing.T) {
	for _, value := range []string{"0", "-1", "201", "999999999999999999999", "invalid"} {
		t.Run(value, func(t *testing.T) {
			productionEnv(t)
			t.Setenv("HOSTED_DAILY_START_LIMIT", value)
			if _, err := Load(); err == nil {
				t.Fatalf("accepted unsafe hosted cap %q", value)
			}
		})
	}
}
func TestCurrentGeminiDefaults(t *testing.T) {
	productionEnv(t)
	for _, key := range []string{"GEMINI_MODEL_REASON", "GEMINI_MODEL_LIVE", "GEMINI_MODEL_TTS", "LLM_MODEL"} {
		t.Setenv(key, "")
	}
	c, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if c.LLMModel != "gemini-3.8-flash" || c.ModelLive != "gemini-3.8-live" || c.ModelTTS != "gemini-3.8-flash-tts" || c.HostedDailyStartLimit != 200 {
		t.Fatalf("stale defaults: %+v", c)
	}
}
