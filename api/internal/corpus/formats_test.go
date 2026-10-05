package corpus

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestVersionedFormatSnapshotAndValidation(t *testing.T) {
	c, err := Load("../../data/corpus")
	if err != nil {
		t.Fatal(err)
	}
	q, ok := c.Get("incident-triage-checkout")
	if !ok || q.FormatDefinition == nil {
		t.Fatal("format not resolved")
	}
	f := *q.FormatDefinition
	before := Fingerprint(q)
	f.Revision++
	q.FormatDefinition = &f
	if Fingerprint(q) == before {
		t.Fatal("format revision missing from snapshot fingerprint")
	}
	f.Stages = append([]FormatStage(nil), f.Stages...)
	f.Stages[0].Share = .5
	if ValidateFormat(f) == nil {
		t.Fatal("invalid stage budget accepted")
	}
	q.FormatID = ""
	if Validate(q) == nil {
		t.Fatal("v1 required format accepted empty")
	}
}

func TestFactRevealContract(t *testing.T) {
	c, err := Load("../../data/corpus")
	if err != nil {
		t.Fatal(err)
	}
	q, _ := c.Get("incident-triage-checkout")
	var ref map[string]any
	_ = json.Unmarshal(q.Reference, &ref)
	ref["facts"] = []map[string]any{{"value": "partial fact", "reveal_when": "asked"}}
	q.Reference, _ = json.Marshal(ref)
	if Validate(q) == nil {
		t.Fatal("fact without stable id accepted")
	}
}

func TestEveryAuthoredFormatAllowsUninterruptedWork(t *testing.T) {
	formats, err := loadFormats("../../data/formats")
	if err != nil {
		t.Fatal(err)
	}
	for id, format := range formats {
		for _, rule := range []string{
			"Let the candidate finish their answer or work before assessment follow-ups",
			"private priorities, not a checklist",
			"answer requested facts without adding another assessment question",
		} {
			if !strings.Contains(format.ToolPolicy, rule) {
				t.Errorf("format %s lost pacing rule %q", id, rule)
			}
		}
	}
	// These were active stage commands that prompted the assessment criteria
	// before the candidate could inspect the material or complete a response.
	for _, tc := range []struct{ id, directive string }{
		{"work-sample-defense", "ask whether the candidate has a clarification"},
		{"work-sample-defense", "Ask for an alternative, a verification plan and a focused improvement"},
		{"incident-simulation", "Ask how they will mitigate, verify recovery and communicate"},
	} {
		format, ok := formats[tc.id]
		if !ok {
			t.Fatalf("missing interview format %s", tc.id)
		}
		for _, stage := range format.Stages {
			if strings.Contains(stage.Guidance, tc.directive) {
				t.Errorf("%s reinstated a leading or compound stage directive: %s", tc.id, tc.directive)
			}
		}
	}
}
