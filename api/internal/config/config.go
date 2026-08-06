// Package config loads all runtime configuration from the environment.
// The app is designed to run locally with only GEMINI_API_KEY set (everything
// else has sensible localhost defaults), matching the "runs with just an API key"
// goal. When GEMINI_API_KEY is empty the LLM layer transparently uses a
// deterministic stub so the whole product works offline at zero spend.
package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	// Server
	Port      string
	Mode      string // "api" (reserved for future "worker" mode)
	CORSAllow []string

	// Database
	DatabaseURL string
	DBMaxConns  int32

	// Auth
	JWTSecret string
	JWTTTL    time.Duration

	// Reasoning LLM (swappable provider for scoring / review / director text).
	LLMProvider string // gemini|openai|deepseek|anthropic
	LLMModel    string // optional override; empty => provider default
	LLMBaseURL  string // optional; for OpenAI-compatible endpoints
	LLMAPIKey   string // resolved key for the selected provider
	UseStubLLM  bool

	// Gemini (also the always-on provider for the native-audio Live voice).
	GeminiAPIKey string
	ModelReason  string // default reasoning model when provider=gemini
	ModelLive    string // native-audio Live model (voice)
	ModelTTS     string // one-shot text-to-speech model (voice previews)

	// Corpus
	CorpusDir string

	// Tiers / cost control. Free users get FreeDailyLimit interviews/day; admin
	// emails (developers/testers) are unlimited. Tiers are behind-the-scenes.
	AdminEmails    []string
	FreeDailyLimit int
}

func Load() (*Config, error) {
	loadDotEnv() // best-effort: populate env from .env (repo root) if present

	c := &Config{
		Port:           env("PORT", "8080"),
		Mode:           env("MODE", "api"),
		CORSAllow:      splitCSV(env("CORS_ALLOW", "http://localhost:3000")),
		DatabaseURL:    env("DATABASE_URL", "postgres://mockinterview:mockinterview@localhost:5432/mockinterview?sslmode=disable"),
		DBMaxConns:     int32(envInt("DB_MAX_CONNS", 10)),
		JWTSecret:      env("JWT_SECRET", "dev-insecure-change-me"),
		JWTTTL:         time.Duration(envInt("JWT_TTL_HOURS", 168)) * time.Hour,
		GeminiAPIKey:   env("GEMINI_API_KEY", ""),
		ModelReason:    env("GEMINI_MODEL_REASON", "gemini-2.5-flash"),
		ModelLive:      env("GEMINI_MODEL_LIVE", "gemini-2.5-flash-native-audio-preview-12-2025"),
		ModelTTS:       env("GEMINI_MODEL_TTS", "gemini-2.5-flash-preview-tts"),
		LLMProvider:    strings.ToLower(env("LLM_PROVIDER", "gemini")),
		LLMModel:       env("LLM_MODEL", ""),
		LLMBaseURL:     env("LLM_BASE_URL", ""),
		CorpusDir:      env("CORPUS_DIR", "data/corpus"),
		AdminEmails:    splitCSV(strings.ToLower(env("ADMIN_EMAILS", "makinenitejovardhan@gmail.com,founder@mockinterview.live,demo@mockinterview.live"))),
		FreeDailyLimit: envInt("FREE_DAILY_LIMIT", 2),
	}

	// Resolve the API key + default model for the selected reasoning provider.
	switch c.LLMProvider {
	case "openai":
		c.LLMAPIKey = env("OPENAI_API_KEY", "")
	case "deepseek":
		c.LLMAPIKey = env("DEEPSEEK_API_KEY", "")
	case "xai":
		c.LLMAPIKey = env("XAI_API_KEY", "")
	case "meta":
		c.LLMAPIKey = env("META_API_KEY", "")
	case "anthropic":
		c.LLMAPIKey = env("ANTHROPIC_API_KEY", "")
	default: // gemini
		c.LLMProvider = "gemini"
		c.LLMAPIKey = c.GeminiAPIKey
		if c.LLMModel == "" {
			c.LLMModel = c.ModelReason
		}
	}

	// Force the stub when the selected provider has no key OR when explicitly
	// requested. This lets the entire backend run/test without spending tokens.
	c.UseStubLLM = c.LLMAPIKey == "" || envBool("USE_STUB_LLM", false)

	if c.Mode != "api" {
		return nil, fmt.Errorf("unsupported MODE %q", c.Mode)
	}
	return c, nil
}

// loadDotEnv loads KEY=VALUE lines from a .env file into the process environment
// without overwriting values already set. It looks in the working dir and the
// parent (the API runs from api/, .env lives at the repo root). No external dep.
func loadDotEnv() {
	for _, path := range []string{".env", "../.env"} {
		data, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		for _, line := range strings.Split(string(data), "\n") {
			line = strings.TrimSpace(line)
			if line == "" || strings.HasPrefix(line, "#") {
				continue
			}
			k, v, ok := strings.Cut(line, "=")
			if !ok {
				continue
			}
			k = strings.TrimSpace(k)
			v = strings.Trim(strings.TrimSpace(v), `"'`)
			if _, exists := os.LookupEnv(k); !exists {
				_ = os.Setenv(k, v)
			}
		}
		return // first file found wins
	}
}

func env(k, def string) string {
	if v := strings.TrimSpace(os.Getenv(k)); v != "" {
		return v
	}
	return def
}

func envInt(k string, def int) int {
	if v := strings.TrimSpace(os.Getenv(k)); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}

func envBool(k string, def bool) bool {
	if v := strings.TrimSpace(os.Getenv(k)); v != "" {
		b, err := strconv.ParseBool(v)
		if err == nil {
			return b
		}
	}
	return def
}

func splitCSV(s string) []string {
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}
