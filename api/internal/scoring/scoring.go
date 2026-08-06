// Package scoring turns a finished interview (transcript + workspace) into a
// corpus-driven rubric evaluation. The rubric dimensions come from the question
// itself, so the same engine scores a system-design, coding, or professional
// interview. With the LLM stub it produces deterministic scores derived from the
// rubric, so the whole flow is testable with no API key.
package scoring

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"strings"

	"github.com/tejo/mockinterview-api/internal/corpus"
	"github.com/tejo/mockinterview-api/internal/llm"
	"github.com/tejo/mockinterview-api/internal/store"
)

type DimScore struct {
	Dimension   string  `json:"dimension"`
	Score       float64 `json:"score"` // 0..4
	Weight      float64 `json:"weight"`
	Evidence    string  `json:"evidence"`
	Expected    string  `json:"expected"`
	Actual      string  `json:"actual"`
	CoveragePct int     `json:"coverage_pct"`
	// Assessed is false when the candidate gave too little on this dimension to
	// judge fairly — we mark it "not assessed" instead of inventing a score.
	Assessed bool `json:"assessed"`
}

type Result struct {
	Overall    float64    `json:"overall"`
	Scores     []DimScore `json:"scores"`
	Strengths  []string   `json:"strengths"`
	Gaps       []string   `json:"gaps"`
	CoachingMD string     `json:"coaching_md"`
	// Scored is false when there wasn't enough substance to score the interview
	// at all (e.g. the candidate barely engaged); Note explains why.
	Scored bool   `json:"scored"`
	Note   string `json:"note"`
}

type Engine struct {
	llm         llm.Client
	reasonModel string
}

func New(ai llm.Client, reasonModel string) *Engine {
	return &Engine{llm: ai, reasonModel: reasonModel}
}

// Evaluate scores a transcript (+ optional workspace text like code or a written
// answer) against the question's rubric and reference material.
func (e *Engine) Evaluate(ctx context.Context, q corpus.Question, transcript []store.Turn, workspace string) (Result, error) {
	// Don't fabricate a score when the candidate barely engaged. Count real
	// candidate words across the transcript + any workspace artifact.
	words := candidateWords(transcript) + len(strings.Fields(workspace))
	if words < 40 {
		return Result{
			Scored: false,
			Note:   "There wasn't enough here to score fairly. Give a fuller attempt next time — really engage with the question and talk through your reasoning out loud — and we'll score it.",
		}, nil
	}
	if e.llm.Stubbed() {
		return e.stubResult(q), nil
	}
	return e.llmResult(ctx, q, transcript, workspace)
}

func candidateWords(transcript []store.Turn) int {
	n := 0
	for _, t := range transcript {
		if t.Role == "candidate" {
			n += len(strings.Fields(t.Text))
		}
	}
	return n
}

func (e *Engine) llmResult(ctx context.Context, q corpus.Question, transcript []store.Turn, workspace string) (Result, error) {
	var conv strings.Builder
	for _, t := range transcript {
		conv.WriteString(strings.ToUpper(t.Role))
		conv.WriteString(": ")
		conv.WriteString(t.Text)
		conv.WriteString("\n")
	}

	rubricJSON, _ := json.MarshalIndent(q.Rubric, "", "  ")
	refJSON, _ := json.MarshalIndent(q.Reference, "", "  ")

	system := fmt.Sprintf(`You are a rigorous, fair interview evaluator for a %s interview (%s).
Score the candidate's performance against THIS interview's RUBRIC (the dimensions below are specific to this
interview type — only judge these) using the REFERENCE ideal-answer material.
For EACH rubric dimension return: a score 0.0-4.0 (0 absent, 2 adequate, 3 strong, 4 exceptional), concrete
evidence quoted/paraphrased from the transcript, what was EXPECTED, what the candidate ACTUALLY did, and a
coverage_pct (0-100). Use the dimension "key" values verbatim as "dimension".
CRITICAL: If the candidate did NOT address a dimension at all, or said too little to judge it fairly, set
"assessed": false and "score": 0 — do NOT invent or infer a score from nothing. Set "assessed": true only when
there is real evidence. Be specific and honest; never inflate.`,
		q.Domain, q.Modality)

	user := fmt.Sprintf("QUESTION: %s\n\nPROMPT: %s\n\nRUBRIC:\n%s\n\nREFERENCE (ideal answer material):\n%s\n\nWORKSPACE ARTIFACT (code/written answer, may be empty):\n%s\n\nINTERVIEW TRANSCRIPT:\n%s",
		q.Title, q.Prompt, rubricJSON, clip(string(refJSON), 12000), clip(workspace, 8000), clip(conv.String(), 16000))

	out, err := e.llm.Generate(ctx, llm.GenerateRequest{
		Purpose:     llm.PurposeScore,
		Model:       e.reasonModel,
		System:      system,
		Messages:    []llm.Message{{Role: "user", Text: user}},
		JSONSchema:  scoreSchema,
		Temperature: 0.2,
		MaxTokens:   8000,
	})
	if err != nil {
		return Result{}, err
	}
	var r Result
	if err := json.Unmarshal([]byte(out), &r); err != nil {
		return Result{}, fmt.Errorf("parse score json: %w", err)
	}
	r.Scored = true
	e.applyWeightsAndOverall(q, &r)
	return r, nil
}

