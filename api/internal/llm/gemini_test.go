package llm

import (
	"testing"

	"google.golang.org/genai"
)

func TestGeminiPersonalModelsUseCompatibleThinkingControls(t *testing.T) {
	flash := geminiGenerationConfig("gemini-2.5-flash", 32)
	if flash.ThinkingConfig == nil || flash.ThinkingConfig.ThinkingBudget == nil || *flash.ThinkingConfig.ThinkingBudget != 0 || flash.MaxOutputTokens != 32 {
		t.Fatal("free Flash should retain the low-latency non-thinking config")
	}
	pro := geminiGenerationConfig("models/gemini-2.5-pro", 32)
	if pro.ThinkingConfig == nil || pro.ThinkingConfig.ThinkingBudget == nil || *pro.ThinkingConfig.ThinkingBudget < 128 || pro.MaxOutputTokens <= *pro.ThinkingConfig.ThinkingBudget {
		t.Fatal("2.5 Pro cannot disable thinking or use its entire answer budget on thinking")
	}
	advanced := geminiGenerationConfig("gemini-3-pro-preview", 32)
	if advanced.ThinkingConfig == nil || advanced.ThinkingConfig.ThinkingBudget != nil || advanced.ThinkingConfig.ThinkingLevel != genai.ThinkingLevelLow || advanced.MaxOutputTokens < 1024 {
		t.Fatal("Gemini 3 should use a thinking level and reserve visible-output headroom")
	}
	legacy := geminiGenerationConfig("gemini-2.0-flash", 200)
	if legacy.ThinkingConfig != nil {
		t.Fatal("non-thinking models received unsupported thinking controls")
	}
}
