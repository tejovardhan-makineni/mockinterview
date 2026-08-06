package llm

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// OpenAI is a Client for any OpenAI-compatible Chat Completions endpoint. The
// same implementation serves OpenAI and DeepSeek (which is wire-compatible) via
// a different base URL. Structured output uses response_format json_object plus
// the schema embedded in the system prompt for robustness.
type OpenAI struct {
	apiKey       string
	defaultModel string
	baseURL      string
	provider     string
	http         *http.Client
}

// NewOpenAI builds a client for an OpenAI-compatible endpoint. provider and
// fallbackModel are passed explicitly by the composition root (which knows the
// selected provider) rather than inferred from the base URL — so a custom/proxy
// base URL for a self-hosted endpoint is identified correctly.
func NewOpenAI(apiKey, model, baseURL, provider, fallbackModel string) *OpenAI {
	if model == "" {
		model = fallbackModel
	}
	return &OpenAI{
		apiKey:       apiKey,
		defaultModel: model,
		baseURL:      strings.TrimRight(baseURL, "/"),
		provider:     provider,
		http:         &http.Client{Timeout: 120 * time.Second},
	}
}

func (o *OpenAI) Stubbed() bool { return false }
func (o *OpenAI) Info() Info    { return Info{Provider: o.provider, Model: o.defaultModel} }

func (o *OpenAI) Generate(ctx context.Context, req GenerateRequest) (string, error) {
	model := req.Model
	if model == "" {
		model = o.defaultModel
	}

	msgs := make([]map[string]any, 0, len(req.Messages)+1)
	system := req.System
	if req.JSONSchema != nil {
		system = embedSchema(system, req.JSONSchema)
	}
	if system != "" {
		msgs = append(msgs, map[string]any{"role": "system", "content": system})
	}
	for _, m := range req.Messages {
		role := "user"
		if m.Role == "model" {
			role = "assistant"
		}
		msgs = append(msgs, map[string]any{"role": role, "content": m.Text})
	}
	// Attach images to a trailing user turn using the multimodal content array.
	if len(req.Images) > 0 {
		parts := []map[string]any{{"type": "text", "text": "(attached image)"}}
		for _, img := range req.Images {
			uri := "data:" + img.MIME + ";base64," + base64.StdEncoding.EncodeToString(img.Data)
			parts = append(parts, map[string]any{"type": "image_url", "image_url": map[string]string{"url": uri}})
		}
		msgs = append(msgs, map[string]any{"role": "user", "content": parts})
	}

	body := map[string]any{"model": model, "messages": msgs}
	if req.Temperature > 0 {
		body["temperature"] = req.Temperature
	}
	maxTok := req.MaxTokens
	// Meta muse-spark is a reasoning model: it spends ~200 tokens thinking before
	// any content, so a small cap yields an empty completion. Give it headroom.
	if o.provider == "meta" && maxTok > 0 && maxTok < 2048 {
		maxTok = 2048
	}
	if maxTok > 0 {
		body["max_tokens"] = maxTok
	}
	if req.JSONSchema != nil {
		body["response_format"] = map[string]string{"type": "json_object"}
	}

	raw, _ := json.Marshal(body)
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, o.baseURL+"/chat/completions", bytes.NewReader(raw))
	if err != nil {
		return "", err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+o.apiKey)

	resp, err := o.http.Do(httpReq)
	if err != nil {
		return "", fmt.Errorf("%s request: %w", o.provider, err)
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 300 {
		return "", fmt.Errorf("%s http %d: %s", o.provider, resp.StatusCode, truncate(string(data), 300))
	}
	var out struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(data, &out); err != nil {
		return "", fmt.Errorf("%s decode: %w", o.provider, err)
	}
	if len(out.Choices) == 0 {
		return "", fmt.Errorf("%s: empty response", o.provider)
	}
	text := out.Choices[0].Message.Content
	if req.JSONSchema != nil {
		text = stripFences(text)
	}
	return text, nil
}

func embedSchema(system string, schema map[string]any) string {
	b, _ := json.MarshalIndent(schema, "", "  ")
	return strings.TrimSpace(system) + "\n\nReturn ONLY valid JSON conforming to this JSON schema (no markdown fences):\n" + string(b)
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
