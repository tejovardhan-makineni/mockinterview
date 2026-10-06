package live

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/tejo/mockinterview-api/internal/llm"
)

type observationCapture struct {
	request  llm.GenerateRequest
	response string
	err      error
	stub     bool
	calls    int
}

func (c *observationCapture) Generate(_ context.Context, req llm.GenerateRequest) (string, error) {
	c.request, c.calls = req, c.calls+1
	return c.response, c.err
}
func (c *observationCapture) Stubbed() bool { return c.stub }
func (*observationCapture) Info() llm.Info  { return llm.Info{Provider: "test"} }

func TestObservationUsesLatestWorkAndRealEvidenceWithoutInventingATurn(t *testing.T) {
	capture := &observationCapture{response: `{"action":"probe","utterance":"What does your code return for nums [3,2,4] and target 6?","evidence":"The candidate says the implementation is complete; the current index is stored before the complement lookup.","notes":"Candidate chose a lookup table; no trace has yet been discussed."}`}
	in := ObservationInput{
		History:   []llm.Message{{Role: "model", Text: "Find two indices."}, {Role: "user", Text: "That is my complete implementation."}},
		Workspace: "for i,n in enumerate(nums):\n seen[n]=i\n if target-n in seen: return [seen[target-n],i]",
		Stage:     Section{Kind: "coding"}, RemainingSeconds: 720, QuietSeconds: 8,
		PreviousNotes: "Candidate is writing; no defect was discussed.", Trigger: "periodic_review",
	}
	decision, err := DecideObservation(context.Background(), capture, "reasoning-model", "Private scenario facts", in)
	if err != nil || decision.Action != "probe" {
		t.Fatalf("decision=%+v err=%v", decision, err)
	}
	if capture.request.Model != "reasoning-model" || capture.request.JSONSchema == nil || capture.request.Purpose != llm.PurposeDirector {
		t.Fatal("review did not use the selected reasoning provider and structured decision contract")
	}
	if len(capture.request.Messages) != 1 {
		t.Fatal("observation fabricated a candidate conversation turn")
	}
	var sent ObservationInput
	if err := json.Unmarshal([]byte(capture.request.Messages[0].Text), &sent); err != nil {
		t.Fatal(err)
	}
	if sent.Workspace != in.Workspace || len(sent.History) != 2 || sent.History[1].Text != in.History[1].Text || sent.PreviousNotes != in.PreviousNotes {
		t.Fatal("current work, conversation or prior evidence was lost")
	}
	if !strings.Contains(strings.ToLower(capture.request.System), "not a schedule for speaking") || !strings.Contains(capture.request.System, "Do not claim to have run code") {
		t.Fatal("observer missing cadence or evidence boundary")
	}
}

func TestObservationWaitAndHeldFloorNeverProduceSpeech(t *testing.T) {
	for _, tc := range []struct {
		name, response string
		working        bool
	}{
		{"wait", `{"action":"wait","utterance":"I am watching you.","evidence":"Work in progress.","notes":"Potential index issue; candidate has not finished."}`, false},
		{"held floor", `{"action":"probe","utterance":"Trace this input.","evidence":"Potential issue.","notes":"Potential index issue; no probe delivered."}`, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c := &observationCapture{response: tc.response}
			d, err := DecideObservation(context.Background(), c, "", "", ObservationInput{CandidateWorking: tc.working, PreviousNotes: "The candidate is implementing; no probe delivered."})
			if err != nil || d.Action != "wait" || d.Utterance != "" || d.Notes == "" {
				t.Fatalf("work was interrupted or evidence lost: %+v %v", d, err)
			}
		})
	}
}

func TestObservationProposalCannotRecordItselfAsAlreadyAsked(t *testing.T) {
	in := ObservationInput{PreviousNotes: "Initial approach discussed; no correctness probe yet."}
	d, err := parseObservationDecision(`{"action":"probe","utterance":"Trace this input.","evidence":"Latest code may reuse the current index.","notes":"The probe was delivered and the candidate has not answered."}`, in)
	if err != nil || d.Notes != in.PreviousNotes {
		t.Fatal("an unconfirmed proposal counted as delivered evidence")
	}
}

