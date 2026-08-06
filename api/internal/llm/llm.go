// Package llm is the single seam between the app and Gemini. Everything that
// needs the LLM depends on the Client interface, never on the concrete Gemini
// SDK. This lets the whole product run against a deterministic Stub when no
// GEMINI_API_KEY is set (offline dev, tests, zero-cost UI work) and swap to the
// real Gemini client in production by changing one env var.
package llm

import "context"

// Purpose is a coarse hint about what a generation is for. The real client
// ignores it; the Stub uses it to return appropriately-shaped canned output so
// downstream code (scoring, resume parsing, the director) works end-to-end
// without a network call.
type Purpose string

const (
	PurposeGeneric      Purpose = "generic"
	PurposeResumeParse  Purpose = "resume_parse"
	PurposeResumeReview Purpose = "resume_review"
	PurposeScore        Purpose = "score"
	PurposeDirector     Purpose = "director"
	PurposeSummarize    Purpose = "summarize"
)

type Message struct {
	Role string // "user" | "model"
	Text string
}

// Image is inline binary media (e.g. a canvas PNG or a resume page) attached to
// a request for multimodal reasoning.
type Image struct {
	MIME string
	Data []byte
}

type GenerateRequest struct {
	Purpose     Purpose
	Model       string
	System      string
	Messages    []Message
	Images      []Image
	Temperature float32
	MaxTokens   int
	// JSONSchema, when non-nil, requests structured JSON output conforming to the
	// schema (Gemini responseSchema). The returned string is the raw JSON.
	JSONSchema map[string]any
}

type Client interface {
	Generate(ctx context.Context, req GenerateRequest) (string, error)
	// Stubbed reports whether this client is the offline stub (used to gate the
	// real Live relay vs the canned director).
	Stubbed() bool
	// Info reports the active provider + default model (for logging + reports).
	Info() Info
}

type Info struct {
	Provider string
	Model    string
	Stubbed  bool
}

// Provider identifies the reasoning/scoring backend. Voice (Live) is always
// Gemini and is configured separately.
type Provider string

const (
	ProviderGemini    Provider = "gemini"
	ProviderOpenAI    Provider = "openai"
	ProviderDeepSeek  Provider = "deepseek"
	ProviderAnthropic Provider = "anthropic"
	ProviderXAI       Provider = "xai"
	ProviderMeta      Provider = "meta"
)

// Settings fully describes how to construct a reasoning Client.
type Settings struct {
	Provider  Provider
	APIKey    string
	Model     string // default model when a request doesn't override it
	BaseURL   string // override for OpenAI-compatible endpoints (e.g. DeepSeek)
	ForceStub bool
}
