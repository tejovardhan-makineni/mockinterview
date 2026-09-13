package live

import (
	"context"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/tejo/mockinterview-api/internal/corpus"
	"github.com/tejo/mockinterview-api/internal/llm"
	"github.com/tejo/mockinterview-api/internal/store"
	"github.com/tejo/mockinterview-api/internal/store/memstore"
)

type pacingCapture struct{ requests chan llm.GenerateRequest }

func (c *pacingCapture) Generate(_ context.Context, req llm.GenerateRequest) (string, error) {
	c.requests <- req
	return "What happened as a result?", nil
}
func (*pacingCapture) Stubbed() bool  { return false }
func (*pacingCapture) Info() llm.Info { return llm.Info{Provider: "test"} }

func TestTextReconnectUsesSessionPlanAndPreservesPendingQuestion(t *testing.T) {
	for _, tc := range []struct {
		name      string
		elapsed   time.Duration
		pending   bool
		wantStage string
	}{
		{"resume answer", 90 * time.Second, false, "Resume deep-dive"},
		{"core answer", 5 * time.Minute, false, "Main question"},
		{"pending question", 5 * time.Minute, true, "Main question"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ctx := context.Background()
			memory := memstore.New()
			user, err := memory.CreateUser(ctx, "pacing@example.test", "test-hash")
			if err != nil {
				t.Fatal(err)
			}
			started := time.Now().Add(-tc.elapsed)
			deadline := started.Add(30 * time.Minute)
			sess, err := memory.ReserveSession(ctx, store.Reservation{Session: store.Session{UserID: user.ID, Mode: "text", DurationMinutes: 30, Funding: "platform", StartedAt: &started, DeadlineAt: &deadline}, Identity: "pacing", Unlimited: true})
			if err != nil {
				t.Fatal(err)
			}
			owner := store.NewID()
			sess, err = memory.AcquireLive(ctx, sess.ID, owner)
			if err != nil {
				t.Fatal(err)
			}
			prior := []llm.Message{{Role: "model", Text: "What did you personally do?"}}
			if !tc.pending {
				prior = append(prior, llm.Message{Role: "user", Text: "I spoke to each colleague separately and agreed on a staged rollout."})
			}
			for _, turn := range prior {
				role := "candidate"
				if turn.Role == "model" {
					role = "interviewer"
				}
				if err = memory.AddTurn(ctx, sess.ID, role, turn.Text, 0, nil); err != nil {
					t.Fatal(err)
				}
			}
			focus := "Assess decisions during uncertainty"
			sections := SectionPlan(corpus.Question{Domain: "valuation"}, true, focus)
			capture := &pacingCapture{requests: make(chan llm.GenerateRequest, 3)}
			done := make(chan struct{})
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
				defer close(done)
				conn, e := (&websocket.Upgrader{}).Upgrade(w, req, nil)
				if e != nil {
					t.Error(e)
					return
				}
				relay := &Relay{store: memory, attempt: sess, owner: owner, llm: capture}
				relay.runText(conn, sess.ID, conversationPolicy, sections)
			}))
			defer server.Close()
			client, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http"), nil)
			if err != nil {
				t.Fatal(err)
			}
			defer client.Close()
			_ = client.SetReadDeadline(time.Now().Add(5 * time.Second))
			for {
				var msg serverMsg
				if err = client.ReadJSON(&msg); err != nil {
					t.Fatal(err)
				}
				if msg.Type == "ready" {
					break
				}
			}
			if tc.pending {
				select {
				case <-capture.requests:
					t.Fatal("reconnect generated another question before candidate answered")
				default:
				}
				answer := "I spoke to each colleague separately and agreed on a staged rollout."
				if err = client.WriteJSON(clientMsg{Type: "user_text", Text: answer, EventID: "answer-after-reconnect"}); err != nil {
					t.Fatal(err)
				}
				prior = append(prior, llm.Message{Role: "user", Text: answer})
			}
			select {
			case request := <-capture.requests:
				if !strings.Contains(request.System, "ACTIVE STAGE: "+tc.wantStage) {
					t.Fatalf("lost session stage: %s", request.System)
				}
				if tc.wantStage == "Main question" && !strings.Contains(request.System, focus) {
					t.Fatal("session's round focus lost on reconnect")
				}
				if !reflect.DeepEqual(request.Messages, prior) {
					t.Fatalf("reconnect lost answered evidence or repeated kickoff: %+v", request.Messages)
				}
			case <-time.After(5 * time.Second):
				t.Fatal("provider request missing")
			}
			_ = client.WriteJSON(clientMsg{Type: "end"})
			select {
			case <-done:
			case <-time.After(5 * time.Second):
				t.Fatal("text relay failed to exit")
			}
		})
	}
}
