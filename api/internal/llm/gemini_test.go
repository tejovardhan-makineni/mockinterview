package llm

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"google.golang.org/genai"
)

func TestGeminiPersonalModelsUseCompatibleThinkingControls(t *testing.T) {
	flash := geminiGenerationConfig("gemini-2.5-flash", 32, PurposeGeneric)
	if flash.ThinkingConfig == nil || flash.ThinkingConfig.ThinkingBudget == nil || *flash.ThinkingConfig.ThinkingBudget != 0 || flash.MaxOutputTokens != 32 {
		t.Fatal("free Flash should retain the low-latency non-thinking config")
	}
	pro := geminiGenerationConfig("models/gemini-2.5-pro", 32, PurposeGeneric)
	if pro.ThinkingConfig == nil || pro.ThinkingConfig.ThinkingBudget == nil || *pro.ThinkingConfig.ThinkingBudget < 128 || pro.MaxOutputTokens <= *pro.ThinkingConfig.ThinkingBudget {
		t.Fatal("2.5 Pro cannot disable thinking or use its entire answer budget on thinking")
	}
	advanced := geminiGenerationConfig("gemini-3-pro-preview", 32, PurposeGeneric)
	if advanced.ThinkingConfig == nil || advanced.ThinkingConfig.ThinkingBudget != nil || advanced.ThinkingConfig.ThinkingLevel != genai.ThinkingLevelLow || advanced.MaxOutputTokens < 1024 {
		t.Fatal("Gemini 3 should use a thinking level and reserve visible-output headroom")
	}
	legacy := geminiGenerationConfig("gemini-2.0-flash", 200, PurposeGeneric)
	if legacy.ThinkingConfig != nil {
		t.Fatal("non-thinking models received unsupported thinking controls")
	}
}

func TestGeminiFlashDirectorReservesPrivateReasoningBudget(t *testing.T) {
	for _, model := range []string{
		"gemini-2.5-flash",
		"models/gemini-2.5-flash",
		"gemini-2.5-flash-preview-09-2025",
		"gemini-2.5-flash-lite",
		"models/gemini-2.5-flash-lite",
		"gemini-2.5-flash-lite-preview-09-2025",
	} {
		t.Run(model, func(t *testing.T) {
			cfg := geminiGenerationConfig(model, 200, PurposeDirector)
			if cfg.ThinkingConfig == nil || cfg.ThinkingConfig.ThinkingBudget == nil || *cfg.ThinkingConfig.ThinkingBudget != 512 {
				t.Fatalf("director thinking budget = %+v, want 512", cfg.ThinkingConfig)
			}
			if cfg.MaxOutputTokens != 712 {
				t.Fatalf("max output tokens = %d, want 512 reasoning + 200 answer", cfg.MaxOutputTokens)
			}
			if cfg.ThinkingConfig.IncludeThoughts {
				t.Fatal("private reasoning must not be included in the spoken answer")
			}
			if cfg := geminiGenerationConfig(model, 0, PurposeDirector); cfg.MaxOutputTokens != 0 {
				t.Fatal("an unspecified output limit must remain unspecified")
			}
			for _, purpose := range []Purpose{"", PurposeGeneric, PurposeResumeParse, PurposeResumeReview, PurposeResumeMatch, PurposeScore, PurposeSummarize} {
				cfg := geminiGenerationConfig(model, 200, purpose)
				if cfg.ThinkingConfig == nil || cfg.ThinkingConfig.ThinkingBudget == nil || *cfg.ThinkingConfig.ThinkingBudget != 0 || cfg.ThinkingConfig.IncludeThoughts || cfg.MaxOutputTokens != 200 {
					t.Fatalf("non-director purpose %q changed its generation settings: %+v", purpose, cfg)
				}
			}
		})
	}
}

