package live

import (
	"context"
	"encoding/json"
	"github.com/tejo/mockinterview-api/internal/corpus"
	"github.com/tejo/mockinterview-api/internal/llm"
	"strings"
	"testing"
	"time"
)

type kickoffCapture struct{ request llm.GenerateRequest }

func (c *kickoffCapture) Generate(_ context.Context, req llm.GenerateRequest) (string, error) {
	c.request = req
	return "Opening", nil
}
func (*kickoffCapture) Stubbed() bool  { return false }
func (*kickoffCapture) Info() llm.Info { return llm.Info{Provider: "test"} }

func TestFirstDirectorTurnHasProviderContent(t *testing.T) {
	c := &kickoffCapture{}
	if _, err := NextTurn(context.Background(), c, "model", "format policy", nil); err != nil {
		t.Fatal(err)
	}
	if len(c.request.Messages) != 1 || c.request.Messages[0].Role != "user" || !strings.Contains(c.request.Messages[0].Text, "authored opening") {
		t.Fatal("empty provider contents or unscoped kickoff")
	}
	history := []llm.Message{{Role: "user", Text: "My answer"}}
	_, _ = NextTurn(context.Background(), c, "model", "format policy", history)
	if len(c.request.Messages) != 1 || c.request.Messages[0].Text != "My answer" {
		t.Fatal("kickoff repeated in ongoing interview")
	}
}

func TestAuthoredNotesAndFactsReachKnownDomain(t *testing.T) {
	q := corpus.Question{Title: "Case", Domain: "case", InterviewerNotes: "Do not disclose the volume until asked", Reference: json.RawMessage(`{"facts":[{"id":"volume","value":120,"reveal_when":"asked about volume"}],"probes":[{"trigger":"candidate ignores units","question":"Which units?"}],"follow_ups":["What changes your conclusion?"]}`)}
	p := SystemPrompt(q, "neutral", 3, "intro", "", "", 8, "charon", "en", nil, "")
	for _, want := range []string{q.InterviewerNotes, "asked about volume", "120", "WHEN candidate ignores units", "What changes your conclusion?", "AI practice interviewer", "unspecified information is unavailable"} {
		if !strings.Contains(p, want) {
			t.Errorf("missing %q", want)
		}
	}
	if strings.Contains(p, "NEVER say you are an AI") {
		t.Fatal("misleading identity directive")
	}
}

func TestShortStationLeavesTimeForTheScenario(t *testing.T) {
	q := corpus.ApplySessionConfig(corpus.Question{Domain: "medical_residency"}, json.RawMessage(`{"minutes":8}`))
	plan := SectionPlan(q, true, "")
	if len(plan) != 3 {
		t.Fatal("MMI must omit resume")
	}
	offsets := SectionSchedule(8*time.Minute, plan)
	if offsets[0] > time.Minute || offsets[1]-offsets[0] < 6*time.Minute {
		t.Fatalf("scenario budget too short: %v", offsets)
	}
}

func TestSimulationDoesNotInheritSupportiveHints(t *testing.T) {
	q := corpus.ApplySessionConfig(corpus.Question{Difficulty: "mid"}, json.RawMessage(`{"target_level":"entry","challenge":"foundation","practice_mode":"simulation","face_id":"alex"}`))
	p := SystemPrompt(q, "supportive", 1, "intro", "", "", 15, "charon", "en", nil, "")
	for _, want := range []string{"Target level: entry", "Challenge: foundation", "supportive tone does not grant hints", "takes precedence"} {
		if !strings.Contains(p, want) {
			t.Error(want)
		}
	}
	q.Settings.PracticeMode = "coaching"
	p = SystemPrompt(q, "supportive", 1, "intro", "", "", 15, "charon", "en", nil, "")
	if !strings.Contains(p, "COACHING MODE: hints are permitted only") {
		t.Fatal("coaching assistance missing")
	}
}
