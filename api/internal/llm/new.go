package llm

import (
	"context"
	"fmt"
)

// New builds the reasoning Client for the configured provider. With no API key
// (or ForceStub) it returns the deterministic Stub so the whole product runs
// offline. Every provider implements the same Client interface, so nothing
// downstream branches on which one is active.
func New(ctx context.Context, s Settings) (Client, error) {
	if s.ForceStub || s.APIKey == "" {
		return NewStub(), nil
	}
	switch s.Provider {
	case ProviderGemini, "":
		return NewGemini(ctx, s.APIKey, s.Model)
	case ProviderOpenAI:
		return NewOpenAI(s.APIKey, s.Model, orDefault(s.BaseURL, "https://api.openai.com/v1"), "openai", "gpt-4o-mini"), nil
	case ProviderDeepSeek:
		return NewOpenAI(s.APIKey, s.Model, orDefault(s.BaseURL, "https://api.deepseek.com/v1"), "deepseek", "deepseek-chat"), nil
	case ProviderXAI:
		return NewOpenAI(s.APIKey, s.Model, orDefault(s.BaseURL, "https://api.x.ai/v1"), "xai", "grok-4"), nil
	case ProviderMeta:
		return NewOpenAI(s.APIKey, s.Model, orDefault(s.BaseURL, "https://api.meta.ai/v1"), "meta", "muse-spark-1.2"), nil
	case ProviderAnthropic:
		return NewAnthropic(s.APIKey, s.Model), nil
	default:
		return nil, fmt.Errorf("unknown LLM provider %q", s.Provider)
	}
}

func orDefault(v, def string) string {
	if v == "" {
		return def
	}
	return v
}
