package live

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/tejo/mockinterview-api/internal/corpus"
	"github.com/tejo/mockinterview-api/internal/store"
	"github.com/tejo/mockinterview-api/internal/store/memstore"
)

// Exercise actual provider/browser frames: a provider that ignores a request to
// draw must not speak over the candidate, and snapshots must not elicit speech.
func TestNativeWorkingRequestWithholdsFollowupAndResumesOnCandidateTurn(t *testing.T) {
	for _, boundary := range []string{"provider ignored working request", "input transcription finished", "waiting for input"} {
		t.Run(boundary, func(t *testing.T) {
			testNativeWorkingRequest(t, boundary, Section{ID: "core", Kind: "design", Title: "System design"}, "Why don't you let me draw the system design?", "client → queue → stream processor → analytics store")
		})
	}
}

func TestNativeWorkingRequestsAcrossModalities(t *testing.T) {
	for _, tc := range []struct {
		name, boundary, request, workspace string
		section                            Section
	}{
		{"coding", "input transcription finished", "Let me code the solution.", "return result;", Section{Kind: "coding", Title: "Coding"}},
		{"written response", "waiting for input", "Let me draft the response.", "Draft recommendation with supporting evidence", Section{Kind: "core", Title: "Written response", CandidateLed: true}},
		{"case calculation", "input transcription finished", "Let me calculate the numbers.", "Revenue = volume × price", Section{Kind: "case", Title: "Case"}},
		{"clinical notes", "provider ignored working request", "Let me review the case.", "History and differential notes", Section{Kind: "clinical", Title: "Clinical reasoning"}},
		{"behavioral notes", "waiting for input", "Let me think about it.", "Situation, choices, result", Section{Kind: "behavioral", Title: "Behavioral"}},
		{"custom task", "input transcription finished", "Let me read the prompt.", "Custom task notes", Section{Kind: "core", Title: "Custom practice"}},
	} {
		t.Run(tc.name, func(t *testing.T) { testNativeWorkingRequest(t, tc.boundary, tc.section, tc.request, tc.workspace) })
	}
}

