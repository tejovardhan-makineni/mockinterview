package live

import (
	"strings"
	"testing"

	"github.com/tejo/mockinterview-api/internal/corpus"
)

func TestEngineeringStandardKeepsUnrelatedProfessionsAndSharedRoundsIndependent(t *testing.T) {
	for _, domain := range []string{"behavioral", "recruiter_screen", "clinical_reasoning", "thermodynamics", "custom", "case_interview"} {
		t.Run(domain, func(t *testing.T) {
			q := corpus.Question{Domain: domain, Track: "engineering", Modality: "written", Areas: []string{"software_engineering", "medicine"}, Difficulty: "senior"}
			if got := engineeringStandard(q); got != "" {
				t.Fatalf("shared audience assigned a software hiring standard: %q", got)
			}
		})
	}
}

func TestEngineeringStandardUsesConfiguredLevelWithoutChangingChallenge(t *testing.T) {
	levels := map[string]string{
		"entry": "ENTRY SCOPE:", "junior": "JUNIOR SCOPE:", "mid": "MID SCOPE:",
		"senior": "SENIOR SCOPE:", "staff": "STAFF SCOPE:", "senior specialist in training": "CUSTOM LEVEL SCOPE:",
	}
	for level, marker := range levels {
		for _, challenge := range []string{"foundation", "standard", "stretch"} {
			t.Run(level+"/"+challenge, func(t *testing.T) {
				q := corpus.Question{Domain: "coding", Difficulty: "mid", Settings: corpus.SessionSettings{TargetLevel: level, Challenge: challenge}}
				got := engineeringStandard(q)
				if !strings.Contains(got, marker) || !strings.Contains(got, "CHALLENGE SCOPE: "+challenge) {
					t.Fatalf("target/challenge lost: %q", got)
				}
				for other, unwanted := range levels {
					if other != level && strings.Contains(got, unwanted) {
						t.Errorf("target %q also received %q scope", level, other)
					}
				}
				if q.Settings.TargetLevel != level || q.Settings.Challenge != challenge || q.Difficulty != "mid" {
					t.Fatal("standard changed selected session settings")
				}
			})
		}
	}
	q := corpus.Question{Domain: "coding", Difficulty: "junior"}
	if got := engineeringStandard(q); !strings.Contains(got, "JUNIOR SCOPE:") || !strings.Contains(got, "CHALLENGE SCOPE: standard") {
		t.Fatalf("legacy question lost difficulty fallback: %q", got)
	}
}

func TestEngineeringStandardUsesTaskSpecificObservableEvidence(t *testing.T) {
	tests := []struct {
		domain string
		wants  []string
		absent string
	}{
		{"coding", []string{"actual code", "edge cases", "meaningful tests", "Static inspection is not execution", "correct code"}, "SYSTEM DESIGN EVIDENCE:"},
		{"system_design", []string{"interfaces", "data flow", "reliability", "failure tradeoffs"}, "CODING EVIDENCE:"},
		{"low_level_design", []string{"responsibilities", "contracts", "invariants", "testability", "Do not require named design patterns"}, "CODING EVIDENCE:"},
		{"ml_system_design", []string{"data and label assumptions", "evaluation choices", "leakage", "drift", "non-ML alternative"}, "LOW-LEVEL DESIGN EVIDENCE:"},
	}
	for _, tt := range tests {
		t.Run(tt.domain, func(t *testing.T) {
			got := engineeringStandard(corpus.Question{Domain: tt.domain, Difficulty: "senior"})
			for _, want := range append(tt.wants, "not Amazon's private hiring rubric", "Different rounds assess different competencies", "operational failure handling", "Missing evidence is unassessed") {
				if !strings.Contains(got, want) {
					t.Errorf("missing evidence/fairness contract %q", want)
				}
			}
			if strings.Contains(got, tt.absent) {
				t.Errorf("wrong domain guidance: %q", tt.absent)
			}
		})
	}
	staff := engineeringStandard(corpus.Question{Domain: "system_design", Difficulty: "staff"})
	if !strings.Contains(staff, "not an official Amazon level equivalence") {
		t.Fatal("staff mapping incorrectly implies an employer-defined hiring level")
	}
}
