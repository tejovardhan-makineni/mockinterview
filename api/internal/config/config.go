// Package config loads all runtime configuration from the environment.
// The app is designed to run locally with only GEMINI_API_KEY set (everything
// else has sensible localhost defaults), matching the "runs with just an API key"
// goal. When GEMINI_API_KEY is empty the LLM layer transparently uses a
// deterministic stub so the whole product works offline at zero spend.
package config

import (
	"encoding/base64"
	"fmt"
	"log/slog"
	"net/url"
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

	Environment           string
	Hosted                bool
	HostedDailyStartLimit int
	SessionEncryptionKey  string
	PublicURL             string
	ResendAPIKey          string
	MailFrom              string
	SMTPAddress           string
	SMTPUsername          string
	SMTPPassword          string
	ReleaseSHA            string

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

	// Corpus + practice packs
	CorpusDir string
	PacksDir  string

	// Tiers / cost control. Free users get FreeDailyLimit interviews/day; admin
	// emails (developers/testers) are unlimited. Tiers are behind-the-scenes.
	AdminEmails    []string
	FreeDailyLimit int
}

func Load() (*Config, error) {
	loadDotEnv() // best-effort: populate env from .env (repo root) if present

	environment := strings.ToLower(env("APP_ENV", "development"))
	if environment != "development" && environment != "production" {
		return nil, fmt.Errorf("APP_ENV must be development or production")
	}
	production := environment == "production"
	// Parse with the destination width before conversion. Atoi followed by int32
	// can wrap oversized values into an apparently valid production pool size.
	dbMaxConns, err := strconv.ParseInt(env("DB_MAX_CONNS", "10"), 10, 32)
	if err != nil {
		return nil, fmt.Errorf("DB_MAX_CONNS must be a valid 32-bit integer")
	}

	c := &Config{
		Environment:           environment,
		Hosted:                !envBool("LOCAL_UNLIMITED", !production),
		HostedDailyStartLimit: envInt("HOSTED_DAILY_START_LIMIT", 50),
		SessionEncryptionKey:  env("SESSION_ENCRYPTION_KEY", ""),
		PublicURL:             env("PUBLIC_URL", "http://localhost:3000"),
		ResendAPIKey:          env("RESEND_API_KEY", ""),
		MailFrom:              env("MAIL_FROM", ""),
		SMTPAddress:           env("SMTP_ADDRESS", ""),
		SMTPUsername:          env("SMTP_USERNAME", ""),
		SMTPPassword:          env("SMTP_PASSWORD", ""),
		ReleaseSHA:            env("RELEASE_SHA", "development"),
		Port:                  env("PORT", "8080"),
		Mode:                  env("MODE", "api"),
		CORSAllow:             splitCSV(env("CORS_ALLOW", "http://localhost:3000")),
		DatabaseURL:           env("DATABASE_URL", "postgres://mockinterview:mockinterview@localhost:5432/mockinterview?sslmode=disable"),
		DBMaxConns:            int32(dbMaxConns),
		JWTSecret:             env("JWT_SECRET", "dev-insecure-change-me"),
		JWTTTL:                time.Duration(envInt("JWT_TTL_HOURS", 168)) * time.Hour,
		GeminiAPIKey:          env("GEMINI_API_KEY", ""),
		ModelReason:           env("GEMINI_MODEL_REASON", "gemini-2.5-flash"),
		ModelLive:             env("GEMINI_MODEL_LIVE", "gemini-2.5-flash-native-audio-preview-12-2025"),
		ModelTTS:              env("GEMINI_MODEL_TTS", "gemini-2.5-flash-preview-tts"),
		LLMProvider:           strings.ToLower(env("LLM_PROVIDER", "gemini")),
		LLMModel:              env("LLM_MODEL", ""),
		LLMBaseURL:            env("LLM_BASE_URL", ""),
		CorpusDir:             env("CORPUS_DIR", "data/corpus"),
		PacksDir:              env("PACKS_DIR", "data/packs"),
		AdminEmails:           nil,
		FreeDailyLimit:        envInt("FREE_DAILY_LIMIT", 2),
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
	case "gemini":
		c.LLMProvider = "gemini"
		c.LLMAPIKey = c.GeminiAPIKey
		if c.LLMModel == "" {
			c.LLMModel = c.ModelReason
		}
	default:
		return nil, fmt.Errorf("unsupported LLM_PROVIDER %q", c.LLMProvider)
	}

	// Force the stub when the selected provider has no key OR when explicitly
	// requested. This lets the entire backend run/test without spending tokens.
	c.UseStubLLM = c.LLMAPIKey == "" || envBool("USE_STUB_LLM", false)

	if c.Mode != "api" {
		return nil, fmt.Errorf("unsupported MODE %q", c.Mode)
	}

	// Never let a production deploy run with the public default JWT secret — any
	// reader of the repo could forge tokens. In production also require length.
	insecure := c.JWTSecret == "" || c.JWTSecret == "dev-insecure-change-me"
	if production {
		if !c.Hosted {
			return nil, fmt.Errorf("LOCAL_UNLIMITED is forbidden in production")
		}
		if c.UseStubLLM {
			return nil, fmt.Errorf("production requires a configured real LLM provider; stub mode is forbidden")
		}
		if c.GeminiAPIKey == "" {
			return nil, fmt.Errorf("GEMINI_API_KEY is required for hosted native voice")
		}
		key, err := base64.StdEncoding.DecodeString(c.SessionEncryptionKey)
		if err != nil || len(key) != 32 {
			return nil, fmt.Errorf("SESSION_ENCRYPTION_KEY must encode 32 random bytes as base64")
		}
		public, err := url.Parse(c.PublicURL)
		if err != nil || public.Scheme != "https" || public.Host == "" {
			return nil, fmt.Errorf("PUBLIC_URL must be an HTTPS origin in production")
		}
		if c.MailFrom == "" || (c.ResendAPIKey == "" && c.SMTPAddress == "") {
			return nil, fmt.Errorf("production requires MAIL_FROM and RESEND_API_KEY or SMTP_ADDRESS for verification/recovery")
		}
		if c.DBMaxConns < 1 || c.DBMaxConns > 20 {
			return nil, fmt.Errorf("DB_MAX_CONNS must be between 1 and 20 in production")
		}
		for _, origin := range c.CORSAllow {
			u, e := url.Parse(origin)
			if e != nil || u.Scheme != "https" || u.Host == "" || strings.Contains(origin, "*") {
				return nil, fmt.Errorf("CORS_ALLOW must contain explicit HTTPS origins in production")
			}
		}
		if insecure || len(c.JWTSecret) < 32 {
			return nil, fmt.Errorf("JWT_SECRET must be set to a strong value (>=32 chars) in production")
		}
	} else if insecure {
		slog.Warn("using the insecure default JWT_SECRET — set JWT_SECRET before deploying")
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
