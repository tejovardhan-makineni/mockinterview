package feedback

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/tejo/mockinterview-api/internal/corpus"
	"github.com/tejo/mockinterview-api/internal/store"
)

func TestExpandedProfessionsHaveSpecificSurveyFocus(t *testing.T) {
	cat, err := corpus.Load("../../data/corpus")
	if err != nil {
		t.Fatal(err)
	}
	areas := map[string]bool{"management": true, "engineering_management": true, "pharmacy": true, "dentistry": true, "allied_health": true, "veterinary": true, "architecture": true, "manufacturing": true, "aviation": true, "agriculture": true}
	for _, q := range cat.List("", "", "") {
		if !areas[q.Areas[0]] {
			continue
		}
		snapshot, _ := json.Marshal(q)
		s := store.Session{QuestionSnapshot: snapshot}
		if surveySubject(s).key == "general" {
			t.Errorf("new scenario %s lacks a subject-specific check-in", q.ID)
		}
		if questions := questionnaire(s).Questions; len(questions) != len(store.InterviewFeedbackQuestionIDs) {
			t.Errorf("new profession changed question IDs/options: %s", q.ID)
		}
	}
}

func TestNewSubjectMappingsPreserveEarlierWordingAndUnknownFallback(t *testing.T) {
	for _, tc := range []struct{ domain, key, focus string }{
		{"coding", "coding", "your reasoning about the coding solution"},
		{"clinical_reasoning", "clinical_reasoning", "your reasoning about the fictional clinical case"},
		{"structured_hiring", "general", "your reasoning about this scenario"},
		{"future_unmapped", "general", "your reasoning about this scenario"},
	} {
		b, _ := json.Marshal(map[string]string{"domain": tc.domain})
		s := store.Session{QuestionSnapshot: b}
		if got := surveySubject(s); got.key != tc.key || got.focus != tc.focus {
			t.Fatalf("%s: got %#v", tc.domain, got)
		}
		if !strings.Contains(questionnaire(s).Questions[2].Prompt, tc.focus) {
			t.Fatal("focus missing from rendered questionnaire")
		}
	}
}
