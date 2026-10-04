package config

import (
	"encoding/base64"
	"path/filepath"
	"strings"
	"testing"
)

func desktopEnv(t *testing.T) {
	t.Helper()
	for k, v := range map[string]string{"APP_ENV": "development", "LOCAL_DESKTOP": "true", "LOCAL_MEMORY": "false", "LOCAL_UNLIMITED": "true", "DESKTOP_DB_PATH": filepath.Join(t.TempDir(), "interviews.sqlite"), "DESKTOP_WEB_DIR": t.TempDir(), "DESKTOP_BRIDGE_TOKEN": strings.Repeat("b", 64), "JWT_SECRET": strings.Repeat("j", 64), "SESSION_ENCRYPTION_KEY": base64.StdEncoding.EncodeToString([]byte(strings.Repeat("k", 32))), "LLM_PROVIDER": "gemini", "GEMINI_API_KEY": "inherited-should-never-be-used", "RESEND_API_KEY": "inherited-should-never-be-used"} {
		t.Setenv(k, v)
	}
}

func TestDesktopConfigurationCannotUseHostedCredentials(t *testing.T) {
	desktopEnv(t)
	c, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if c.Hosted || c.UseStubLLM || c.GeminiAPIKey != "" || c.LLMAPIKey != "" || c.ResendAPIKey != "" {
		t.Fatal("desktop inherited funded or simulated AI")
	}
}
func TestDesktopConfigurationFailsClosed(t *testing.T) {
	for _, tc := range []struct{ k, v string }{{"APP_ENV", "production"}, {"LOCAL_MEMORY", "true"}, {"DESKTOP_DB_PATH", "relative.db"}, {"DESKTOP_WEB_DIR", "relative"}, {"DESKTOP_BRIDGE_TOKEN", "short"}, {"JWT_SECRET", "short"}, {"SESSION_ENCRYPTION_KEY", "short"}} {
		t.Run(tc.k, func(t *testing.T) {
			desktopEnv(t)
			t.Setenv(tc.k, tc.v)
			if _, err := Load(); err == nil {
				t.Fatalf("unsafe %s", tc.k)
			}
		})
	}
}
