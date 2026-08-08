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
	"log/slog"
	"math"
	"net/http"
	"regexp"
	"sort"
	"strings"
	"unicode/utf8"

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

// parseSchema captures a structured, renderable resume — contact block,
// summary, experience/education/skills/projects — so the UI can lay it out as a
// real document (not a raw text dump). Modeled after OpenResume / Reactive
// Resume section schemas. The LLM must stay faithful to the source text.
var parseSchema = map[string]any{
	"type": "object",
	"properties": map[string]any{
		"name":             map[string]any{"type": "string"},
		"headline":         map[string]any{"type": "string", "description": "professional title, e.g. 'Senior Software Engineer'"},
		"years_experience": map[string]any{"type": "number"},
		"contact": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"location": map[string]any{"type": "string"},
				"email":    map[string]any{"type": "string"},
				"phone":    map[string]any{"type": "string"},
				"links":    map[string]any{"type": "array", "items": map[string]any{"type": "string"}, "description": "LinkedIn/GitHub/portfolio URLs verbatim"},
			},
		},
		"summary": map[string]any{"type": "string"},
		"experience": map[string]any{"type": "array", "items": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"company": map[string]any{"type": "string"},
				"role":    map[string]any{"type": "string"},
				"start":   map[string]any{"type": "string"},
				"end":     map[string]any{"type": "string", "description": "'Present' if current"},
				"bullets": map[string]any{"type": "array", "items": map[string]any{"type": "string"}, "description": "bullet lines verbatim from the resume"},
			},
		}},
		"education": map[string]any{"type": "array", "items": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"school": map[string]any{"type": "string"},
				"degree": map[string]any{"type": "string"},
				"dates":  map[string]any{"type": "string"},
			},
		}},
		"skills": map[string]any{"type": "array", "items": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"category": map[string]any{"type": "string", "description": "e.g. 'Languages'; empty if the resume lists skills flat"},
				"items":    map[string]any{"type": "array", "items": map[string]any{"type": "string"}},
			},
		}},
		"projects": map[string]any{"type": "array", "items": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"name":    map[string]any{"type": "string"},
				"summary": map[string]any{"type": "string"},
				"tech":    map[string]any{"type": "array", "items": map[string]any{"type": "string"}},
			},
		}},
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
		Purpose: llm.PurposeResumeParse,
		Model:   s.reasonModel,
		System: "You extract a resume into structured JSON so it can be re-rendered faithfully. " +
			"Copy bullet lines, titles, companies, dates, and contact details VERBATIM from the source. " +
			"Do NOT invent, embellish, or add facts that are not present. Leave a field empty if the resume does not state it. " +
			"IMPORTANT: the source text is machine-extracted from a PDF and may have LOST the spaces between words " +
			"(e.g. 'DevelopedanIngestionUtilitywebapplication'). Whenever you see run-together words like that, restore the " +
			"natural word spacing so the output reads normally — split them back into ordinary words. Only fix spacing/word " +
			"boundaries; never change, add, remove, or reorder the actual words. " +
			"Group skills by their category headings when the resume provides them; otherwise emit a single group with an empty category.",
		Messages:    []llm.Message{{Role: "user", Text: "Resume text:\n\n" + clip(text, 20000)}},
		JSONSchema:  parseSchema,
		Temperature: 0.1,
	})
	if err != nil {
		// GO-9/SEC-9: log the raw provider error server-side; return a generic
		// message so upstream detail never reaches the client.
		slog.Error("resume parse failed", "user", uid, "err", err)
		httpx.WriteProblem(w, http.StatusBadGateway, "resume parsing failed")
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
				"original": map[string]any{"type": "string", "description": "a phrase copied VERBATIM from the resume so it can be located"},
				"improved": map[string]any{"type": "string", "description": "a stronger, quantified rewrite of that phrase"},
			},
		}},
		"impact_suggestions": map[string]any{"type": "array", "items": map[string]any{"type": "string"}},
		"ats_notes":          map[string]any{"type": "string"},
		// Richer fields powering the analysis panel. Optional — older data omits them.
		"critical_fixes": map[string]any{"type": "array", "items": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"title":    map[string]any{"type": "string"},
				"location": map[string]any{"type": "string", "description": "where in the resume, e.g. 'Experience 1, bullet 2' or 'Summary'"},
				"detail":   map[string]any{"type": "string"},
			},
		}},
		"quantifiable_impacts": map[string]any{"type": "array", "items": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"text": map[string]any{"type": "string", "description": "the strong, quantified phrase (verbatim if it exists in the resume)"},
				"note": map[string]any{"type": "string", "description": "why it lands"},
			},
		}},
		"ats_breakdown": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"formatting":    map[string]any{"type": "string", "description": "pass | warn | fail"},
				"keyword_match": map[string]any{"type": "number", "description": "0..100"},
				"notes":         map[string]any{"type": "string"},
			},
		},
	},
}

