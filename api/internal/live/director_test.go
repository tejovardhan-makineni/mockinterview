package live

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/tejo/mockinterview-api/internal/corpus"
)

func TestSystemPromptIncludesPersonaAndProbes(t *testing.T) {
	q := corpus.Question{
		Title: "Design X", Prompt: "do it", Domain: "system_design", Modality: "system_design", Difficulty: "mid",
		Rubric:    []corpus.RubricDim{{Key: "hld", Label: "High-level design", Description: "components", Weight: 1}},
		Reference: json.RawMessage(`{"deep_dives":[{"topic":"cdc","probe":"how do you capture DB changes, Debezium?"}]}`),
	}
	sp := SystemPrompt(q, "annoying", 5, "deepdive", "7y backend eng", "candidate drew a Postgres box", 30, "charon")
	for _, want := range []string{"impatient", "Debezium", "High-level design", "deepdive", "Postgres", "Charon"} {
		if !strings.Contains(sp, want) {
			t.Errorf("system prompt missing %q", want)
		}
	}
}

func TestInterviewerRoleByField(t *testing.T) {
	cases := map[string]corpus.Question{
		"an attending physician who supervises trainees":      {Domain: "clinical_reasoning", Areas: []string{"medicine"}},
		"a senior mechanical engineer":                        {Domain: "thermodynamics", Areas: []string{"mechanical_engineering"}},
		"a hiring manager who has run hundreds of interviews": {Domain: "behavioral", Areas: []string{"software_engineering", "medicine"}},
	}
	for want, q := range cases {
		if got := interviewerRole(q); got != want {
			t.Errorf("interviewerRole(%v) = %q, want %q", q.Areas, got, want)
		}
	}
}

func TestNextPhaseSkipsByModality(t *testing.T) {
	// conversational skips estimation/hld/api → intro then requirements then deepdive.
	if got := NextPhase("conversational", "requirements"); got != "deepdive" {
		t.Errorf("conversational after requirements = %q, want deepdive", got)
	}
	if got := NextPhase("system_design", "intro"); got != "requirements" {
		t.Errorf("system_design after intro = %q, want requirements", got)
	}
	if got := NextPhase("system_design", "wrap"); got != "wrap" {
		t.Errorf("terminal phase should stay wrap, got %q", got)
	}
}
