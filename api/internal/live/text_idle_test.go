package live

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/tejo/mockinterview-api/internal/corpus"
	"github.com/tejo/mockinterview-api/internal/llm"
	"github.com/tejo/mockinterview-api/internal/store"
	"github.com/tejo/mockinterview-api/internal/store/memstore"
)

type reviewReply struct {
	decision ObservationDecision
	err      error
}
type capturedReview struct {
	ctx   context.Context
	input ObservationInput
	reply chan reviewReply
}
type reviewCapture struct {
	calls        chan capturedReview
	ignoreCancel bool
}

func (c *reviewCapture) Generate(ctx context.Context, req llm.GenerateRequest) (string, error) {
	if req.JSONSchema == nil {
		return "Your completed response was heard.", nil
	}
	var input ObservationInput
	if err := json.Unmarshal([]byte(req.Messages[0].Text), &input); err != nil {
		return "", err
	}
	call := capturedReview{ctx: ctx, input: input, reply: make(chan reviewReply, 1)}
	c.calls <- call
	var result reviewReply
	if c.ignoreCancel {
		result = <-call.reply
	} else {
		select {
		case result = <-call.reply:
		case <-ctx.Done():
			return "", ctx.Err()
		}
	}
	if result.err != nil {
		return "", result.err
	}
	data, err := json.Marshal(result.decision)
	return string(data), err
}
func (*reviewCapture) Stubbed() bool  { return false }
func (*reviewCapture) Info() llm.Info { return llm.Info{Provider: "test"} }

type observationHarness struct {
	t         *testing.T
	client    *websocket.Conn
	seconds   atomic.Int64
	ticks     chan time.Time
	memory    *memstore.Mem
	sessionID string
	done      chan struct{}
}

func newObservationHarness(t *testing.T, ai llm.Client, kind string) *observationHarness {
	return newObservationHarnessMode(t, ai, kind, false)
}
func newObservationHarnessMode(t *testing.T, ai llm.Client, kind string, native bool) *observationHarness {
	t.Helper()
	ctx := context.Background()
	memory := memstore.New()
	user, err := memory.CreateUser(ctx, "observer@example.test", "unused")
	if err != nil {
		t.Fatal(err)
	}
	sess, err := memory.ReserveSession(ctx, store.Reservation{Session: store.Session{UserID: user.ID, Mode: "text", DurationMinutes: 30, Funding: "platform"}, Identity: "observer", Unlimited: true})
	if err != nil {
		t.Fatal(err)
	}
	if err = memory.AddTurn(ctx, sess.ID, "candidate", "Prior answer", 0, json.RawMessage(`{"event_id":"barrier"}`)); err != nil {
		t.Fatal(err)
	}
	if err = memory.AddTurn(ctx, sess.ID, "interviewer", "Describe your approach.", 0, nil); err != nil {
		t.Fatal(err)
	}
	return resumeObservationHarness(t, ai, kind, native, memory, sess.ID)
}
func resumeObservationHarness(t *testing.T, ai llm.Client, kind string, native bool, memory *memstore.Mem, sessionID string) *observationHarness {
	t.Helper()
	owner := store.NewID()
	sess, err := memory.AcquireLive(context.Background(), sessionID, owner)
	if err != nil {
		t.Fatal(err)
	}
	h := &observationHarness{t: t, memory: memory, sessionID: sess.ID, done: make(chan struct{}), ticks: make(chan time.Time, 8)}
	base := time.Now()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		defer close(h.done)
		defer memory.ReleaseLive(context.Background(), sess.ID, owner)
		conn, err := (&websocket.Upgrader{}).Upgrade(w, req, nil)
		if err != nil {
			t.Error(err)
			return
		}
		relay := &Relay{store: memory, attempt: sess, owner: owner, llm: ai, observationTicks: h.ticks, activityClock: func() time.Time { return base.Add(time.Duration(h.seconds.Load()) * time.Second) }}
		sections := []Section{{ID: "work", Kind: kind, Title: "Working"}, {ID: "review", Kind: "core", Title: "Discussion"}, {ID: "wrap", Kind: "wrap", Title: "Wrap"}}
		if native {
			relay.apiKey = "synthetic-key"
			relay.liveModel = "synthetic-live-model"
			relay.runGemini(conn, sess.ID, corpus.Question{}, conversationPolicy, "aoede", sections, 30)
		} else {
			relay.runText(conn, sess.ID, conversationPolicy, sections)
		}
	}))
	t.Cleanup(server.Close)
	h.client, _, err = websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http"), nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = h.client.Close() })
	_ = h.client.SetReadDeadline(time.Now().Add(5 * time.Second))
	h.read("ready")
	return h
}
func (h *observationHarness) send(m clientMsg) {
	h.t.Helper()
	if e := h.client.WriteJSON(m); e != nil {
		h.t.Fatal(e)
	}
}
func (h *observationHarness) read(kind string) serverMsg {
	h.t.Helper()
	for {
		var m serverMsg
		if e := h.client.ReadJSON(&m); e != nil {
			h.t.Fatal(e)
		}
		if m.Type == kind {
			return m
		}
		if m.Type == "say" || m.Type == "error" {
			h.t.Fatalf("unexpected %s while waiting for %s: %+v", m.Type, kind, m)
		}
	}
}
func (h *observationHarness) barrier() {
	h.send(clientMsg{Type: "user_text", Text: "Prior answer", EventID: "barrier"})
	h.read("ack")
}
func (h *observationHarness) review(c *reviewCapture, second int64) capturedReview {
	h.t.Helper()
	h.seconds.Store(second)
	deadline := time.NewTimer(time.Second)
	defer deadline.Stop()
	tick := time.NewTicker(5 * time.Millisecond)
	defer tick.Stop()
	h.ticks <- time.Now()
	for {
		select {
		case call := <-c.calls:
			return call
		case <-tick.C:
			select {
			case h.ticks <- time.Now():
			default:
			}
		case <-deadline.C:
			h.t.Fatal("server review did not start")
			return capturedReview{}
		}
	}
}
func (h *observationHarness) finish() []store.Turn {
	h.t.Helper()
	h.send(clientMsg{Type: "end"})
	h.read("saved")
	_ = h.client.WriteControl(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""), time.Now().Add(time.Second))
	select {
	case <-h.done:
	case <-time.After(time.Second):
		h.t.Fatal("relay did not close")
	}
	turns, e := h.memory.Transcript(context.Background(), h.sessionID)
	if e != nil {
		h.t.Fatal(e)
	}
	return turns
}
func probe(text string) ObservationDecision {
	return ObservationDecision{Action: "probe", Utterance: text, Evidence: "The latest implementation accesses its first item before testing length.", Notes: "Current question concerns input validation; no new probe has been delivered yet."}
}