// stubResult deterministically derives scores from the rubric so the pipeline
// works offline and tests are stable.
func (e *Engine) stubResult(q corpus.Question) Result {
	r := Result{Scored: true}
	for i, d := range q.Rubric {
		score := 2.0 + 0.5*float64((i%5)-2) // 1.0 .. 3.0, deterministic
		if score < 0 {
			score = 0
		}
		r.Scores = append(r.Scores, DimScore{
			Dimension:   d.Key,
			Score:       score,
			Weight:      d.Weight,
			Evidence:    "Stub evaluation based on rubric dimension.",
			Expected:    d.Description,
			Actual:      fmt.Sprintf("Candidate partially addressed %q.", d.Label),
			CoveragePct: 40 + (i%4)*15,
			Assessed:    true,
		})
	}
	r.Strengths = []string{"Clear structure early on", "Reasonable core design"}
	r.Gaps = []string{"Thin quantitative depth", "Limited failure-mode discussion"}
	r.CoachingMD = "## Coaching (stub)\n\n- Lead with crisp requirements + estimation.\n- When you introduce a datastore, proactively cover replication, CDC, and hot spots.\n- Name failure modes before you're asked.\n"
	e.applyWeightsAndOverall(q, &r)
	return r
}

// applyWeightsAndOverall backfills weights from the rubric (LLM may omit them)
// and computes the weighted overall on a 0..4 scale.
func (e *Engine) applyWeightsAndOverall(q corpus.Question, r *Result) {
	weightByKey := map[string]float64{}
	for _, d := range q.Rubric {
		weightByKey[d.Key] = d.Weight
	}
	var sum, wsum float64
	assessedCount := 0
	for i := range r.Scores {
		w := r.Scores[i].Weight
		if w <= 0 {
			w = weightByKey[r.Scores[i].Dimension]
		}
		if w <= 0 {
			w = 1
		}
		r.Scores[i].Weight = w
		s := r.Scores[i].Score
		if s < 0 {
			s = 0
		}
		if s > 4 {
			s = 4
		}
		r.Scores[i].Score = s
		// Only assessed dimensions contribute to the overall.
		if r.Scores[i].Assessed {
			assessedCount++
			sum += s * w
			wsum += w
		}
	}
	if wsum > 0 {
		r.Overall = math.Round((sum/wsum)*100) / 100
	}
	// If the model assessed nothing, treat the interview as not scored.
	if assessedCount == 0 {
		r.Scored = false
		if r.Note == "" {
			r.Note = "There wasn't enough substance in the answers to assess any dimension."
		}
	}
}

// ReportStore is the slice of persistence Persist needs. *store.Store and the
// interview package's Repo both satisfy it.
type ReportStore interface {
	SaveScores(ctx context.Context, sessionID string, rows []store.ScoreRow) error
	SaveReport(ctx context.Context, sessionID string, overall float64, radar, timeline, behavioral json.RawMessage, coachingMD string, scored bool, note string) error
}

// Persist saves scores + an assembled report row. behavioral is the behavioral
// summary JSON (may be "{}") produced by the behavior package.
func (e *Engine) Persist(ctx context.Context, st ReportStore, sessionID string, r Result, behavioral json.RawMessage) error {
	rows := make([]store.ScoreRow, 0, len(r.Scores))
	radar := make([]map[string]any, 0, len(r.Scores))
	for _, s := range r.Scores {
		rows = append(rows, store.ScoreRow{
			Dimension: s.Dimension, Phase: "overall", Score: s.Score, Weight: s.Weight,
			Evidence: s.Evidence, Expected: s.Expected, Actual: s.Actual, CoveragePct: s.CoveragePct, Assessed: s.Assessed,
		})
		if s.Assessed {
			radar = append(radar, map[string]any{"dimension": s.Dimension, "score": s.Score, "coverage": s.CoveragePct})
		}
	}
	if err := st.SaveScores(ctx, sessionID, rows); err != nil {
		return err
	}
	radarJSON, _ := json.Marshal(map[string]any{"dims": radar, "strengths": r.Strengths, "gaps": r.Gaps})
	timelineJSON, _ := json.Marshal([]any{})
	if len(behavioral) == 0 {
		behavioral = json.RawMessage(`{}`)
	}
	return st.SaveReport(ctx, sessionID, r.Overall, radarJSON, timelineJSON, behavioral, r.CoachingMD, r.Scored, r.Note)
}

var scoreSchema = map[string]any{
	"type": "object",
	"properties": map[string]any{
		"scores": map[string]any{"type": "array", "items": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"dimension":    map[string]any{"type": "string"},
				"score":        map[string]any{"type": "number"},
				"assessed":     map[string]any{"type": "boolean", "description": "true only if there was real evidence to judge this dimension"},
				"evidence":     map[string]any{"type": "string"},
				"expected":     map[string]any{"type": "string"},
				"actual":       map[string]any{"type": "string"},
				"coverage_pct": map[string]any{"type": "integer"},
			},
			"required": []string{"dimension", "score", "assessed"},
		}},
		"strengths":   map[string]any{"type": "array", "items": map[string]any{"type": "string"}},
		"gaps":        map[string]any{"type": "array", "items": map[string]any{"type": "string"}},
		"coaching_md": map[string]any{"type": "string"},
	},
	"required": []string{"scores"},
}

func clip(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}
