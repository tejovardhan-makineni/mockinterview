package scoring

import (
	"context"
	"strings"
	"testing"

	"github.com/tejo/mockinterview-api/internal/corpus"
	"github.com/tejo/mockinterview-api/internal/llm"
	"github.com/tejo/mockinterview-api/internal/store"
)

func sampleQuestion() corpus.Question {
	return corpus.Question{
		ID: "q1", Title: "Sample", Modality: "system_design",
		Rubric: []corpus.RubricDim{
			{Key: "requirements", Label: "Requirements", Description: "Gather scope", Weight: 1},
			{Key: "scaling", Label: "Scaling", Description: "Scale it", Weight: 2},
		},
	}
}

// Offline practice must never invent performance scores, even with substantive
// answers. Rubric and drills can still demonstrate the report structure.
func TestEvaluateStubIsClearlyUnscored(t *testing.T) {
	e := New(llm.NewStub(), "")
	transcript := []store.Turn{{Role: "candidate", Text: strings.Repeat("design cache shard replica ", 20)}}
	res, err := e.Evaluate(context.Background(), sampleQuestion(), transcript, "")
	if err != nil {
		t.Fatal(err)
	}
	if res.Scored || !strings.Contains(res.Note, "Demo feedback") {
		t.Fatal("demo must be clearly marked unscored")
	}
	if len(res.Scores) != 2 {
		t.Fatalf("expected 2 rubric dims, got %d", len(res.Scores))
	}
	if res.Overall != 0 {
		t.Errorf("demo must not fabricate an overall score: %v", res.Overall)
	}
	for _, dimension := range res.Scores {
		if dimension.Assessed || dimension.Score != 0 || dimension.CoveragePct != 0 {
			t.Fatal("demo fabricated a dimension assessment")
		}
	}
}

// Too little candidate content must not fabricate a score.
func TestEvaluateNotEnoughIsNotScored(t *testing.T) {
	e := New(llm.NewStub(), "")
	transcript := []store.Turn{{Role: "candidate", Text: "idk maybe a database"}}
	res, err := e.Evaluate(context.Background(), sampleQuestion(), transcript, "")
	if err != nil {
		t.Fatal(err)
	}
	if res.Scored {
		t.Fatal("sparse transcript should not be scored")
	}
	if res.Note == "" {
		t.Error("not-scored result should explain why")
	}
}

// Unassessed dimensions are excluded from the weighted overall.
func TestWeightsSkipUnassessed(t *testing.T) {
	e := New(llm.NewStub(), "")
	q := sampleQuestion()
	r := &Result{Scores: []DimScore{
		{Dimension: "requirements", Score: 4, Weight: 1, Assessed: true},
		{Dimension: "scaling", Score: 0, Weight: 2, Assessed: false},
	}}
	e.applyWeightsAndOverall(q, r)
	if r.Overall != 4 {
		t.Errorf("overall should be 4 (only assessed dim counts), got %v", r.Overall)
	}
}

// If nothing was assessed, the interview is marked not-scored.
func TestNothingAssessedFlipsNotScored(t *testing.T) {
	e := New(llm.NewStub(), "")
	r := &Result{Scored: true, Scores: []DimScore{{Dimension: "requirements", Assessed: false, Weight: 1}}}
	e.applyWeightsAndOverall(sampleQuestion(), r)
	if r.Scored {
		t.Error("no assessed dimensions should flip Scored to false")
	}
}
