// Package resume handles resume upload + LLM structured parsing, and the
// standalone resume-review feature. Text is extracted server-side (PDF or plain
// text) so parsing/review works with any LLM provider.
package resume

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"html"
	"io"
	"net/http"
	"regexp"
	"strings"

	"github.com/ledongthuc/pdf"

	"github.com/tejo/mockinterview-api/internal/auth"
	"github.com/tejo/mockinterview-api/internal/httpx"
	"github.com/tejo/mockinterview-api/internal/llm"
	"github.com/tejo/mockinterview-api/internal/store"
)

const maxUpload = 6 << 20  // 6 MB — the uploaded file
const maxDocXML = 20 << 20 // 20 MB — the decompressed DOCX document.xml (bomb guard)

// Repo is the persistence resume review needs. *store.Store satisfies it; tests
// supply a fake.
type Repo interface {
	SaveResume(ctx context.Context, userID, filename, parsedText string, parsedJSON json.RawMessage) (store.Resume, error)
	LatestResume(ctx context.Context, userID string) (store.Resume, error)
	SaveResumeReview(ctx context.Context, userID, resumeID, provider, model string, result json.RawMessage) (string, error)
}

type Service struct {
	store       Repo
	llm         llm.Client
	reasonModel string
}

func New(st Repo, ai llm.Client, reasonModel string) *Service {
	return &Service{store: st, llm: ai, reasonModel: reasonModel}
}

var parseSchema = map[string]any{
	"type": "object",
	"properties": map[string]any{
		"name":             map[string]any{"type": "string"},
		"headline":         map[string]any{"type": "string"},
		"years_experience": map[string]any{"type": "number"},
		"skills":           map[string]any{"type": "array", "items": map[string]any{"type": "string"}},
		"projects": map[string]any{"type": "array", "items": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"name":    map[string]any{"type": "string"},
				"summary": map[string]any{"type": "string"},
				"tech":    map[string]any{"type": "array", "items": map[string]any{"type": "string"}},
			},
		}},
		"summary": map[string]any{"type": "string"},
	},
}

// Upload accepts a multipart file, extracts text, LLM-parses it to structured
// JSON, and stores it.
func (s *Service) Upload(w http.ResponseWriter, r *http.Request) {
	uid := auth.UserID(r.Context())
	if err := r.ParseMultipartForm(maxUpload); err != nil {
		httpx.WriteProblem(w, http.StatusBadRequest, "file too large or malformed")
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		httpx.WriteProblem(w, http.StatusBadRequest, "missing file field")
		return
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, maxUpload))
	if err != nil {
		httpx.WriteProblem(w, http.StatusInternalServerError, "read failed")
		return
	}

	text := extractText(header.Filename, data)
	if strings.TrimSpace(text) == "" {
		httpx.WriteProblem(w, http.StatusBadRequest, "could not extract text from file (use PDF, DOCX, or .txt/.md)")
		return
	}

	parsed, err := s.llm.Generate(r.Context(), llm.GenerateRequest{
		Purpose:     llm.PurposeResumeParse,
		Model:       s.reasonModel,
		System:      "You extract structured data from a resume. Be faithful to the text; do not invent facts.",
		Messages:    []llm.Message{{Role: "user", Text: "Resume text:\n\n" + clip(text, 20000)}},
		JSONSchema:  parseSchema,
		Temperature: 0.1,
	})
	if err != nil {
		httpx.WriteProblem(w, http.StatusBadGateway, "resume parsing failed: "+err.Error())
		return
	}
	parsedJSON := json.RawMessage(parsed)
	if !json.Valid(parsedJSON) {
		parsedJSON = json.RawMessage(`{}`)
	}

	res, err := s.store.SaveResume(r.Context(), uid, header.Filename, text, parsedJSON)
	if err != nil {
		httpx.WriteProblem(w, http.StatusInternalServerError, "save failed")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"id": res.ID, "filename": res.Filename, "parsed": parsedJSON, "text": text})
}

func (s *Service) Get(w http.ResponseWriter, r *http.Request) {
	uid := auth.UserID(r.Context())
	res, err := s.store.LatestResume(r.Context(), uid)
	if err != nil {
		httpx.WriteProblem(w, http.StatusNotFound, "no resume uploaded")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"id": res.ID, "filename": res.Filename, "parsed": res.ParsedJSON, "text": res.ParsedText})
}

