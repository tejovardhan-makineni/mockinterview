// Package i18n translates the app's OWN English UI strings into a target
// language on demand, via the LLM, with a persistent-for-the-process cache so
// each (language, string) pair is translated at most once. It deliberately does
// NOT translate user content (resumes, transcripts, job descriptions) — only the
// app-owned copy the frontend sends it. The frontend caches results too, so the
// steady state makes no calls at all.
package i18n

import (
	"context"
	"encoding/json"
	"net/http"
	"sync"

	"github.com/tejo/mockinterview-api/internal/httpx"
	"github.com/tejo/mockinterview-api/internal/llm"
	"github.com/tejo/mockinterview-api/internal/persona"
)

type Service struct {
	llm   llm.Client
	model string

	mu    sync.Mutex
	cache map[string]string // key: lang + "\x00" + source -> translation
}

func New(client llm.Client, model string) *Service {
	return &Service{llm: client, model: model, cache: map[string]string{}}
}

type translateReq struct {
	Lang  string   `json:"lang"`
	Texts []string `json:"texts"`
}

// Translate returns a map of source-string -> translation for the requested
// language. English (the source language) is echoed back unchanged. Anything
// already cached is served without an LLM call; only the uncached remainder is
// sent to the model in one batch.
func (s *Service) Translate(w http.ResponseWriter, r *http.Request) {
	var req translateReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpx.WriteProblem(w, http.StatusBadRequest, "invalid request")
		return
	}
	lang := persona.NormalizeLanguage(req.Lang)
	out := make(map[string]string, len(req.Texts))

	// Source language (or unknown) → identity; nothing to translate.
	if lang == persona.DefaultLanguageCode() {
		for _, t := range req.Texts {
			out[t] = t
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"translations": out})
		return
	}

	// Partition into cached vs. missing (dedup missing).
	var missing []string
	seen := map[string]bool{}
	s.mu.Lock()
	for _, t := range req.Texts {
		if t == "" {
			out[t] = t
			continue
		}
		if v, ok := s.cache[lang+"\x00"+t]; ok {
			out[t] = v
		} else if !seen[t] {
			seen[t] = true
			missing = append(missing, t)
		}
	}
	s.mu.Unlock()

	if len(missing) > 0 {
		translated, err := s.translateBatch(r.Context(), lang, missing)
		if err != nil {
			// Degrade gracefully: return English for the untranslated ones so the
			// UI still renders (just not localized) instead of erroring.
			for _, t := range missing {
				if _, ok := out[t]; !ok {
					out[t] = t
				}
			}
		} else {
			s.mu.Lock()
			for i, src := range missing {
				tr := src
				if i < len(translated) && translated[i] != "" {
					tr = translated[i]
				}
				s.cache[lang+"\x00"+src] = tr
				out[src] = tr
			}
			s.mu.Unlock()
		}
	}

	httpx.WriteJSON(w, http.StatusOK, map[string]any{"translations": out})
}

// translateBatch asks the LLM to translate a list of UI strings, returning them
// in the same order. It requests structured JSON so parsing is reliable.
func (s *Service) translateBatch(ctx context.Context, lang string, texts []string) ([]string, error) {
	name := persona.LanguageName(lang)
	system := "You are a professional software UI localizer. Translate each user-interface string from English into " + name + ".\n" +
		"Rules:\n" +
		"- Preserve meaning and keep it concise and natural for a UI.\n" +
		"- Keep placeholders EXACTLY as-is: things like {name}, {count}, %d, %s, or text inside curly braces or angle brackets.\n" +
		"- Do NOT translate brand/product names (e.g. mockinterview.live), or code/identifiers.\n" +
		"- Keep any leading/trailing punctuation, emoji, and arrows (→, ←, •) as they are.\n" +
		"- Return ONLY the translations, in the SAME ORDER as the input."
	payload, _ := json.Marshal(map[string]any{"strings": texts})
	schema := map[string]any{
		"type": "object",
		"properties": map[string]any{
			"translations": map[string]any{"type": "array", "items": map[string]any{"type": "string"}},
		},
		"required": []string{"translations"},
	}
	raw, err := s.llm.Generate(ctx, llm.GenerateRequest{
		Purpose:     llm.PurposeGeneric,
		Model:       s.model,
		System:      system,
		Messages:    []llm.Message{{Role: "user", Text: "Translate these UI strings to " + name + ":\n" + string(payload)}},
		Temperature: 0,
		JSONSchema:  schema,
	})
	if err != nil {
		return nil, err
	}
	var parsed struct {
		Translations []string `json:"translations"`
	}
	if err := json.Unmarshal([]byte(raw), &parsed); err != nil {
		return nil, err
	}
	return parsed.Translations, nil
}

// ListLanguages serves the offered language catalog to the client.
func (s *Service) ListLanguages(w http.ResponseWriter, _ *http.Request) {
	httpx.WriteJSON(w, http.StatusOK, persona.Languages)
}
