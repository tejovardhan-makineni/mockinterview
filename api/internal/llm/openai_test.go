package llm

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestOpenAIReasoningModelAndCompatibleProviderRequests(t *testing.T) {
	for _, tc := range []struct {
		provider, model, budget string
		reasoning               bool
	}{
		{"openai", "gpt-5.4", "max_completion_tokens", true},
		{"openai", "o3-mini", "max_completion_tokens", true},
		{"openai", "gpt-4o-mini", "max_completion_tokens", false},
		{"deepseek", "deepseek-chat", "max_tokens", false},
	} {
		t.Run(tc.model, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var body map[string]any
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					t.Error(err)
				}
				if r.URL.Path != "/chat/completions" || r.Header.Get("Authorization") != "Bearer test-key" {
					t.Error("incorrect endpoint or credentials")
				}
				if body[tc.budget] == nil {
					t.Errorf("missing completion budget: %+v", body)
				}
				if tc.reasoning && (body["temperature"] != nil || body[tc.budget].(float64) < 1024) {
					t.Errorf("reasoning model has unsupported settings: %+v", body)
				}
				if tc.budget == "max_completion_tokens" && body["max_tokens"] != nil {
					t.Error("legacy token parameter sent to OpenAI")
				}
				fmt.Fprint(w, `{"choices":[{"message":{"content":"OK"}}]}`)
			}))
			defer server.Close()
			client := NewOpenAI("test-key", tc.model, server.URL, tc.provider, tc.model)
			result, err := client.Generate(context.Background(), GenerateRequest{Messages: []Message{{Role: "user", Text: "Reply with OK."}}, MaxTokens: 32, Temperature: .7})
			if err != nil || result != "OK" {
				t.Fatalf("result=%q error=%v", result, err)
			}
		})
	}
}

func TestOpenAIRejectsEmptyModelResponse(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, `{"choices":[{"message":{"content":""}}]}`)
	}))
	defer server.Close()
	client := NewOpenAI("test-key", "gpt-5.4", server.URL, "openai", "gpt-5.4")
	if _, err := client.Generate(context.Background(), GenerateRequest{MaxTokens: 32}); err == nil {
		t.Fatal("empty model output was accepted")
	}
}
