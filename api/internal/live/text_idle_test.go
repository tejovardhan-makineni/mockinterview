package live

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/tejo/mockinterview-api/internal/llm"
	"github.com/tejo/mockinterview-api/internal/store"
	"github.com/tejo/mockinterview-api/internal/store/memstore"
)

type idleCapture struct {
	mu        sync.Mutex
	requests  chan llm.GenerateRequest
	responses []string
}

func (c *idleCapture) Generate(_ context.Context, req llm.GenerateRequest) (string, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.requests <- req
	if len(c.responses) == 0 {
		return "Unexpected extra response", nil
	}
	response := c.responses[0]
	c.responses = c.responses[1:]
	return response, nil
}
func (*idleCapture) Stubbed() bool  { return false }
func (*idleCapture) Info() llm.Info { return llm.Info{Provider: "test"} }

func TestTextIdleCheckAcrossInterviewTypes(t *testing.T) {
	for _, tc := range []struct {
		name    string
		section Section
		quiet   time.Duration
	}{
		{"behavioral", Section{Kind: "behavioral"}, 45 * time.Second},
		{"clinical discussion", Section{Kind: "clinical"}, 45 * time.Second},
		{"written response", Section{Kind: "core", CandidateLed: true}, time.Minute},
		{"case calculation", Section{Kind: "case"}, 45 * time.Second},
		{"custom practical work", Section{Kind: "core"}, 45 * time.Second},
		{"coding", Section{Kind: "coding"}, time.Minute},
		{"system design", Section{Kind: "design"}, time.Minute},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ctx := context.Background()
			memory := memstore.New()
			user, err := memory.CreateUser(ctx, "idle@example.test", "unused")
			if err != nil {
				t.Fatal(err)
			}
			sess, err := memory.ReserveSession(ctx, store.Reservation{Session: store.Session{UserID: user.ID, Mode: "text", DurationMinutes: 30, Funding: "platform"}, Identity: "idle", Unlimited: true})
			if err != nil {
				t.Fatal(err)
			}
			owner := store.NewID()
			sess, err = memory.AcquireLive(ctx, sess.ID, owner)
			if err != nil {
				t.Fatal(err)
			}
			if err = memory.AddTurn(ctx, sess.ID, "interviewer", "Describe your approach.", 0, nil); err != nil {
				t.Fatal(err)
			}
			base := time.Now()
			var seconds atomic.Int64
			capture := &idleCapture{requests: make(chan llm.GenerateRequest, 8), responses: []string{"¿Quieres más tiempo?", "```" + textIdleSilence + "```", "Entendido.", "¿Necesitas un momento?"}}
			done := make(chan struct{})
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
				defer close(done)
				conn, err := (&websocket.Upgrader{}).Upgrade(w, req, nil)
				if err != nil {
					t.Error(err)
					return
				}
				relay := &Relay{store: memory, attempt: sess, owner: owner, llm: capture, activityClock: func() time.Time { return base.Add(time.Duration(seconds.Load()) * time.Second) }}
				relay.runText(conn, sess.ID, "Run this interview in Spanish.\n"+conversationPolicy, []Section{tc.section})
			}))
			defer server.Close()
			client, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http"), nil)
			if err != nil {
				t.Fatal(err)
			}
			defer client.Close()
			_ = client.SetReadDeadline(time.Now().Add(5 * time.Second))
			send := func(msg clientMsg) {
				t.Helper()
				if err := client.WriteJSON(msg); err != nil {
					t.Fatal(err)
				}
			}
			read := func(kind string) serverMsg {
				t.Helper()
				for {
					var msg serverMsg
					if err := client.ReadJSON(&msg); err != nil {
						t.Fatal(err)
					}
					if msg.Type == kind {
						return msg
					}
					if msg.Type == "say" || msg.Type == "error" {
						t.Fatalf("unexpected response while waiting for %s: %+v", kind, msg)
					}
				}
			}
			request := func() llm.GenerateRequest {
				t.Helper()
				select {
				case req := <-capture.requests:
					return req
				case <-time.After(time.Second):
					t.Fatal("missing provider request")
					return llm.GenerateRequest{}
				}
			}
			read("ready")
			seconds.Store(int64(tc.quiet/time.Second) - 1)
			send(clientMsg{Type: "nudge"})
			read("nudge_deferred")
			seconds.Store(int64(tc.quiet / time.Second))
			send(clientMsg{Type: "nudge"})
			if got := read("say").Text; got != "¿Quieres más tiempo?" {
				t.Fatalf("check-in was not provider-localized: %q", got)
			}
			req := request()
			if !strings.Contains(req.System, "Run this interview in Spanish.") || !strings.Contains(req.System, textIdleInstruction) || req.Messages[len(req.Messages)-1].Text != idleCheckInstruction {
				t.Fatal("idle decision lost language, silence contract or neutral scope")
			}
			seconds.Store(600)
			send(clientMsg{Type: "nudge"})
			read("nudge_deferred") // cannot rearm itself
			send(clientMsg{Type: "canvas", Text: "old response draft"})
			send(clientMsg{Type: "workspace_activity"})
			send(clientMsg{Type: "canvas", Text: "revised written calculation and notes"})
			send(clientMsg{Type: "nudge"})
			read("nudge_deferred") // activity processed at 600
			seconds.Store(659)
			send(clientMsg{Type: "nudge"})
			read("nudge_deferred")
			seconds.Store(660)
			send(clientMsg{Type: "nudge"})
			req = request()
			if !strings.Contains(req.System, "revised written calculation and notes") || strings.Contains(req.System, "old response draft") {
				t.Fatal("check-in did not inspect latest workspace")
			}
			send(clientMsg{Type: "nudge"})
			read("nudge_deferred") // [[WAIT]] produced no caption
			send(clientMsg{Type: "user_text", Text: "Let me review the case.", EventID: "working"})
			read("ack")
			seconds.Store(1200)
			send(clientMsg{Type: "nudge"}) // explicit floorhold survives silence
			send(clientMsg{Type: "user_text", Text: "My completed explanation is ready.", EventID: "completed"})
			read("ack")
			if got := read("say").Text; got != "Entendido." {
				t.Fatalf("working request elicited an extra response: %q", got)
			}
			req = request()
			if req.Messages[len(req.Messages)-1].Text != "My completed explanation is ready." {
				t.Fatal("explicit floorhold was lost")
			}
			for _, msg := range req.Messages {
				if msg.Text == idleCheckInstruction || strings.Contains(msg.Text, textIdleSilence) {
					t.Fatal("transient idle instruction or silence marker leaked into conversation history")
				}
			}
			seconds.Store(1200 + int64(tc.quiet/time.Second))
			send(clientMsg{Type: "nudge"})
			if got := read("say").Text; got != "¿Necesitas un momento?" {
				t.Fatalf("candidate response did not rearm check-in: %q", got)
			}
			request()
			send(clientMsg{Type: "end"})
			read("saved")
			select {
			case <-done:
			case <-time.After(time.Second):
				t.Fatal("relay did not close")
			}
			select {
			case <-capture.requests:
				t.Fatal("unexpected extra provider call")
			default:
			}
			turns, err := memory.Transcript(ctx, sess.ID)
			if err != nil {
				t.Fatal(err)
			}
			if len(turns) != 6 {
				t.Fatalf("idle marker/context affected saved conversation: %+v", turns)
			}
			for _, turn := range turns {
				if turn.Text == textIdleSilence || turn.Text == idleCheckInstruction {
					t.Fatal("transport-only idle context persisted")
				}
			}
		})
	}
}

