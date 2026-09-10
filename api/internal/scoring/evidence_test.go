package scoring

import (
	"context"
	"encoding/json"
	"github.com/tejo/mockinterview-api/internal/llm"
	"github.com/tejo/mockinterview-api/internal/store"
	"strings"
	"testing"
)

type captureModel struct {
	response string
	request  llm.GenerateRequest
	calls    int
}

func (m *captureModel) Generate(_ context.Context, r llm.GenerateRequest) (string, error) {
	m.request = r
	m.calls++
	return m.response, nil
}
func (m *captureModel) Stubbed() bool  { return false }
func (m *captureModel) Info() llm.Info { return llm.Info{Provider: "test"} }

func TestScoringIncludesLateCorrectionsAndCanonicalWeights(t *testing.T) {
	model := &captureModel{response: `{"scores":[{"dimension":"requirements","score":4,"weight":1000,"assessed":true,"coverage_pct":75,"evidence_refs":[{"source_id":"late","quote":"I corrected the scope"}]}]}`}
	turns := []store.Turn{{ID: "early", Role: "candidate", Text: strings.Repeat("Earlier reasoning. ", 1800)}, {ID: "late", Role: "candidate", Text: "I corrected the scope after checking the actual customer requirement."}}
	r, err := New(model, "").Evaluate(context.Background(), sampleQuestion(), turns, "")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(model.request.Messages[0].Text, "I corrected the scope") {
		t.Fatal("late evidence truncated")
	}
	if len(r.Scores) != 2 || r.Scores[0].Weight != 1 || r.Scores[1].Assessed || r.Overall != 4 {
		t.Fatalf("unexpected normalized scores: %+v", r)
	}
	if !strings.Contains(r.Scores[0].Evidence, "[late]") {
		t.Fatal("evidence ID lost")
	}
	if len(r.LearningDrills) == 0 {
		t.Fatal("no offline learning exercises")
	}
}

func TestRejectInventedEvidenceAndDimension(t *testing.T) {
	cases := []string{
		`{"scores":[{"dimension":"requirements","score":4,"assessed":true,"evidence_refs":[{"source_id":"t","quote":"not actually said"}]}]}`,
		`{"scores":[{"dimension":"appearance","score":4,"assessed":false}]}`,
		`{"scores":[{"dimension":"requirements","score":2},{"dimension":"requirements","score":3}]}`,
		`{"scores":[{"dimension":"requirements","score":5}]}`,
		`{"scores":[{"dimension":"requirements","score":4,"assessed":true}]}`,
	}
	for _, response := range cases {
		m := &captureModel{response: response}
		_, err := New(m, "").Evaluate(context.Background(), sampleQuestion(), []store.Turn{{ID: "t", Role: "candidate", Text: strings.Repeat("actual work ", 20)}}, "")
		if err == nil {
			t.Error("accepted unsupported assessment", response)
		}
	}
}

func TestUnassessedCannotCarryScoreAndOversizedEvidenceIsExplicit(t *testing.T) {
	r := Result{Scores: []DimScore{{Dimension: "requirements", Score: 4, Assessed: false, CoveragePct: 100}}}
	if err := validateScores(sampleQuestion(), &r, nil); err != nil {
		t.Fatal(err)
	}
	if r.Scores[0].Score != 0 || r.Scores[0].CoveragePct != 0 {
		t.Fatal("unassessed scored")
	}
	m := &captureModel{}
	_, err := New(m, "").Evaluate(context.Background(), sampleQuestion(), nil, strings.Repeat("x", maxEvidenceBytes+1))
	if err == nil || m.calls != 0 {
		t.Fatal("oversized input was silently truncated or sent")
	}
	b, _ := json.Marshal(r)
	if !json.Valid(b) {
		t.Fatal("invalid result")
	}
}
