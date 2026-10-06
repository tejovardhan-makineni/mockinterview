package llm

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"google.golang.org/genai"
)

// Gemini is the real Client backed by the google.golang.org/genai SDK
// (Gemini Developer API via GEMINI_API_KEY).
//
// Structured output is requested via responseMimeType=application/json plus the
// JSON schema embedded in the system instruction. We deliberately avoid the
// typed responseSchema builder so the client stays robust across SDK/model
// revisions — the caller always json.Unmarshal's the result anyway.
type Gemini struct {
	client       *genai.Client
	defaultModel string
}

func NewGemini(ctx context.Context, apiKey, defaultModel string) (*Gemini, error) {
	c, err := genai.NewClient(ctx, &genai.ClientConfig{
		APIKey:  apiKey,
		Backend: genai.BackendGeminiAPI,
	})
	if err != nil {
		return nil, fmt.Errorf("gemini client: %w", err)
	}
	if defaultModel == "" {
		defaultModel = "gemini-3.8-flash"
	}
	return &Gemini{client: c, defaultModel: defaultModel}, nil
}

func (g *Gemini) Stubbed() bool { return false }
func (g *Gemini) Info() Info    { return Info{Provider: "gemini", Model: g.defaultModel} }

func (g *Gemini) Generate(ctx context.Context, req GenerateRequest) (string, error) {
	model := req.Model
	if model == "" {
		model = g.defaultModel
	}

	contents := make([]*genai.Content, 0, len(req.Messages)+1)
	for _, m := range req.Messages {
		var role genai.Role = genai.RoleUser
		if m.Role == "model" {
			role = genai.RoleModel
		}
		contents = append(contents, genai.NewContentFromText(m.Text, role))
	}
	// Attach any images to a trailing user turn.
	if len(req.Images) > 0 {
		parts := make([]*genai.Part, 0, len(req.Images))
		for _, img := range req.Images {
			parts = append(parts, genai.NewPartFromBytes(img.Data, img.MIME))
		}
		contents = append(contents, genai.NewContentFromParts(parts, genai.RoleUser))
	}

	system := req.System
	if req.JSONSchema != nil {
		schemaJSON, _ := json.MarshalIndent(req.JSONSchema, "", "  ")
		system = strings.TrimSpace(system) + "\n\nReturn ONLY valid JSON conforming to this JSON schema. Do not wrap it in markdown fences:\n" + string(schemaJSON)
	}

	cfg := geminiGenerationConfig(model, req.MaxTokens, req.Purpose)
	if system != "" {
		cfg.SystemInstruction = genai.NewContentFromText(system, genai.RoleUser)
	}
	if req.Temperature > 0 {
		cfg.Temperature = genai.Ptr(req.Temperature)
	}
	if req.JSONSchema != nil {
		cfg.ResponseMIMEType = "application/json"
	}

	resp, err := g.client.Models.GenerateContent(ctx, model, contents, cfg)
	if err != nil {
		return "", fmt.Errorf("gemini generate: %w", err)
	}
	out := resp.Text()
	if strings.TrimSpace(out) == "" {
		return "", fmt.Errorf("gemini: model returned no text; choose a compatible text model")
	}
	if req.JSONSchema != nil {
		out = stripFences(out)
	}
	return out, nil
}

// Thinking controls differ across model families. In particular 2.5 Pro and
// Gemini 3 reject disabling thinking, so the free Flash setting cannot be
// applied to advanced personal-key selections.
func geminiGenerationConfig(model string, maxTokens int, purpose Purpose) *genai.GenerateContentConfig {
	config := &genai.GenerateContentConfig{}
	model = strings.TrimPrefix(model, "models/")
	switch {
	case strings.HasPrefix(model, "gemini-2.5-flash"):
		var thinkingBudget int32
		if purpose == PurposeDirector {
			// The interviewer must assess what the candidate already covered and
			// whether a follow-up is warranted. Reserve reasoning tokens without
			// consuming the caller's spoken-answer budget.
			thinkingBudget = 512
			if maxTokens > 0 {
				maxTokens += int(thinkingBudget)
			}
		}
		config.ThinkingConfig = &genai.ThinkingConfig{
			ThinkingBudget:  genai.Ptr(thinkingBudget),
			IncludeThoughts: false,
		}
	case strings.HasPrefix(model, "gemini-2.5-pro"):
		config.ThinkingConfig = &genai.ThinkingConfig{ThinkingBudget: genai.Ptr(int32(1024))}
		if maxTokens > 0 {
			maxTokens += 1024
		}
	case strings.HasPrefix(model, "gemini-3"):
		config.ThinkingConfig = &genai.ThinkingConfig{ThinkingLevel: genai.ThinkingLevelLow}
		if maxTokens > 0 {
			maxTokens = max(2048, maxTokens+1024)
		}
	}
	if maxTokens > 0 {
		config.MaxOutputTokens = int32(maxTokens)
	}
	return config
}

// stripFences removes accidental ```json ... ``` wrappers some responses include.
func stripFences(s string) string {
	s = strings.TrimSpace(s)
	if strings.HasPrefix(s, "```") {
		if i := strings.IndexByte(s, '\n'); i >= 0 {
			s = s[i+1:]
		}
		s = strings.TrimSuffix(strings.TrimSpace(s), "```")
	}
	return strings.TrimSpace(s)
}