// The first optional request deliberately ignores cancellation until released,
// emulating a delayed provider response that must never become a stale prompt.
type delayedIdleCapture struct {
	started   chan context.Context
	release   chan struct{}
	returned  chan struct{}
	idleCalls atomic.Int64
	failFirst bool
}

func (c *delayedIdleCapture) Generate(ctx context.Context, req llm.GenerateRequest) (string, error) {
	if !strings.Contains(req.System, textIdleInstruction) {
		return "Your completed response was heard.", nil
	}
	if c.idleCalls.Add(1) > 1 {
		return "Would you like a moment?", nil
	}
	c.started <- ctx
	<-c.release
	defer close(c.returned)
	if c.failFirst {
		return "", context.DeadlineExceeded
	}
	return "STALE OPTIONAL CHECK-IN", nil
}
func (*delayedIdleCapture) Stubbed() bool  { return false }
func (*delayedIdleCapture) Info() llm.Info { return llm.Info{Provider: "test"} }

type textIdleHarness struct {
	t         *testing.T
	client    *websocket.Conn
	seconds   atomic.Int64
	memory    *memstore.Mem
	sessionID string
	done      chan struct{}
}

func newTextIdleHarness(t *testing.T, ai llm.Client) *textIdleHarness {
	t.Helper()
	ctx := context.Background()
	memory := memstore.New()
	user, err := memory.CreateUser(ctx, "delayed-idle@example.test", "unused")
	if err != nil {
		t.Fatal(err)
	}
	sess, err := memory.ReserveSession(ctx, store.Reservation{Session: store.Session{UserID: user.ID, Mode: "text", DurationMinutes: 30, Funding: "platform"}, Identity: "delayed-idle", Unlimited: true})
	if err != nil {
		t.Fatal(err)
	}
	owner := store.NewID()
	sess, err = memory.AcquireLive(ctx, sess.ID, owner)
	if err != nil {
		t.Fatal(err)
	}
	if err = memory.AddTurn(ctx, sess.ID, "interviewer", "Describe your approach.", 0, nil); err != nil {
		t.Fatal(err)
	}
	h := &textIdleHarness{t: t, memory: memory, sessionID: sess.ID, done: make(chan struct{})}
	base := time.Now()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		defer close(h.done)
		conn, err := (&websocket.Upgrader{}).Upgrade(w, req, nil)
		if err != nil {
			t.Error(err)
			return
		}
		relay := &Relay{store: memory, attempt: sess, owner: owner, llm: ai, activityClock: func() time.Time { return base.Add(time.Duration(h.seconds.Load()) * time.Second) }}
		relay.runText(conn, sess.ID, conversationPolicy, []Section{{Kind: "behavioral"}})
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
func (h *textIdleHarness) send(message clientMsg) {
	h.t.Helper()
	if err := h.client.WriteJSON(message); err != nil {
		h.t.Fatal(err)
	}
}
func (h *textIdleHarness) read(kind string) serverMsg {
	h.t.Helper()
	for {
		var msg serverMsg
		if err := h.client.ReadJSON(&msg); err != nil {
			h.t.Fatal(err)
		}
		if msg.Type == kind {
			return msg
		}
		if msg.Type == "say" || msg.Type == "error" {
			h.t.Fatalf("unexpected output while waiting for %s: %+v", kind, msg)
		}
	}
}
func (h *textIdleHarness) finish() []store.Turn {
	h.t.Helper()
	h.send(clientMsg{Type: "end"})
	h.read("saved")
	select {
	case <-h.done:
	case <-time.After(time.Second):
		h.t.Fatal("text relay did not close")
	}
	turns, err := h.memory.Transcript(context.Background(), h.sessionID)
	if err != nil {
		h.t.Fatal(err)
	}
	return turns
}

func TestTextOptionalCheckInFailureKeepsInterviewOpenAndDefersRetry(t *testing.T) {
	provider := &delayedIdleCapture{started: make(chan context.Context, 1), release: make(chan struct{}), returned: make(chan struct{}), failFirst: true}
	h := newTextIdleHarness(t, provider)
	h.seconds.Store(45)
	h.send(clientMsg{Type: "nudge"})
	select {
	case <-provider.started:
	case <-time.After(time.Second):
		t.Fatal("check-in did not start")
	}
	close(provider.release)
	h.read("nudge_deferred") // no terminal error or disconnect
	h.seconds.Store(89)
	h.send(clientMsg{Type: "nudge"})
	h.read("nudge_deferred")
	if provider.idleCalls.Load() != 1 {
		t.Fatal("failed optional call retried before quiet interval")
	}
	h.seconds.Store(90)
	h.send(clientMsg{Type: "nudge"})
	if got := h.read("say").Text; got != "Would you like a moment?" {
		t.Fatal(got)
	}
	h.send(clientMsg{Type: "user_text", Text: "Here is my completed answer.", EventID: "answer"})
	h.read("ack")
	if got := h.read("say").Text; got != "Your completed response was heard." {
		t.Fatal(got)
	}
	turns := h.finish()
	if len(turns) != 4 {
		t.Fatalf("failure produced a persisted turn: %+v", turns)
	}
}

func TestTextOptionalCheckInCannotInterruptResumedCandidate(t *testing.T) {
	for _, activity := range []string{"workspace edit", "candidate answer"} {
		t.Run(activity, func(t *testing.T) {
			provider := &delayedIdleCapture{started: make(chan context.Context, 1), release: make(chan struct{}), returned: make(chan struct{})}
			h := newTextIdleHarness(t, provider)
			h.seconds.Store(45)
			h.send(clientMsg{Type: "nudge"})
			var call context.Context
			select {
			case call = <-provider.started:
			case <-time.After(time.Second):
				t.Fatal("check-in did not start")
			}
			if activity == "workspace edit" {
				h.send(clientMsg{Type: "workspace_activity"})
				h.send(clientMsg{Type: "canvas", Text: "The candidate resumed drafting their response."})
				h.send(clientMsg{Type: "nudge"})
				h.read("nudge_deferred")
			}
			h.send(clientMsg{Type: "user_text", Text: "Here is my completed response.", EventID: "resumed"})
			h.read("ack")
			if got := h.read("say").Text; got != "Your completed response was heard." {
				t.Fatal(got)
			}
			// Both edit processing and the actual answer completed while the
			// optional provider request was still blocked.
			select {
			case <-call.Done():
			case <-time.After(time.Second):
				t.Fatal("candidate activity did not cancel the optional call")
			}
			close(provider.release)
			select {
			case <-provider.returned:
			case <-time.After(time.Second):
				t.Fatal("delayed provider did not return")
			}
			h.send(clientMsg{Type: "nudge"})
			h.read("nudge_deferred")
			turns := h.finish()
			if len(turns) != 3 {
				t.Fatalf("stale check-in became a spoken turn: %+v", turns)
			}
			for _, turn := range turns {
				if strings.Contains(turn.Text, "STALE") {
					t.Fatal("stale optional check-in persisted")
				}
			}
		})
	}
}

func TestTextOfflineStubDoesNotTurnSilenceIntoAnAssessmentQuestion(t *testing.T) {
	// Exercise the real deterministic demo. Its normal director responses are
	// assessment questions, so an idle request must not advance that sequence.
	h := newTextIdleHarness(t, llm.NewStub())
	h.seconds.Store(45)
	h.send(clientMsg{Type: "nudge"})
	if err := h.client.SetReadDeadline(time.Now().Add(100 * time.Millisecond)); err != nil {
		t.Fatal(err)
	}
	for {
		var msg serverMsg
		err := h.client.ReadJSON(&msg)
		if err != nil {
			if timeout, ok := err.(interface{ Timeout() bool }); !ok || !timeout.Timeout() {
				t.Fatalf("expected silent open connection, got %v", err)
			}
			break
		}
		if msg.Type == "say" || msg.Type == "error" {
			t.Fatalf("offline silence became an assessment turn: %+v", msg)
		}
	}
	// A websocket read timeout makes that reader unusable. Close explicitly,
	// then check storage after the relay has released all interview work.
	_ = h.client.Close()
	select {
	case <-h.done:
	case <-time.After(time.Second):
		t.Fatal("offline relay did not close")
	}
	turns, err := h.memory.Transcript(context.Background(), h.sessionID)
	if err != nil {
		t.Fatal(err)
	}
	if len(turns) != 1 || turns[0].Text != "Describe your approach." {
		t.Fatalf("offline idle request created a saved turn: %+v", turns)
	}
}
