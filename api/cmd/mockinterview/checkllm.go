package main

import (
	"context"
	"fmt"
	"os"
	"time"

	"github.com/tejo/mockinterview-api/internal/config"
	"github.com/tejo/mockinterview-api/internal/llm"
)

// runLLMCheck does one tiny real generation against every provider whose API key
// is present in the environment, reporting OK/FAIL per provider. Used to verify
// all configured providers work: `mockinterview -check-llm`.
func runLLMCheck() {
	_, _ = config.Load() // side effect: loads .env into the environment

	type probe struct {
		provider llm.Provider
		key      string
	}
	probes := []probe{
		{llm.ProviderGemini, os.Getenv("GEMINI_API_KEY")},
		{llm.ProviderOpenAI, os.Getenv("OPENAI_API_KEY")},
		{llm.ProviderDeepSeek, os.Getenv("DEEPSEEK_API_KEY")},
		{llm.ProviderXAI, os.Getenv("XAI_API_KEY")},
		{llm.ProviderMeta, os.Getenv("META_API_KEY")},
		{llm.ProviderAnthropic, os.Getenv("ANTHROPIC_API_KEY")},
	}

	fmt.Println("LLM provider check (tiny live calls):")
	anyFail := false
	for _, p := range probes {
		if p.key == "" {
			fmt.Printf("  %-10s  SKIP  (no key)\n", p.provider)
			continue
		}
		ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
		client, err := llm.New(ctx, llm.Settings{Provider: p.provider, APIKey: p.key})
		if err != nil {
			cancel()
			fmt.Printf("  %-10s  FAIL  (client: %v)\n", p.provider, err)
			anyFail = true
			continue
		}
		out, err := client.Generate(ctx, llm.GenerateRequest{
			Purpose:     llm.PurposeGeneric,
			System:      "You are a health check. Reply with exactly: OK",
			Messages:    []llm.Message{{Role: "user", Text: "Reply with OK"}},
			Temperature: 0,
			MaxTokens:   16,
		})
		cancel()
		if err != nil {
			fmt.Printf("  %-10s  FAIL  (%v)\n", p.provider, err)
			anyFail = true
			continue
		}
		fmt.Printf("  %-10s  OK    model=%s  reply=%q\n", p.provider, client.Info().Model, truncateCheck(out, 40))
	}
	if anyFail {
		os.Exit(1)
	}
}

func truncateCheck(s string, n int) string {
	s = trimSpaceCheck(s)
	if len(s) > n {
		return s[:n] + "…"
	}
	return s
}

func trimSpaceCheck(s string) string {
	for len(s) > 0 && (s[0] == ' ' || s[0] == '\n' || s[0] == '\t' || s[0] == '\r') {
		s = s[1:]
	}
	for len(s) > 0 && (s[len(s)-1] == ' ' || s[len(s)-1] == '\n' || s[len(s)-1] == '\t' || s[len(s)-1] == '\r') {
		s = s[:len(s)-1]
	}
	return s
}
