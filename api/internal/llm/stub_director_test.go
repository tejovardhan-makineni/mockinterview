package llm

import (
	"strings"
	"testing"
)

func TestDemoOpeningUsesSelectedScenario(t *testing.T) {
	req := GenerateRequest{System: "Workspace: conversational.\nCANDIDATE BRIEF: Tell me about a disagreement with a colleague.\nPRIVATE SCENARIO MATERIAL follows. Secret answer.", Messages: []Message{{Role: "user", Text: "Begin the interview using its authored opening and active stage."}}}
	opening := stubDirectorTurn(req)
	if !strings.Contains(opening, "disagreement with a colleague") || strings.Contains(opening, "Secret answer") || strings.Contains(opening, "functional requirements") {
		t.Fatal(opening)
	}
	req.Messages = []Message{{Role: "user", Text: "I discussed the team's database rollout disagreement."}}
	if reply := stubDirectorTurn(req); strings.Contains(reply, "Debezium") {
		t.Fatal("technical demo crossed profession boundary")
	}
}
