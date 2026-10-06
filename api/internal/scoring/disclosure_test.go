package scoring

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/tejo/mockinterview-api/internal/corpus"
	"github.com/tejo/mockinterview-api/internal/store"
)

func TestScoringSeparatesVisibleScopeFromPrivateExtensions(t *testing.T) {
	q := sampleQuestion()
	q.CandidateBrief = "Design a shared calendar for a small team."
	q.Prompt = "Design a shared calendar. Optional extension: support ten million tenants."
	q.Reference = json.RawMessage(`{"facts":[{"id":"scale","value":"ten million tenants","reveal_when":"candidate asks about scale"}]}`)
	q.Difficulty = "mid"
	q.Settings = corpus.SessionSettings{TargetLevel: "senior", Challenge: "foundation"}
	model := &captureModel{response: `{"scores":[{"dimension":"requirements","score":3,"assessed":true,"evidence_refs":[{"source_id":"answer","quote":"I would first confirm the expected number of users"}]}]}`}
	turns := []store.Turn{
		{ID: "answer", Role: "candidate", Text: "I would first confirm the expected number of users before choosing capacity assumptions."},
		{ID: "clarification", Role: "interviewer", Text: "The expected number is not specified; choose a reasonable assumption."},
	}
	result, err := New(model, "test-model").Evaluate(context.Background(), q, turns, "")
	if err != nil {
		t.Fatal(err)
	}
	request := model.request.Messages[0].Text
	start := strings.Index(request, "CANDIDATE-VISIBLE BRIEF:\n")
	end := strings.Index(request, "PRIVATE FULL ASSIGNMENT (not necessarily disclosed):\n")
	if start < 0 || end <= start {
		t.Fatalf("missing public/private assignment boundaries: %q", request)
	}
	public := request[start:end]
	if !strings.Contains(public, q.CandidateBrief) || strings.Contains(public, "ten million") {
		t.Fatalf("private extension represented as already disclosed: %q", public)
	}
	for _, want := range []string{q.Prompt, `"target_level":"senior"`, `"challenge":"foundation"`, turns[1].Text} {
		if !strings.Contains(request, want) {
			t.Errorf("lost assessment/disclosure context %q", want)
		}
	}
	for _, want := range []string{
		"Do not penalize the candidate for an undisclosed constraint",
		"with a fair opportunity to respond",
		"do not treat the missing fact as a candidate error",
		"Do not automatically reward or penalize thinking time",
		"distinguish assisted work from independently demonstrated reasoning",
		"Use SESSION SETTINGS.target_level when present",
	} {
		if !strings.Contains(model.request.System, want) {
			t.Errorf("missing fairness contract %q", want)
		}
	}
	if result.Version != ScoringVersion || result.Scores[1].Assessed || result.Overall != 3 {
		t.Fatalf("unassessed scaling affected score or version missing: %+v", result)
	}
}

func TestScoringLegacyBriefAndDisclosedFactsKeepCandidateEvidenceBoundary(t *testing.T) {
	q := sampleQuestion()
	q.Prompt = "Design a calendar supporting ten million tenants."
	model := &captureModel{response: `{"scores":[{"dimension":"scaling","score":4,"assessed":true,"evidence_refs":[{"source_id":"disclosure","quote":"Shard tenants by account ID"}]}]}`}
	turns := []store.Turn{
		{ID: "question", Role: "candidate", Text: "How many tenants should I plan for? I would like to clarify the scale before choosing my design."},
		{ID: "disclosure", Role: "interviewer", Text: "Shard tenants by account ID; this is a hint about the implementation."},
	}
	_, err := New(model, "test-model").Evaluate(context.Background(), q, turns, "")
	if err == nil {
		t.Fatal("interviewer assistance counted as independent candidate evidence")
	}
	if !strings.Contains(model.request.Messages[0].Text, "CANDIDATE-VISIBLE BRIEF:\n"+q.Prompt+"\nPRIVATE FULL ASSIGNMENT") {
		t.Fatal("legacy full prompt was not preserved as visible scope")
	}
}