func TestGeminiDirectorPreservesOtherModelThinkingControls(t *testing.T) {
	for _, model := range []string{
		"gemini-2.5-pro", "models/gemini-2.5-pro", "gemini-2.5-pro-preview-06-05",
		"gemini-3-pro-preview", "models/gemini-3-flash-preview",
		"gemini-2.0-flash", "gemini-1.5-pro", "custom-model",
	} {
		t.Run(model, func(t *testing.T) {
			generic := geminiGenerationConfig(model, 200, PurposeGeneric)
			director := geminiGenerationConfig(model, 200, PurposeDirector)
			if !reflect.DeepEqual(generic, director) {
				t.Fatalf("director changed model-specific settings: generic=%+v director=%+v", generic, director)
			}
		})
	}
}

func TestGeminiGenerateSendsPurposeScopedThinkingSettings(t *testing.T) {
	for _, tc := range []struct {
		name       string
		model      string
		purpose    Purpose
		wantModel  string
		wantBudget int32
		wantMax    int32
	}{
		{name: "default director", purpose: PurposeDirector, wantModel: "gemini-2.5-flash", wantBudget: 512, wantMax: 712},
		{name: "default generic", purpose: PurposeGeneric, wantModel: "gemini-2.5-flash", wantBudget: 0, wantMax: 200},
		{name: "selected lite director", model: "models/gemini-2.5-flash-lite", purpose: PurposeDirector, wantModel: "gemini-2.5-flash-lite", wantBudget: 512, wantMax: 712},
		{name: "selected lite scoring", model: "gemini-2.5-flash-lite", purpose: PurposeScore, wantModel: "gemini-2.5-flash-lite", wantBudget: 0, wantMax: 200},
	} {
		t.Run(tc.name, func(t *testing.T) {
			type generationRequest struct {
				GenerationConfig struct {
					MaxOutputTokens int32 `json:"maxOutputTokens"`
					ThinkingConfig  struct {
						ThinkingBudget  *int32 `json:"thinkingBudget"`
						IncludeThoughts bool   `json:"includeThoughts"`
					} `json:"thinkingConfig"`
				} `json:"generationConfig"`
			}
			requests := make(chan generationRequest, 1)
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if !strings.HasSuffix(r.URL.Path, "/models/"+tc.wantModel+":generateContent") {
					t.Errorf("unexpected generation endpoint: %s", r.URL.Path)
				}
				var req generationRequest
				if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
					http.Error(w, "invalid JSON", http.StatusBadRequest)
					return
				}
				requests <- req
				w.Header().Set("Content-Type", "application/json")
				fmt.Fprint(w, `{"candidates":[{"content":{"role":"model","parts":[{"text":"Take your time."}]},"finishReason":"STOP"}]}`)
			}))
			defer server.Close()
			client, err := genai.NewClient(context.Background(), &genai.ClientConfig{
				APIKey: "test-key", Backend: genai.BackendGeminiAPI,
				HTTPOptions: genai.HTTPOptions{BaseURL: server.URL},
				HTTPClient:  server.Client(),
			})
			if err != nil {
				t.Fatal(err)
			}
			g := &Gemini{client: client, defaultModel: "gemini-2.5-flash"}
			out, err := g.Generate(context.Background(), GenerateRequest{
				Model: tc.model, Purpose: tc.purpose, MaxTokens: 200,
				Messages: []Message{{Role: "user", Text: "Let me think."}},
			})
			if err != nil {
				t.Fatal(err)
			}
			if out != "Take your time." {
				t.Fatalf("unexpected generated text: %q", out)
			}
			cfg := (<-requests).GenerationConfig
			if cfg.ThinkingConfig.ThinkingBudget == nil || *cfg.ThinkingConfig.ThinkingBudget != tc.wantBudget || cfg.MaxOutputTokens != tc.wantMax || cfg.ThinkingConfig.IncludeThoughts {
				t.Fatalf("SDK request did not preserve purpose settings: %+v", cfg)
			}
		})
	}
}
