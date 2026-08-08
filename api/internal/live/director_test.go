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
	sp := SystemPrompt(q, "annoying", 5, "deepdive", "7y backend eng", "candidate drew a Postgres box", 30, "charon", "en")
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

// TestEveryCorpusDomainHasGuidance guards HR-5: per-domain interviewer guidance
// used to silently die because the domainGuidance keys had drifted away from the
// real corpus `domain` strings. Every domain in the shipped corpus must have
// either non-empty domainGuidance OR non-empty interviewer_notes on every one of
// its questions (the SystemPrompt fallback), so an interview is never run with
// generic, domain-blind pacing.
func TestEveryCorpusDomainHasGuidance(t *testing.T) {
	cat, err := corpus.Load("../../data/corpus")
	if err != nil {
		t.Fatalf("load corpus: %v", err)
	}
	// Collect, per domain, whether any question lacks interviewer_notes.
	domainHasNotesGap := map[string]bool{}
	domains := map[string]bool{}
	for _, sum := range cat.List("", "", "") {
		q, ok := cat.Get(sum.ID)
		if !ok {
			continue
		}
		domains[q.Domain] = true
		if strings.TrimSpace(q.InterviewerNotes) == "" {
			domainHasNotesGap[q.Domain] = true
		}
	}
	if len(domains) == 0 {
		t.Fatal("no domains loaded from corpus")
	}
	for d := range domains {
		if strings.TrimSpace(domainGuidance[d]) != "" {
			continue // covered by built-in guidance
		}
		if domainHasNotesGap[d] {
			t.Errorf("domain %q has neither domainGuidance nor interviewer_notes on all its questions — interviewer guidance would silently die", d)
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
