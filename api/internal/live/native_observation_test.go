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
)

type nativeObservedFrame struct {
	text     string
	complete bool
	realtime bool
}
type nativeObservationProvider struct {
	t         *testing.T
	frames    chan nativeObservedFrame
	responses chan map[string]any
}

// Real browser/relay/provider sockets exercise delivery ordering, while only
// the optional reasoner and provider responses are controlled by the test.
func newNativeObservationProvider(t *testing.T) *nativeObservationProvider {
	t.Helper()
	p := &nativeObservationProvider{t: t, frames: make(chan nativeObservedFrame, 64), responses: make(chan map[string]any, 16)}
	provider := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		conn, err := (&websocket.Upgrader{}).Upgrade(w, req, nil)
		if err != nil {
			t.Error(err)
			return
		}
		defer conn.Close()
		if _, _, err = conn.ReadMessage(); err != nil {
			return
		}
		if err = conn.WriteJSON(map[string]any{"setupComplete": map[string]any{}}); err != nil {
			return
		}
		done := make(chan struct{})
		defer close(done)
		go func() {
			for {
				select {
				case <-done:
					return
				case response := <-p.responses:
					if conn.WriteJSON(map[string]any{"serverContent": response}) != nil {
						return
					}
				}
			}
		}()
		for {
			var msg struct {
				ClientContent *struct {
					TurnComplete bool `json:"turnComplete"`
					Turns        []struct {
						Parts []struct {
							Text string `json:"text"`
						} `json:"parts"`
					} `json:"turns"`
				} `json:"clientContent"`
				RealtimeInput *struct {
					Text string `json:"text"`
				} `json:"realtimeInput"`
			}
			if conn.ReadJSON(&msg) != nil {
				return
			}
			if msg.ClientContent != nil {
				frame := nativeObservedFrame{complete: msg.ClientContent.TurnComplete}
				for _, turn := range msg.ClientContent.Turns {
					for _, part := range turn.Parts {
						frame.text += part.Text
					}
				}
				p.frames <- frame
			}
			if msg.RealtimeInput != nil && msg.RealtimeInput.Text != "" {
				p.frames <- nativeObservedFrame{text: msg.RealtimeInput.Text, realtime: true}
			}
		}
	}))
	t.Cleanup(provider.Close)
	original := websocket.DefaultDialer
	dialer := *original
	dialer.Proxy = nil
	certificates := x509.NewCertPool()
	certificates.AddCert(provider.Certificate())
	dialer.NetDialTLSContext = func(ctx context.Context, network, address string) (net.Conn, error) {
		if address != "generativelanguage.googleapis.com:443" {
			t.Errorf("unexpected provider %s", address)
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
	t.Cleanup(func() { websocket.DefaultDialer = original })
	return p
}

func (p *nativeObservationProvider) until(contains string, allowSpeech bool) nativeObservedFrame {
	p.t.Helper()
	deadline := time.NewTimer(time.Second)
	defer deadline.Stop()
	for {
		select {
		case frame := <-p.frames:
			if !allowSpeech && frame.complete {
				p.t.Fatalf("unexpected native speech request: %s", frame.text)
			}
			if strings.Contains(frame.text, contains) {
				return frame
			}
		case <-deadline.C:
			p.t.Fatalf("provider did not receive %q", contains)
			return nativeObservedFrame{}
		}
	}
}

func TestPeriodicNativeObservationWaitsForPendingResponseBeforeFirstAudio(t *testing.T) {
	p := newNativeObservationProvider(t)
	c := &reviewCapture{calls: make(chan capturedReview, 8)}
	h := newObservationHarnessMode(t, c, "coding", true)
	h.send(clientMsg{Type: "canvas", Text: "latest code has validated input"})
	h.barrier()
	call := h.review(c, 30)
	if call.input.Workspace != "latest code has validated input" {
		t.Fatal(call.input.Workspace)
	}
	call.reply <- reviewReply{decision: ObservationDecision{Action: "wait", Notes: "Candidate is still building the implementation."}}
	p.until("Candidate is still building", false)
	h.send(clientMsg{Type: "user_text", Text: "Can the input contain duplicate identifiers?", EventID: "clarification"})
	h.read("ack")
	if !p.until("duplicate identifiers", false).realtime {
		t.Fatal("clarification did not reach native turn taking")
	}
	// The native model has produced neither audio nor a transcript yet. The
	// observer can inspect privately, but must not enqueue another spoken turn.
	call = h.review(c, 60)
	call.reply <- reviewReply{decision: probe("Trace the current code for an empty list.")}
	call = h.review(c, 61)
	call.reply <- reviewReply{decision: ObservationDecision{Action: "wait", Notes: "The candidate's clarification is awaiting its native answer."}}
	p.until("clarification is awaiting", false)
	p.responses <- map[string]any{"outputTranscription": map[string]any{"text": "Yes, identifiers may repeat."}, "turnComplete": true}
	h.read("turn_complete")
	call = h.review(c, 90)
	call.reply <- reviewReply{decision: ObservationDecision{Action: "advance", Utterance: "Let's discuss the tradeoff you selected.", Evidence: "The implementation and edge cases have been explained."}}
	frame := p.until("PRIVATE DIRECTOR DECISION", true)
	if !frame.complete || !strings.Contains(frame.text, "tradeoff you selected") {
		t.Fatalf("bad native directive: %+v", frame)
	}
	if stage := h.read("section"); stage.Index != 1 {
		t.Fatalf("native stage did not advance: %+v", stage)
	}
	p.responses <- map[string]any{"outputTranscription": map[string]any{"text": "Let's discuss the tradeoff you selected."}, "turnComplete": true}
	h.read("turn_complete")
	turns := h.finish()
	if len(turns) != 5 {
		t.Fatalf("context or proposed speech polluted transcript: %+v", turns)
	}
	for _, turn := range turns {
		if strings.Contains(turn.Text, "PRIVATE") || strings.Contains(turn.Text, "empty list") || json.Valid([]byte(turn.Text)) {
			t.Fatalf("private/stale observer output was persisted: %+v", turn)
		}
	}
	session, err := h.memory.GetSession(context.Background(), h.sessionID)
	if err != nil || session.Phase != "section:review" {
		t.Fatalf("native stage not saved: %+v %v", session, err)
	}
	resumed := resumeObservationHarness(t, c, "coding", true, h.memory, h.sessionID)
	if stage := resumed.read("section"); stage.Index != 1 {
		t.Fatalf("native reconnect reopened completed work: %+v", stage)
	}
	call = resumed.review(c, 30)
	if call.input.Stage.ID != "review" {
		t.Fatalf("observer reopened work: %+v", call.input)
	}
	call.reply <- reviewReply{decision: ObservationDecision{Action: "wait"}}
	resumed.finish()
}
