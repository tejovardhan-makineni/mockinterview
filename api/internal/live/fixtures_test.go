package live

import (
	"encoding/json"
	"github.com/tejo/mockinterview-api/internal/corpus"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// These are deterministic context contracts, not claims of model calibration.
func TestContributedScenarioContextFixtures(t *testing.T) {
	var fixtures []struct {
		ScenarioID        string            `json:"scenario_id"`
		ExpectedFormat    string            `json:"expected_format"`
		ContextContains   []string          `json:"context_contains"`
		CandidateExamples map[string]string `json:"candidate_examples"`
	}
	files, err := filepath.Glob("../../data/fixtures/*-context.json")
	if err != nil {
		t.Fatal(err)
	}
	if len(files) == 0 {
		t.Fatal("no director context fixtures found")
	}
	for _, path := range files {
		b, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		var rows []struct {
			ScenarioID        string            `json:"scenario_id"`
			ExpectedFormat    string            `json:"expected_format"`
			ContextContains   []string          `json:"context_contains"`
			CandidateExamples map[string]string `json:"candidate_examples"`
		}
		if err = json.Unmarshal(b, &rows); err != nil {
			t.Fatal(err)
		}
		fixtures = append(fixtures, rows...)
	}
	cat, err := corpus.Load("../../data/corpus")
	if err != nil {
		t.Fatal(err)
	}
	for _, f := range fixtures {
		t.Run(f.ScenarioID, func(t *testing.T) {
			q, ok := cat.Get(f.ScenarioID)
			if !ok {
				t.Fatal("fixture scenario missing")
			}
			if q.FormatID != f.ExpectedFormat || q.FormatDefinition == nil {
				t.Fatal("format not resolved")
			}
			p := SystemPrompt(q, "neutral", 3, "intro", "", "", q.Minutes, "aoede", "en", SectionPlan(q, false, ""), "")
			for _, want := range f.ContextContains {
				if !strings.Contains(p, want) {
					t.Errorf("lost conditional fact/trigger %q", want)
				}
			}
			for _, kind := range []string{"clarification", "partial", "correction", "silence", "wrap"} {
				if _, ok := f.CandidateExamples[kind]; !ok {
					t.Error("missing fixture", kind)
				}
			}
		})
	}
}
