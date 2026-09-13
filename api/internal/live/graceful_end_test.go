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

// Exercise the complete native relay with real browser/provider WebSockets.
// Replace only its outbound TLS dial with an in-process synthetic provider.
func TestGeminiEndDrainsTranscriptAndRemainsResumable(t *testing.T) {
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
		if err = conn.WriteJSON(map[string]any{"setupComplete": map[string]any{}}); err != nil {
			t.Error(err)
			return
		}
		stageEstablished := false
		for {
			var message map[string]json.RawMessage
			if err = conn.ReadJSON(&message); err != nil {
				return
			}
			if content := message["clientContent"]; content != nil {
				if strings.Contains(string(content), "ACTIVE STAGE: Current technical problem") {
					stageEstablished = true
					if !strings.Contains(string(content), "SERVER CLOCK:") || !strings.Contains(string(content), "WORKING STAGE") {
						t.Error("native stage cue omitted remaining time or working-stage guard")
					}
				}
				var value struct {
					TurnComplete bool `json:"turnComplete"`
				}
				_ = json.Unmarshal(content, &value)
				if value.TurnComplete {
					if !stageEstablished {
						t.Error("provider asked to speak before receiving the active stage")
					}
					if !strings.Contains(string(content), "FIRST QUESTION FOCUS") || !strings.Contains(string(content), "OPENING SETUP") {
						t.Error("voice kickoff did not use the shared layered opening")
					}
					_ = conn.WriteJSON(map[string]any{"serverContent": map[string]any{"outputTranscription": map[string]any{"text": "A final partial interviewer sentence."}}})
				}
			}
		}
	}))
	defer provider.Close()
	originalDialer := websocket.DefaultDialer
	dialer := *originalDialer
	dialer.Proxy = nil
	certificates := x509.NewCertPool()
	certificates.AddCert(provider.Certificate())
	dialer.NetDialTLSContext = func(ctx context.Context, network, address string) (net.Conn, error) {
		if address != "generativelanguage.googleapis.com:443" {
			t.Errorf("unexpected provider dial %s", address)
		}
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
	user, err := memory.CreateUser(ctx, "native-drain@example.test", "unused-test-hash")
	if err != nil {
		t.Fatal(err)
	}
	sess, err := memory.ReserveSession(ctx, store.Reservation{Session: store.Session{UserID: user.ID, Mode: "voice", DurationMinutes: 5, Funding: "platform"}, Identity: "native-drain", Unlimited: true})
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
		defer memory.ReleaseLive(context.Background(), sess.ID, owner)
		relay := &Relay{store: memory, attempt: sess, owner: owner, apiKey: "synthetic-test-key", liveModel: "synthetic-native-model"}
		sections := []Section{{ID: "core", Kind: "core", Title: "Current technical problem", Guidance: "Probe one unresolved risk."}}
		relay.runGemini(conn, sess.ID, corpus.Question{}, "Synthetic test", "aoede", sections, 5)
	}))
	defer server.Close()
	client, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http"), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	_ = client.SetReadDeadline(time.Now().Add(5 * time.Second))
	ready := false
	for {
		var msg serverMsg
		if err = client.ReadJSON(&msg); err != nil {
			t.Fatal(err)
		}
		if msg.Type == "ready" {
			ready = true
		}
		if msg.Type == "transcript" && msg.Streaming {
			break
		}
	}
	if !ready {
		t.Fatal("no native readiness event")
	}
	if err = client.WriteJSON(clientMsg{Type: "end"}); err != nil {
		t.Fatal(err)
	}
	saved := false
	for {
		var msg serverMsg
		err = client.ReadJSON(&msg)
		if err != nil {
			break
		}
		if msg.Type == "saved" {
			saved = true
		}
		if msg.Type == "error" {
			t.Fatalf("end error: %s", msg.Code)
		}
	}
	if !saved {
		t.Fatalf("socket closed without saved acknowledgment: %v", err)
	}
	if !websocket.IsCloseError(err, websocket.CloseNormalClosure) {
		t.Fatalf("saved must be followed by a normal WebSocket close, not raw TCP shutdown: %v", err)
	}
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("relay did not exit")
	}
	select {
	case <-providerDone:
	case <-time.After(time.Second):
		t.Fatal("provider connection leaked")
	}
	turns, err := memory.Transcript(ctx, sess.ID)
	if err != nil || len(turns) != 1 || turns[0].Text != "A final partial interviewer sentence." {
		t.Fatalf("final transcript not persisted: %+v %v", turns, err)
	}
	after, err := memory.GetSession(ctx, sess.ID)
	if err != nil || after.Status != "interrupted" {
		t.Fatalf("end finalized session instead of suspending: %+v %v", after, err)
	}
	if _, err = memory.AcquireLive(ctx, sess.ID, "reconnect-owner"); err != nil {
		t.Fatalf("ended socket is not resumable: %v", err)
	}
}
