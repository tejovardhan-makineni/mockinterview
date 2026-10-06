package live

import (
	"strings"
	"testing"
	"time"
)

func TestObservationDecisionFreshnessAndFloorGuards(t *testing.T) {
	start := time.Now()
	sections := []Section{{ID: "work", Kind: "coding"}, {ID: "review", Kind: "core"}, {ID: "wrap", Kind: "wrap"}}
	for _, change := range []string{"edit", "mic", "partial speech", "interviewer", "queued playback", "explicit floor", "response pending"} {
		t.Run(change, func(t *testing.T) {
			state := newObservationState(nil, "code", 0, start)
			_, revision := state.snapshot(sections, 300, false, start.Add(30*time.Second))
			working := false
			switch change {
			case "edit":
				state.setWorkspace("corrected code", start.Add(30*time.Second))
			case "mic":
				state.microphone([]byte{0xff, 0x7f}, start.Add(30*time.Second))
			case "partial speech":
				state.partial("candidate", "Actually I have corrected")
			case "interviewer":
				state.interviewer(start.Add(30*time.Second), 0)
			case "queued playback":
				state.interviewer(start.Add(30*time.Second), 48000*10)
				state.interviewerDone(false)
				_, revision = state.snapshot(sections, 300, false, start.Add(31*time.Second))
			case "explicit floor":
				working = true
			case "response pending":
				state.expectResponse(start)
				_, revision = state.snapshot(sections, 300, false, start.Add(31*time.Second))
			}
			accepted, speak, _ := state.accept(probe("Would you trace that?"), revision, working, sections, start.Add(33*time.Second))
			if accepted || speak {
				t.Fatal("stale or interrupting question accepted")
			}
			if state.notes != "" {
				t.Fatal("undelivered question polluted private notes")
			}
		})
	}
}

func TestNativeResponsePendingClearsOnlyOnCompletionAndRecoversIfStalled(t *testing.T) {
	start := time.Now()
	state := newObservationState(nil, "", 0, start)
	state.expectResponse(start)
	if state.responseStalled(start.Add(89*time.Second)) || !state.responseStalled(start.Add(90*time.Second)) {
		t.Fatal("stalled native response recovery has wrong bound")
	}
	state.candidateActivity(start.Add(80 * time.Second))
	if state.responseStalled(start.Add(100 * time.Second)) {
		t.Fatal("candidate still speaking should not trigger a native recovery")
	}
	state.interviewerDone(false)
	if state.responseStalled(start.Add(300 * time.Second)) {
		t.Fatal("completed response stayed pending")
	}
	state.expectResponse(start)
	state.interviewerDone(true)
	if state.responsePending {
		t.Fatal("interrupt must release pending response")
	}
}

func TestRestoredStageRetainsSuccessfulEarlyAdvance(t *testing.T) {
	sections := []Section{{ID: "work"}, {ID: "review"}, {ID: "wrap"}}
	for _, test := range []struct {
		clock int
		phase string
		want  int
	}{{0, "section:review", 1}, {2, "section:review", 2}, {0, "lobby", 0}, {1, "section:removed", 1}} {
		if got := restoredStage(sections, test.clock, test.phase); got != test.want {
			t.Fatalf("restore %+v: got %d", test, got)
		}
	}
}
func TestObservationStageCommitsOnlyAfterSuccessfulDelivery(t *testing.T) {
	start := time.Now()
	sections := []Section{{ID: "work", Kind: "coding"}, {ID: "wrap", Kind: "wrap"}}
	state := newObservationState(nil, "code", 0, start)
	_, revision := state.snapshot(sections, 90, false, start.Add(30*time.Second))
	decision := ObservationDecision{Action: "wrap", Utterance: "What would you like to ask?", Notes: "Proposed question is not yet delivered."}
	accepted, speak, advanced := state.accept(decision, revision, false, sections, start.Add(30*time.Second))
	if !accepted || !speak || !advanced || state.currentStage() != 0 || state.notes != "" {
		t.Fatal("proposal mutated state before delivery")
	}
	if !state.commit(decision, sections, false) || state.currentStage() != 1 || state.notes != "" {
		t.Fatal("successful native wrap did not advance without saving proposed-question notes")
	}
	if state.timedStage(0) {
		t.Fatal("scheduled cue regressed semantic progress")
	}
}
func TestWorkspaceObservationPreservesDistantCorrectionsAndMarksOversize(t *testing.T) {
	code := strings.Repeat("x", 50000) + "\nfunc safeAccess() { /* helper validates empty input */ }"
	if !strings.Contains(workspaceObservation(code), "helper validates empty input") {
		t.Fatal("distant helper silently clipped")
	}
	if got := workspaceObservation(strings.Repeat("x", maxObservationWorkspaceBytes+1)); !strings.Contains(got, "WORKSPACE INCOMPLETE:") {
		t.Fatal("oversized artifact lost without an explicit boundary")
	}
}
