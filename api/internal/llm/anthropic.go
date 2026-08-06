package llm

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// Anthropic is a Client backed by the Claude Messages API. System prompt is a
// top-level field; images are base64 image blocks. Structured output uses the
// schema-in-prompt convention (the caller json.Unmarshal's the result).
type Anthropic struct {
	apiKey       string
	defaultModel string
	http         *http.Client
}

func NewAnthropic(apiKey, defaultModel string) *Anthropic {
	if defaultModel == "" {
		defaultModel = "claude-sonnet-5"
	}
	return &Anthropic{apiKey: apiKey, defaultModel: defaultModel, http: &http.Client{Timeout: 120 * time.Second}}
}

func (a *Anthropic) Stubbed() bool { return false }
func (a *Anthropic) Info() Info    { return Info{Provider: "anthropic", Model: a.defaultModel} }

func (a *Anthropic) Generate(ctx context.Context, req GenerateRequest) (string, error) {
	model := req.Model
	if model == "" {
		model = a.defaultModel
	}
	maxTokens := req.MaxTokens
	if maxTokens <= 0 {
		maxTokens = 4096
	}

	msgs := make([]map[string]any, 0, len(req.Messages)+1)
	for _, m := range req.Messages {
		role := "user"
		if m.Role == "model" {
			role = "assistant"
		}
		msgs = append(msgs, map[string]any{"role": role, "content": m.Text})
	}
	if len(req.Images) > 0 {
		content := []map[string]any{{"type": "text", "text": "(attached image)"}}
		for _, img := range req.Images {
			content = append(content, map[string]any{
				"type":   "image",
				"source": map[string]string{"type": "base64", "media_type": img.MIME, "data": base64.StdEncoding.EncodeToString(img.Data)},
			})
		}
		msgs = append(msgs, map[string]any{"role": "user", "content": content})
	}
	if len(msgs) == 0 {
		msgs = append(msgs, map[string]any{"role": "user", "content": "Begin."})
	}

	system := req.System
	if req.JSONSchema != nil {
		system = embedSchema(system, req.JSONSchema)
	}

	body := map[string]any{"model": model, "max_tokens": maxTokens, "messages": msgs}
	if system != "" {
		body["system"] = system
	}
	if req.Temperature > 0 {
		body["temperature"] = req.Temperature
	}

	raw, _ := json.Marshal(body)
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.anthropic.com/v1/messages", bytes.NewReader(raw))
	if err != nil {
		return "", err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("x-api-key", a.apiKey)
	httpReq.Header.Set("anthropic-version", "2023-06-01")

	resp, err := a.http.Do(httpReq)
	if err != nil {
		return "", fmt.Errorf("anthropic request: %w", err)
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 300 {
		return "", fmt.Errorf("anthropic http %d: %s", resp.StatusCode, truncate(string(data), 300))
	}
	var out struct {
		Content []struct {
			Type string `json:"type"`
			Text string `json:"text"`
		} `json:"content"`
	}
	if err := json.Unmarshal(data, &out); err != nil {
		return "", fmt.Errorf("anthropic decode: %w", err)
	}
	var sb bytes.Buffer
	for _, c := range out.Content {
		if c.Type == "text" {
			sb.WriteString(c.Text)
		}
	}
	text := sb.String()
	if req.JSONSchema != nil {
		text = stripFences(text)
	}
	return text, nil
}