func TestPeriodicTextReconnectKeepsDeliveredEarlyStage(t *testing.T) {
	c := &reviewCapture{calls: make(chan capturedReview, 8)}
	h := newObservationHarness(t, c, "coding")
	call := h.review(c, 30)
	call.reply <- reviewReply{decision: ObservationDecision{Action: "advance", Utterance: "Let's discuss your design choice.", Evidence: "The candidate demonstrated the implementation."}}
	h.read("say")
	h.read("section")
	h.finish()
	session, err := h.memory.GetSession(context.Background(), h.sessionID)
	if err != nil || session.Phase != "section:review" {
		t.Fatalf("successful advancement not persisted: %+v %v", session, err)
	}
	resumed := resumeObservationHarness(t, c, "coding", false, h.memory, h.sessionID)
	call = resumed.review(c, 30)
	if call.input.Stage.ID != "review" || call.input.NextStage == nil || call.input.NextStage.ID != "wrap" {
		t.Fatalf("reconnect reopened an already completed stage: %+v", call.input)
	}
	call.reply <- reviewReply{decision: ObservationDecision{Action: "wait"}}
	resumed.finish()
}

func TestPeriodicTextObservationInspectsLatestWorkAndAdvances(t *testing.T) {
	for _, kind := range []string{"coding", "design", "lld"} {
		t.Run(kind, func(t *testing.T) {
			c := &reviewCapture{calls: make(chan capturedReview, 8)}
			h := newObservationHarness(t, c, kind)
			h.send(clientMsg{Type: "canvas", Text: "old draft"})
			h.send(clientMsg{Type: "canvas", Text: "latest code and diagram"})
			h.send(clientMsg{Type: "nudge"})
			h.barrier()
			call := h.review(c, 30)
			if call.input.Workspace != "latest code and diagram" || len(call.input.History) != 2 || call.input.Stage.ID != "work" {
				t.Fatalf("wrong observation: %+v", call.input)
			}
			call.reply <- reviewReply{decision: probe("Trace your current implementation for an empty input.")}
			if got := h.read("say").Text; got != "Trace your current implementation for an empty input." {
				t.Fatal(got)
			}
			call = h.review(c, 60)
			call.reply <- reviewReply{decision: ObservationDecision{Action: "advance", Utterance: "Let's discuss one important design choice.", Evidence: "The candidate supplied a coherent implementation and validation plan.", Notes: "Implementation is covered; discussion is next."}}
			h.read("say")
			if stage := h.read("section"); stage.Index != 1 || stage.Title != "Discussion" {
				t.Fatalf("semantic advance not applied: %+v", stage)
			}
			call = h.review(c, 90)
			if call.input.Stage.ID != "review" || call.input.NextStage == nil || call.input.NextStage.ID != "wrap" {
				t.Fatalf("stage regressed: %+v", call.input)
			}
			call.reply <- reviewReply{decision: ObservationDecision{Action: "wait", Notes: "Let the candidate answer the current question."}}
			turns := h.finish()
			if len(turns) != 4 {
				t.Fatalf("observation context entered transcript: %+v", turns)
			}
		})
	}
}