func testNativeWorkingRequest(t *testing.T, boundary string, section Section, workingRequest, workspace string) {
	providerDone := make(chan struct{})
	provider := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		defer close(providerDone)
		conn, err := (&websocket.Upgrader{}).Upgrade(w, req, nil)
		if err != nil {
			t.Error(err)
			return
		}
		defer conn.Close()
		if _, _, err = conn.ReadMessage(); err != nil {
			t.Error(err)
			return
		}
		_ = conn.WriteJSON(map[string]any{"setupComplete": map[string]any{}})
		kickoffs, snapshots, withheld := 0, 0, false
		for {
			var frame map[string]json.RawMessage
			if conn.ReadJSON(&frame) != nil {
				return
			}
			if content := frame["clientContent"]; content != nil {
				var payload struct {
					TurnComplete bool `json:"turnComplete"`
				}
				_ = json.Unmarshal(content, &payload)
				if strings.Contains(string(content), "Workspace observation only") {
					snapshots++
					if payload.TurnComplete {
						t.Error("workspace snapshot forced a response")
					}
				}
				if strings.Contains(string(content), "previous model response was not delivered") {
					withheld = true
				}
				if payload.TurnComplete {
					kickoffs++
					if kickoffs > 1 {
						t.Error("activity or premature nudge elicited another provider turn")
					}
					_ = conn.WriteJSON(map[string]any{"serverContent": map[string]any{"inputTranscription": map[string]any{"text": workingRequest, "finished": boundary == "input transcription finished"}}})
					if boundary == "provider ignored working request" {
						_ = conn.WriteJSON(map[string]any{"serverContent": map[string]any{
							"outputTranscription": map[string]any{"text": "How do you handle watermarks?"},
							"modelTurn":           map[string]any{"parts": []any{map[string]any{"inlineData": map[string]any{"mimeType": "audio/pcm;rate=24000", "data": "AAE="}}}},
							"turnComplete":        true,
						}})
					} else if boundary == "waiting for input" {
						_ = conn.WriteJSON(map[string]any{"serverContent": map[string]any{"waitingForInput": true}})
					} // An obedient silent provider need not emit a model TurnComplete.
				}
			}
			if frame["realtimeInput"] != nil {
				if snapshots != 1 || boundary == "provider ignored working request" && !withheld {
					t.Errorf("missing observation or delivery correction: snapshots=%d withheld=%v", snapshots, withheld)
				}
				_ = conn.WriteJSON(map[string]any{"serverContent": map[string]any{"inputTranscription": map[string]any{"text": "I am ready to discuss my design.", "finished": true}}})
				_ = conn.WriteJSON(map[string]any{"serverContent": map[string]any{"outputTranscription": map[string]any{"text": "Let's discuss your completed design."}, "turnComplete": true}})
			}
		}
	}))
	defer provider.Close()
	originalDialer := websocket.DefaultDialer
	dialer := *originalDialer
	dialer.Proxy = nil
	certificates := x509.NewCertPool()
	certificates.AddCert(provider.Certificate())
	dialer.NetDialTLSContext = func(ctx context.Context, network, _ string) (net.Conn, error) {
		conn, err := (&net.Dialer{}).DialContext(ctx, network, provider.Listener.Addr().String())
		if err != nil {
			return nil, err
		}
		secure := tls.Client(conn, &tls.Config{RootCAs: certificates, ServerName: "127.0.0.1"})
		if err = secure.HandshakeContext(ctx); err != nil {
			_ = conn.Close()
			return nil, err
		}
		return secure, nil
	}
	websocket.DefaultDialer = &dialer
	defer func() { websocket.DefaultDialer = originalDialer }()
	ctx := context.Background()
	memory := memstore.New()
	user, err := memory.CreateUser(ctx, "working@example.test", "unused-test-hash")
	if err != nil {
		t.Fatal(err)
	}
	sess, err := memory.ReserveSession(ctx, store.Reservation{Session: store.Session{UserID: user.ID, Mode: "voice", DurationMinutes: 5, Funding: "platform"}, Identity: "working", Unlimited: true})
	if err != nil {
		t.Fatal(err)
	}
	owner := store.NewID()
	sess, err = memory.AcquireLive(ctx, sess.ID, owner)
	if err != nil {
		t.Fatal(err)
	}
	done := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		defer close(done)
		conn, err := (&websocket.Upgrader{}).Upgrade(w, req, nil)
		if err != nil {
			t.Error(err)
			return
		}
		defer conn.Close()
		relay := &Relay{store: memory, attempt: sess, owner: owner, apiKey: "synthetic-key", liveModel: "synthetic-model"}
		relay.runGemini(conn, sess.ID, corpus.Question{}, "Synthetic interview", "aoede", []Section{section}, 5)
	}))
	defer server.Close()
	client, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http"), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	_ = client.SetReadDeadline(time.Now().Add(5 * time.Second))
	resumed, heardReply := false, false
	for {
		kind, data, err := client.ReadMessage()
		if err != nil {
			t.Fatal(err)
		}
		if kind == websocket.BinaryMessage {
			t.Fatal("provider spoke over explicit drawing request")
		}
		var msg serverMsg
		if err = json.Unmarshal(data, &msg); err != nil {
			t.Fatal(err)
		}
		if msg.Role == "interviewer" {
			if strings.Contains(msg.Text, "watermarks") || !resumed {
				t.Fatalf("unsolicited question delivered: %s", msg.Text)
			}
			heardReply = strings.Contains(msg.Text, "completed design")
		}
		if heardReply && msg.Type == "turn_complete" {
			break
		}
		if !resumed && (msg.Type == "turn_complete" || boundary != "provider ignored working request" && msg.Type == "transcript" && msg.Role == "candidate" && !msg.Streaming) {
			for _, frame := range []clientMsg{
				{Type: "workspace_activity"},
				{Type: "canvas", Text: workspace},
				{Type: "nudge"},
			} {
				if err = client.WriteJSON(frame); err != nil {
					t.Fatal(err)
				}
			}
			// Synthetic PCM asks the fake provider to transcribe a NEW utterance.
			// A typed answer would bypass the native utterance-boundary bug.
			if err = client.WriteMessage(websocket.BinaryMessage, []byte{0, 1}); err != nil {
				t.Fatal(err)
			}
			resumed = true
		}
	}
	// Legacy nudges are ignored; only the server schedules semantic reviews.
	_ = client.WriteJSON(clientMsg{Type: "nudge"})
	_ = client.WriteJSON(clientMsg{Type: "end"})
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("relay did not close")
	}
	select {
	case <-providerDone:
	case <-time.After(time.Second):
		t.Fatal("provider connection leaked")
	}
	turns, err := memory.Transcript(ctx, sess.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(turns) != 3 || turns[0].Text != workingRequest || turns[1].Text != "I am ready to discuss my design." {
		t.Fatalf("utterance boundaries lost: %+v", turns)
	}
	for _, turn := range turns {
		if strings.Contains(turn.Text, "watermarks") {
			t.Fatal("withheld question persisted as spoken evidence")
		}
	}
}
