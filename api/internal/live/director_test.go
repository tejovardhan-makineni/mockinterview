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
	sections := SectionPlan(q, true, "")
	sp := SystemPrompt(q, "annoying", 5, "deepdive", "7y backend eng", "candidate drew a Postgres box", 30, "charon", "en", sections, "")
	for _, want := range []string{"impatient", "Debezium", "High-level design", "deepdive", "Postgres", "Alex", "STAGES"} {
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

// TestSectionPlan asserts the plan shape: intro first, wrap last, resume added
// only when a resume exists, every core domain maps to its expected kind, every
// section has non-empty guidance, and roundFocus lands on the core section.
func TestSectionPlan(t *testing.T) {
	// intro always first, wrap always last; every section has guidance.
	plan := SectionPlan(corpus.Question{Domain: "coding"}, false, "")
	if plan[0].Kind != "intro" {
		t.Errorf("first section = %q, want intro", plan[0].Kind)
	}
	if plan[len(plan)-1].Kind != "wrap" {
		t.Errorf("last section = %q, want wrap", plan[len(plan)-1].Kind)
	}
	for _, s := range plan {
		if strings.TrimSpace(s.Guidance) == "" {
			t.Errorf("section %q has empty guidance", s.Kind)
		}
		if strings.TrimSpace(s.Title) == "" {
			t.Errorf("section %q has empty title", s.Kind)
		}
	}

	// A resume adds a resume section right after intro.
	withResume := SectionPlan(corpus.Question{Domain: "coding"}, true, "")
	if len(withResume) != len(plan)+1 || withResume[1].Kind != "resume" {
		t.Errorf("resume plan = %v, want a resume section at index 1", kinds(withResume))
	}

	// Each core domain maps to the expected kind.
	coreCases := map[string]string{
		"coding":             "coding",
		"low_level_design":   "lld",
		"system_design":      "design",
		"ml_system_design":   "design",
		"behavioral":         "behavioral",
		"clinical_reasoning": "clinical",
		"medical_residency":  "clinical",
		"prioritization":     "clinical",
		"case":               "case",
		"valuation":          "core", // unmapped domain → core
	}
	for domain, wantKind := range coreCases {
		p := SectionPlan(corpus.Question{Domain: domain}, false, "")
		core := p[len(p)-2] // second-to-last is CORE (last is wrap, no resume here)
		if core.Kind != wantKind {
			t.Errorf("domain %q core kind = %q, want %q", domain, core.Kind, wantKind)
		}
	}

	// roundFocus is reflected in the core section guidance (and nowhere else).
	focus := "Amazon bar-raiser: raise the bar, probe Leadership Principles depth"
	fp := SectionPlan(corpus.Question{Domain: "behavioral"}, false, focus)
	core := fp[len(fp)-2]
	if !strings.Contains(core.Guidance, focus) {
		t.Errorf("core guidance missing roundFocus: %q", core.Guidance)
	}
	if strings.Contains(fp[0].Guidance, focus) {
		t.Error("roundFocus leaked into the intro section")
	}
}

func kinds(ss []Section) []string {
	out := make([]string, len(ss))
	for i, s := range ss {
		out[i] = s.Kind
	}
	return out
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