func TestPeriodicTextReviewContinuesWhileEditingAndHonorsExplicitFloor(t *testing.T) {
	c := &reviewCapture{calls: make(chan capturedReview, 8)}
	h := newObservationHarness(t, c, "coding")
	h.seconds.Store(30)
	h.send(clientMsg{Type: "workspace_activity"})
	h.send(clientMsg{Type: "canvas", Text: "unfinished work"})
	h.barrier()
	call := h.review(c, 30)
	if call.input.QuietSeconds != 0 || call.input.CandidateWorking {
		t.Fatalf("editing became explicit floor hold: %+v", call.input)
	}
	call.reply <- reviewReply{decision: ObservationDecision{Action: "wait", Notes: "Draft is incomplete; no question has been asked."}}
	h.send(clientMsg{Type: "user_text", Text: "Let me code the solution.", EventID: "working"})
	h.read("ack")
	call = h.review(c, 60)
	if !call.input.CandidateWorking {
		t.Fatal("explicit floor hold lost")
	}
	call.reply <- reviewReply{decision: probe("This should never be delivered.")}
	turns := h.finish()
	if len(turns) != 3 {
		t.Fatalf("working candidate interrupted: %+v", turns)
	}
}

func TestPeriodicTextReviewFailureIsSilentAndNextTickRetries(t *testing.T) {
	c := &reviewCapture{calls: make(chan capturedReview, 8)}
	h := newObservationHarness(t, c, "coding")
	call := h.review(c, 30)
	call.reply <- reviewReply{err: context.DeadlineExceeded}
	call = h.review(c, 60)
	call.reply <- reviewReply{decision: probe("What happens for an empty input?")}
	h.read("say")
	if turns := h.finish(); len(turns) != 3 {
		t.Fatalf("failed observation persisted: %+v", turns)
	}
}

func TestPeriodicTextReviewNeverDeliversAStaleTurn(t *testing.T) {
	c := &reviewCapture{calls: make(chan capturedReview, 8), ignoreCancel: true}
	h := newObservationHarness(t, c, "coding")
	call := h.review(c, 30)
	h.send(clientMsg{Type: "canvas", Text: "corrected implementation"})
	h.send(clientMsg{Type: "user_text", Text: "My corrected solution handles empty input.", EventID: "answer"})
	h.read("ack")
	h.read("say")
	select {
	case <-call.ctx.Done():
	case <-time.After(time.Second):
		t.Fatal("optional review did not cancel for submitted answer")
	}
	call.reply <- reviewReply{decision: probe("STALE QUESTION")}
	turns := h.finish()
	for _, turn := range turns {
		if strings.Contains(turn.Text, "STALE") {
			t.Fatal("stale question persisted")
		}
	}
}

func TestOfflineDemoAndLegacyNudgesStaySilent(t *testing.T) {
	h := newObservationHarness(t, llm.NewStub(), "coding")
	h.seconds.Store(30)
	h.ticks <- time.Now()
	h.send(clientMsg{Type: "nudge"})
	h.barrier()
	if turns := h.finish(); len(turns) != 2 {
		t.Fatalf("offline timer invented a question: %+v", turns)
	}
}

type delayedAnswerCapture struct {
	reviewCapture
	started chan context.Context
	release chan struct{}
}

func (c *delayedAnswerCapture) Generate(ctx context.Context, req llm.GenerateRequest) (string, error) {
	if req.JSONSchema != nil {
		return c.reviewCapture.Generate(ctx, req)
	}
	c.started <- ctx
	<-c.release
	return "STALE BUG PROBE", nil
}
func TestNormalTextReplyCannotProbeCodeCorrectedDuringGeneration(t *testing.T) {
	c := &delayedAnswerCapture{reviewCapture: reviewCapture{calls: make(chan capturedReview, 4)}, started: make(chan context.Context, 1), release: make(chan struct{})}
	h := newObservationHarness(t, c, "coding")
	h.send(clientMsg{Type: "user_text", Text: "My implementation is done.", EventID: "done"})
	h.read("ack")
	var call context.Context
	select {
	case call = <-c.started:
	case <-time.After(time.Second):
		t.Fatal("normal answer generation did not start")
	}
	h.send(clientMsg{Type: "canvas", Text: "Corrected implementation and complete helper."})
	h.barrier()
	select {
	case <-call.Done():
	case <-time.After(time.Second):
		t.Fatal("edit did not cancel obsolete direct reply")
	}
	close(c.release)
	review := h.review(&c.reviewCapture, 30)
	if review.input.Workspace != "Corrected implementation and complete helper." {
		t.Fatal("fresh review lost corrections")
	}
	review.reply <- reviewReply{decision: ObservationDecision{Action: "wait"}}
	for _, turn := range h.finish() {
		if strings.Contains(turn.Text, "STALE") {
			t.Fatal("stale ordinary reply entered transcript")
		}
	}
}