func TestObservationRejectsUnsafeOrUnusableDecisions(t *testing.T) {
	for _, raw := range []string{
		`not JSON`, `{"action":"execute","utterance":"Run it","evidence":"x"}`,
		`{"action":"probe","utterance":"Guess a bug"}`, `{"action":"probe","evidence":"x"}`,
		`{"action":"advance","utterance":"Next stage","evidence":"Complete"}`,
		`{"action":"wrap","utterance":"Finished","evidence":"One correct answer"}`,
		`{"action":"probe","utterance":"` + strings.Repeat("x", 1201) + `","evidence":"x"}`,
	} {
		if _, err := parseObservationDecision(raw, ObservationInput{Stage: Section{Kind: "intro"}}); err == nil {
			t.Fatalf("invalid decision accepted: %.100s", raw)
		}
	}
	for _, action := range []string{"advance", "wrap"} {
		in := ObservationInput{Stage: Section{Kind: "coding"}, NextStage: &Section{Kind: "wrap"}}
		if _, err := parseObservationDecision(`{"action":"`+action+`","utterance":"Do you have a final question?","evidence":"The completed solution and tradeoffs have been discussed."}`, in); err != nil {
			t.Fatal(err)
		}
	}
}

func TestObservationFailureAndOfflineModeDoNotGenerateFallbackQuestions(t *testing.T) {
	c := &observationCapture{err: errors.New("provider error containing secret-key")}
	_, err := DecideObservation(context.Background(), c, "", "", ObservationInput{})
	if err == nil || strings.Contains(err.Error(), "secret-key") {
		t.Fatal("provider failure was lost or credential-containing error exposed")
	}
	c.stub = true
	d, err := DecideObservation(context.Background(), c, "", "", ObservationInput{})
	if err != nil || d.Action != "wait" || d.Utterance != "" || c.calls != 1 {
		t.Fatal("offline mode asked a scripted question for a semantic review")
	}
}

func TestOrdinaryTextTurnCanChooseSilence(t *testing.T) {
	c := &observationCapture{response: "[[WAIT]]"}
	reply, err := NextTurn(context.Background(), c, "", "", []llm.Message{{Role: "user", Text: "I'll work through this part now."}})
	if err != nil || reply != "" {
		t.Fatal("transport wait marker was exposed as speech")
	}
	if !strings.Contains(c.request.System, "TEXT DELIVERY") {
		t.Fatal("ordinary reply cannot choose silence")
	}
}

func TestObservationReconnectPreservesEarlierConstraintsAndLongCorrections(t *testing.T) {
	history := []llm.Message{{Role: "user", Text: "We agreed that a link can expire after one day; I have answered two expiration probes."}}
	for i := 0; i < 70; i++ {
		history = append(history, llm.Message{Role: "user", Text: "More relevant work."})
	}
	last := strings.Repeat("Implementation detail. ", 800) + " I corrected the race using an atomic compare-and-swap and verified the retry path."
	history = append(history, llm.Message{Role: "user", Text: last})
	got, err := observationHistory(history, false)
	if err != nil || len(got) != len(history) || got[0].Text != history[0].Text || got[len(got)-1].Text != last {
		t.Fatal("reconnect lost earlier constraints, exhausted probes, or the final correction")
	}
	recent, err := observationHistory(history, true)
	if err != nil || len(recent) > 60 || recent[len(recent)-1].Text != last {
		t.Fatal("bounded review clipped a candidate turn before its final correction")
	}
}

func TestObservationCannotDiagnoseFromSilentlyTruncatedWorkspace(t *testing.T) {
	for _, workspace := range []string{strings.Repeat("x", maxObservationWorkspaceBytes+1), "WORKSPACE INCOMPLETE: 60 shapes were omitted"} {
		c := &observationCapture{response: `{"action":"probe","utterance":"Where is the helper?","evidence":"Helper absent."}`}
		d, err := DecideObservation(context.Background(), c, "", "", ObservationInput{Workspace: workspace})
		if err != nil || d.Action != "wait" || d.Utterance != "" || c.calls != 0 {
			t.Fatal("incomplete artifact was treated as evidence of missing implementation")
		}
	}
}
