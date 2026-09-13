package live

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/tejo/mockinterview-api/internal/corpus"
	"github.com/tejo/mockinterview-api/internal/store"
)

func TestLiveProjectionPreservesScoringAndConditionalScenarioMaterial(t *testing.T) {
	cat, err := corpus.Load("../../data/corpus")
	if err != nil {
		t.Fatal(err)
	}
	for _, summary := range cat.List("", "", "") {
		q, _ := cat.Get(summary.ID)
		t.Run(q.ID, func(t *testing.T) {
			before, err := json.Marshal(q)
			if err != nil {
				t.Fatal(err)
			}
			p := SystemPrompt(q, "neutral", 3, "intro", "", "", 30, "aoede", "en", SectionPlan(q, false, ""), "")
			after, _ := json.Marshal(q)
			if !bytes.Equal(before, after) {
				t.Fatal("live projection changed the original scoring assignment or rubric")
			}
			if strings.HasPrefix(q.ID, "behavioral-") {
				if storyOpenings[q.ID] == "" {
					t.Fatal("new STAR scenario needs an authored single-focus opening")
				}
				if strings.Contains(p, string(q.Reference)) || strings.Contains(p, q.InterviewerNotes) {
					t.Fatal("coercive STAR scripts still reach the live interviewer")
				}
				for _, dimension := range q.Rubric {
					if !strings.Contains(p, dimension.Label) {
						t.Fatalf("lost assessment dimension %q", dimension.Label)
					}
				}
			} else {
				// Legacy probes can contain the only copy of conditional clinical
				// findings, numerical variants and disclosure rules. Preserve the
				// entire reference once, including unknown future field types.
				if strings.Count(p, string(q.Reference)) != 1 {
					t.Fatal("conditional scenario reference lost or duplicated")
				}
				if q.InterviewerNotes != "" && !strings.Contains(p, q.InterviewerNotes) {
					t.Fatal("lost scenario-specific disclosure rule or worked constraint")
				}
			}
			if !strings.HasSuffix(p, deliveryDecision) {
				t.Fatal("delivery decision must follow all legacy scripts and phase labels")
			}
		})
	}
}

func TestOpeningIntroducesFactsBeforeTheFocusedAsk(t *testing.T) {
	for _, tc := range []struct {
		id    string
		facts []string
	}{
		{"two-sum-variants", []string{"indices", "integer target", "exactly one solution", "same element may not be used twice", "Introduce only Two Sum now"}},
		{"ai-output-critique-forecast", []string{"20% revenue increase", "100 conversions from 1,000", "120 from 1,000", "new advertising channel"}},
	} {
		t.Run(tc.id, func(t *testing.T) {
			setup := firstQuestionSetup(corpus.Question{ID: tc.id})
			for _, fact := range tc.facts {
				if !strings.Contains(setup, fact) {
					t.Fatalf("voice opening lost essential primary-task fact %q", fact)
				}
			}
		})
	}
	if !strings.Contains(openingInstruction, "FIRST introduce the primary problem") || !strings.Contains(openingInstruction, "THEN ask only the FIRST QUESTION FOCUS") {
		t.Fatal("focused opening can omit the primary task's context")
	}
}

func TestWorkingStageUsesActualDeadlineAndDoesNotEndAfterOneAnswer(t *testing.T) {
	started := time.Now().Add(-2 * time.Minute)
	deadline := time.Now().Add(37 * time.Second)
	relay := &Relay{attempt: store.Session{DurationMinutes: 30, StartedAt: &started, DeadlineAt: &deadline}}
	sections := []Section{{ID: "core", Kind: "behavioral", Title: "Behavioral", Guidance: behavioralGuidance}}
	context := relay.stageContext(sections, &wsConn{conn: &fakeConn{}})
	if !strings.Contains(context, "SERVER CLOCK: 36 seconds") && !strings.Contains(context, "SERVER CLOCK: 37 seconds") {
		t.Fatalf("text cue used configured duration instead of persisted deadline: %s", context)
	}
	working := activeStageInstruction(sections[0], 12*time.Minute)
	for _, want := range []string{"720 seconds remain", "WORKING STAGE", "does not complete the whole stage", "explicit request to finish", "do not add filler"} {
		if !strings.Contains(working, want) {
			t.Errorf("working-stage guard missing %q", want)
		}
	}
	closing := activeStageInstruction(Section{Kind: "wrap", Title: "Wrap-up"}, -time.Second)
	if !strings.Contains(closing, "0 seconds remain") || !strings.Contains(closing, "scheduled wrap-up stage") || strings.Contains(closing, "WORKING STAGE") {
		t.Fatal("wrap cue cannot close naturally or exposes negative time")
	}
}

func TestProbeIndexDoesNotDuplicateScriptedQuestions(t *testing.T) {
	reference := json.RawMessage(`{"probes":[{"trigger":"asks about cost","question":"Costs rose 15%. What would you calculate, and what would you recommend?"}],"deep_dives":[{"topic":"timeouts","probe":"How would you handle a timeout? What goes to the DLQ?"}]}`)
	index := probeTriggers(reference)
	if !strings.Contains(index, "WHEN asks about cost") || !strings.Contains(index, "WHEN timeouts") {
		t.Fatal("lost conditional triggers")
	}
	if strings.Contains(index, "?") || strings.Contains(index, "Costs rose") {
		t.Fatal("index duplicated a speaking script or promoted a conditional fact")
	}
}

func TestMBAKeepsCareerGoalsInsteadOfForcingSTAR(t *testing.T) {
	cat, err := corpus.Load("../../data/corpus")
	if err != nil {
		t.Fatal(err)
	}
	q, ok := cat.Get("mba-admissions")
	if !ok {
		t.Fatal("MBA scenario missing")
	}
	plan := SectionPlan(q, false, "")
	p := SystemPrompt(q, "neutral", 3, "intro", "", "", 30, "aoede", "en", plan, "")
	if !strings.Contains(p, q.Prompt) || strings.Contains(p, behavioralGuidance) || !strings.Contains(p, mbaGuidance) {
		t.Fatal("MBA goals replaced with an unrelated STAR interview")
	}
}