var reviewSchema = map[string]any{
	"type": "object",
	"properties": map[string]any{
		"overall_score": map[string]any{"type": "number", "description": "0..5"},
		"summary":       map[string]any{"type": "string"},
		"strengths":     map[string]any{"type": "array", "items": map[string]any{"type": "string"}},
		"gaps":          map[string]any{"type": "array", "items": map[string]any{"type": "string"}},
		"line_edits": map[string]any{"type": "array", "items": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"original": map[string]any{"type": "string"},
				"improved": map[string]any{"type": "string"},
			},
		}},
		"impact_suggestions": map[string]any{"type": "array", "items": map[string]any{"type": "string"}},
		"ats_notes":          map[string]any{"type": "string"},
	},
}

// Review runs an LLM critique over the stored resume and returns actionable feedback.
func (s *Service) Review(w http.ResponseWriter, r *http.Request) {
	uid := auth.UserID(r.Context())
	res, err := s.store.LatestResume(r.Context(), uid)
	if err != nil {
		httpx.WriteProblem(w, http.StatusBadRequest, "upload a resume first")
		return
	}
	out, err := s.llm.Generate(r.Context(), llm.GenerateRequest{
		Purpose: llm.PurposeResumeReview,
		Model:   s.reasonModel,
		System: "You are a senior engineering hiring manager and resume coach. Critique the resume honestly and " +
			"specifically. Prefer concrete, quantified line rewrites. Score 0..5 on overall strength.",
		Messages:    []llm.Message{{Role: "user", Text: "Resume text:\n\n" + clip(res.ParsedText, 20000)}},
		JSONSchema:  reviewSchema,
		Temperature: 0.4,
	})
	if err != nil {
		httpx.WriteProblem(w, http.StatusBadGateway, "review failed: "+err.Error())
		return
	}
	result := json.RawMessage(out)
	if !json.Valid(result) {
		httpx.WriteProblem(w, http.StatusBadGateway, "review returned invalid data")
		return
	}
	info := s.llm.Info()
	_, _ = s.store.SaveResumeReview(r.Context(), uid, res.ID, info.Provider, info.Model, result)
	httpx.WriteJSON(w, http.StatusOK, result)
}

// ---- helpers ----

func extractText(filename string, data []byte) string {
	lower := strings.ToLower(filename)
	if strings.HasSuffix(lower, ".pdf") || bytes.HasPrefix(data, []byte("%PDF")) {
		if t := extractPDF(data); strings.TrimSpace(t) != "" {
			return t
		}
	}
	// .docx (and .zip-backed office formats) start with the PK zip magic.
	if strings.HasSuffix(lower, ".docx") || bytes.HasPrefix(data, []byte("PK\x03\x04")) {
		if t := extractDocx(data); strings.TrimSpace(t) != "" {
			return t
		}
	}
	// Fall back to treating it as UTF-8 text.
	return string(data)
}

var tagRe = regexp.MustCompile(`<[^>]+>`)

// extractDocx pulls readable text out of a .docx (Office Open XML): the document
// body lives in word/document.xml as <w:t> runs inside <w:p> paragraphs.
func extractDocx(data []byte) string {
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return ""
	}
	for _, f := range zr.File {
		if f.Name != "word/document.xml" {
			continue
		}
		// Guard against a decompression bomb: the 6 MB upload cap bounds the
		// COMPRESSED zip, but document.xml can inflate far beyond that.
		if f.UncompressedSize64 > maxDocXML {
			return ""
		}
		rc, err := f.Open()
		if err != nil {
			return ""
		}
		raw, _ := io.ReadAll(io.LimitReader(rc, maxDocXML))
		_ = rc.Close()
		xml := string(raw)
		xml = strings.ReplaceAll(xml, "</w:p>", "\n")
		xml = strings.ReplaceAll(xml, "<w:tab/>", "\t")
		xml = strings.ReplaceAll(xml, "<w:br/>", "\n")
		return html.UnescapeString(tagRe.ReplaceAllString(xml, ""))
	}
	return ""
}

func extractPDF(data []byte) string {
	defer func() { _ = recover() }() // ledongthuc/pdf can panic on malformed PDFs
	rd, err := pdf.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return ""
	}
	var sb strings.Builder
	n := rd.NumPage()
	for i := 1; i <= n; i++ {
		p := rd.Page(i)
		if p.V.IsNull() {
			continue
		}
		if txt, err := p.GetPlainText(nil); err == nil {
			sb.WriteString(txt)
			sb.WriteString("\n")
		}
	}
	return sb.String()
}

func clip(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}
