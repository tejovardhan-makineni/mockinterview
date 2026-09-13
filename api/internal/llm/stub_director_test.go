package llm

import (
	"strings"
	"testing"
)

func TestDemoOpeningUsesSelectedScenario(t *testing.T) {
	req := GenerateRequest{System: "INTERVIEW: Disagreement with a colleague. Format: behavioral. Domain: behavioral. Workspace: conversational.\nCANDIDATE BRIEF: Tell me about a disagreement with a colleague. What happened, what did you do, and what was the result?\nPRIVATE SCENARIO MATERIAL follows. Secret answer.", Messages: []Message{{Role: "user", Text: "Begin the interview using its authored opening and active stage."}}}
	opening := stubDirectorTurn(req)
	if !strings.Contains(opening, "Disagreement with a colleague") || !strings.Contains(opening, "one specific situation") || strings.Contains(opening, "what was the result") || strings.Contains(opening, "Secret answer") || strings.Contains(opening, "functional requirements") {
		t.Fatal(opening)
	}
	req.Messages = []Message{{Role: "user", Text: "I discussed the team's database rollout disagreement."}}
	if reply := stubDirectorTurn(req); strings.Contains(reply, "Debezium") {
		t.Fatal("technical demo crossed profession boundary")
	}
}

func TestDemoFollowupsDoNotLoopOrBundleQuestions(t *testing.T) {
	for _, workspace := range []string{"conversational", "coding", "system_design", "written"} {
		t.Run(workspace, func(t *testing.T) {
			req := GenerateRequest{System: "Workspace: " + workspace + ".", Messages: []Message{{Role: "user", Text: "I chose the database."}}}
			seen := make(map[string]bool)
			for i := 0; i < 5; i++ {
				reply := stubDirectorTurn(req)
				if strings.Contains(reply, "Thank you for trying the demo") {
					return
				}
				if seen[reply] {
					t.Fatalf("repeated demo probe: %s", reply)
				}
				// The demo's finite authored bank is intentionally simple enough
				// for a structural assertion; real model outputs need semantic eval.
				if strings.Count(reply, "?") != 1 || strings.Contains(reply, " and ") || strings.Contains(reply, "Debezium") {
					t.Fatalf("compound probe or solution hint: %s", reply)
				}
				seen[reply] = true
				req.Messages = append(req.Messages, Message{Role: "model", Text: reply}, Message{Role: "user", Text: "I chose the database."})
			}
			t.Fatal("demo did not wind down after exhausting its follow-ups")
		})
	}
}