// matchSchema powers Job Match: how well the stored resume fits a pasted JD.
// Inspired by Resume-Matcher (keyword overlap + semantic gap analysis + score).
var matchSchema = map[string]any{
	"type": "object",
	"properties": map[string]any{
		"match_score":      map[string]any{"type": "number", "description": "0..100 overall fit"},
		"verdict":          map[string]any{"type": "string", "description": "one-line verdict"},
		"matched_keywords": map[string]any{"type": "array", "items": map[string]any{"type": "string"}, "description": "JD skills/terms present in the resume, VERBATIM as they appear in the resume so they can be highlighted"},
		"missing_keywords": map[string]any{"type": "array", "items": map[string]any{"type": "string"}, "description": "important JD skills/terms absent from the resume"},
		"strengths":        map[string]any{"type": "array", "items": map[string]any{"type": "string"}},
		"gaps":             map[string]any{"type": "array", "items": map[string]any{"type": "string"}},
		"tailoring_suggestions": map[string]any{"type": "array", "items": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"issue":      map[string]any{"type": "string"},
				"detail":     map[string]any{"type": "string"},
				"suggestion": map[string]any{"type": "string"},
			},
		}},
		"ats_keyword_match": map[string]any{"type": "number", "description": "0..100 keyword coverage of the JD"},
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
			"specifically. Score 0..5 on overall strength. " +
			"EXTRACTION ARTIFACT: the resume text is machine-extracted from a PDF and often LOSES the spaces between words " +
			"(e.g. 'GraphsandLLMstotransform', run-together contact/education lines). This is a limitation of the extractor, " +
			"NOT a flaw in the candidate's actual resume. Read run-together words normally, and DO NOT list missing spaces, " +
			"run-together text, or poor word separation as a critical_fix, a gap, or an ATS/formatting problem. Whenever you " +
			"QUOTE resume text back to the user (line_edits `original`, quantifiable_impacts `text`), RESTORE natural word " +
			"spacing so it reads normally — keep the exact same words in the same order, changing only the spacing (the app " +
			"still locates the phrase after re-spacing). " +
			"For line_edits, `original` is the phrase you're improving (re-spaced as above) and `improved` is a concrete, stronger rewrite. Quantify (%, latency, $, scale, time saved) ONLY where the resume already states a real figure — NEVER fabricate numbers and NEVER insert placeholder tokens like '<X>%', '<N>', or '<number>' into the rewrite. If no real metric exists, strengthen the line through specific action verbs, scope, and outcome instead of leaving a blank metric. " +
			"For critical_fixes, give the most damaging CONTENT problems with a precise `location`. " +
			"For quantifiable_impacts, surface the resume's strongest already-quantified achievements. " +
			"For ats_breakdown, judge formatting as pass/warn/fail based on real structure (IGNORING the extraction spacing artifact) and estimate keyword_match 0..100.",
		Messages:    []llm.Message{{Role: "user", Text: "Resume text:\n\n" + clip(res.ParsedText, 20000)}},
		JSONSchema:  reviewSchema,
		Temperature: 0.4,
	})
	if err != nil {
		slog.Error("resume review failed", "user", uid, "err", err)
		httpx.WriteProblem(w, http.StatusBadGateway, "review failed")
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

// Match scores the stored resume against a pasted job description and returns
// matched/missing keywords + tailoring suggestions. The JD is used only for
// this analysis; it is not persisted or echoed back.
func (s *Service) Match(w http.ResponseWriter, r *http.Request) {
	uid := auth.UserID(r.Context())

	var body struct {
		JobDescription string `json:"job_description"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&body); err != nil {
		httpx.WriteProblem(w, http.StatusBadRequest, "invalid request body")
		return
	}
	jd := strings.TrimSpace(body.JobDescription)
	if jd == "" {
		httpx.WriteProblem(w, http.StatusBadRequest, "paste a job description")
		return
	}

	res, err := s.store.LatestResume(r.Context(), uid)
	if err != nil {
		httpx.WriteProblem(w, http.StatusBadRequest, "upload a resume first")
		return
	}

	out, err := s.llm.Generate(r.Context(), llm.GenerateRequest{
		Purpose: llm.PurposeResumeMatch,
		Model:   s.reasonModel,
		System: "You are an ATS and technical recruiter. Compare the candidate's resume to the job description. " +
			"NOTE: the resume text is machine-extracted from a PDF and may have LOST spaces between words — treat that as an extraction artifact, read through it, and never flag run-together text as a gap. " +
			"Do real keyword AND semantic gap analysis: match_score (0..100) reflects overall fit; matched_keywords are JD skills present in the resume (write each keyword with normal spacing so it can be highlighted); missing_keywords are important JD skills absent from the resume. " +
			"Give specific, actionable tailoring_suggestions. Do NOT invent resume content or claim skills the candidate does not have.",
		Messages: []llm.Message{{Role: "user", Text: "JOB DESCRIPTION:\n\n" + clip(jd, 8000) +
			"\n\n---\n\nCANDIDATE RESUME:\n\n" + clip(res.ParsedText, 20000)}},
		JSONSchema:  matchSchema,
		Temperature: 0.3,
	})
	if err != nil {
		slog.Error("resume match failed", "user", uid, "err", err)
		httpx.WriteProblem(w, http.StatusBadGateway, "match failed")
		return
	}
	result := json.RawMessage(out)
	if !json.Valid(result) {
		httpx.WriteProblem(w, http.StatusBadGateway, "match returned invalid data")
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
		// Prefer geometry-based extraction: it reinserts the word spaces that
		// pdf.GetPlainText drops (it ignores TJ kerning, so "Elastic APM" comes
		// out "ElasticAPM"). But on some fonts the geometry path itself comes out
		// run-together ("DevelopedanIngestion"); in that case fall back to
		// GetPlainText if IT happens to carry real space characters. Pick whichever
		// page text is actually spaced.
		geo := extractPageSpaced(p)
		plain, _ := p.GetPlainText(nil)
		if txt := pickReadable(geo, plain); strings.TrimSpace(txt) != "" {
			sb.WriteString(txt)
			sb.WriteString("\n")
		}
	}
	return sb.String()
}

var multiSpace = regexp.MustCompile(`[ \t]{2,}`)
var spacedNewline = regexp.MustCompile(` *\n *`)

// pickReadable chooses the better-spaced of the geometry and plain-text
// extractions for a page. It defaults to the geometry text (which normally
// recovers word spacing), but if the geometry text looks run-together — very few
// spaces relative to its length — and the plain text is meaningfully better
// spaced, it uses the plain text instead. This rescues resumes whose fonts defeat
// the geometry heuristic (words extracted with no gaps at all).
func pickReadable(geo, plain string) string {
	if strings.TrimSpace(geo) == "" {
		return plain
	}
	if strings.TrimSpace(plain) == "" {
		return geo
	}
	// spaceRatio = fraction of whitespace among non-newline characters. Normal
	// prose sits around 0.13–0.18; run-together text is near 0.
	spaceRatio := func(s string) float64 {
		var spaces, chars int
		for _, r := range s {
			if r == '\n' {
				continue
			}
			chars++
			if r == ' ' || r == '\t' {
				spaces++
			}
		}
		if chars == 0 {
			return 0
		}
		return float64(spaces) / float64(chars)
	}
	gr, pr := spaceRatio(geo), spaceRatio(plain)
	if gr < 0.06 && pr > gr {
		return plain
	}
	return geo
}

// extractPageSpaced rebuilds a page's text from per-glyph geometry. pdf.Content()
// gives each glyph a real X/width/font-size (computed from the text matrix and
// font metrics), so we can group glyphs into lines by baseline and insert a space
// wherever there's a visible horizontal gap between one glyph and the next —
// recovering word boundaries that the raw operator stream encodes only as spacing.
func extractPageSpaced(p pdf.Page) string {
	return spaceGlyphs(p.Content().Text)
}

// spaceGlyphs turns positioned glyphs into text with word spaces and line breaks
// reconstructed from geometry. Split out from extractPageSpaced so the spacing
// heuristic can be unit-tested without a real PDF.
func spaceGlyphs(chars []pdf.Text) string {
	if len(chars) == 0 {
		return ""
	}
	// Order glyphs top-to-bottom (Y increases upward), then left-to-right within
	// a line. A ~2pt Y tolerance keeps sub/superscripts on the same visual line.
	sort.SliceStable(chars, func(i, j int) bool {
		if math.Abs(chars[i].Y-chars[j].Y) > 2.0 {
			return chars[i].Y > chars[j].Y
		}
		return chars[i].X < chars[j].X
	})

	var sb strings.Builder
	lineY := chars[0].Y
	prevEnd := chars[0].X
	for i, t := range chars {
		switch {
		case i == 0:
			// first glyph — nothing to separate from
		case math.Abs(t.Y-lineY) > 2.0:
			sb.WriteByte('\n')
			lineY = t.Y
		default:
			// Same line: a gap wider than a fraction of the font size is a space.
			thresh := t.FontSize * 0.2
			if thresh <= 0 {
				thresh = 1.0
			}
			if t.X-prevEnd > thresh {
				sb.WriteByte(' ')
			}
		}
		sb.WriteString(t.S)
		prevEnd = t.X + t.W
	}

	out := multiSpace.ReplaceAllString(sb.String(), " ")
	out = spacedNewline.ReplaceAllString(out, "\n")
	return out
}

// clip truncates s to at most n bytes without splitting a UTF-8 rune, so
// non-ASCII resume/JD text isn't corrupted at the cut point.
func clip(s string, n int) string {
	if n <= 0 {
		return ""
	}
	if len(s) <= n {
		return s
	}
	for n > 0 && !utf8.RuneStart(s[n]) {
		n--
	}
	return s[:n]
}
