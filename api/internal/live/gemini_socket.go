package live

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"google.golang.org/genai"
)

const geminiLiveEndpoint = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent"

// geminiSocket uses the provider's native wire schema and the SDK's message
// types. Owning the socket is necessary because SDK Live.Connect does not bind
// its dial or setup receive to context and exposes no read/write deadline seam.
// Every outbound message has a deadline and cancellation closes blocked reads.
// Only the fixed Gemini Developer API endpoint is used in production.
type geminiSocket struct {
	conn       *websocket.Conn
	mu         sync.Mutex
	stopCancel func() bool
}

func connectGemini(ctx context.Context, key, model string, cfg *genai.LiveConnectConfig) (*geminiSocket, error) {
	return dialGemini(ctx, geminiLiveEndpoint, key, model, cfg)
}
func dialGemini(ctx context.Context, endpoint, key, model string, cfg *genai.LiveConnectConfig) (*geminiSocket, error) {
	dialer := *websocket.DefaultDialer
	dialer.HandshakeTimeout = 20 * time.Second
	conn, _, err := dialer.DialContext(ctx, endpoint, http.Header{"X-Goog-Api-Key": []string{key}})
	if err != nil {
		return nil, errors.New("live provider connection unavailable")
	}
	s := &geminiSocket{conn: conn}
	s.stopCancel = context.AfterFunc(ctx, func() { _ = conn.Close() })
	success := false
	defer func() {
		if !success {
			_ = s.Close()
		}
	}()
	setupDeadline := time.Now().Add(20 * time.Second)
	if deadline, ok := ctx.Deadline(); ok && deadline.Before(setupDeadline) {
		setupDeadline = deadline
	}
	conn.SetReadLimit(16 << 20)
	_ = conn.SetReadDeadline(setupDeadline)
	if err = s.write(map[string]any{"setup": geminiSetup(model, cfg)}); err != nil {
		return nil, errors.New("live setup unavailable")
	}
	msg, err := s.Receive()
	if err != nil || msg.SetupComplete == nil {
		return nil, errors.New("live setup was not accepted")
	}
	_ = conn.SetReadDeadline(time.Time{})
	success = true
	return s, nil
}

// Keep this mapping explicit: setup generation fields belong under
// generationConfig, unlike the flat SDK LiveConnectConfig representation.
func geminiSetup(model string, c *genai.LiveConnectConfig) map[string]any {
	setup := map[string]any{"model": "models/" + strings.TrimPrefix(model, "models/"), "generationConfig": map[string]any{"responseModalities": c.ResponseModalities, "speechConfig": c.SpeechConfig}}
	if c.SystemInstruction != nil {
		setup["systemInstruction"] = c.SystemInstruction
	}
	if len(c.Tools) > 0 {
		setup["tools"] = c.Tools
	}
	if c.InputAudioTranscription != nil {
		setup["inputAudioTranscription"] = c.InputAudioTranscription
	}
	if c.OutputAudioTranscription != nil {
		setup["outputAudioTranscription"] = c.OutputAudioTranscription
	}
	if c.RealtimeInputConfig != nil {
		setup["realtimeInputConfig"] = c.RealtimeInputConfig
	}
	if c.ContextWindowCompression != nil {
		setup["contextWindowCompression"] = c.ContextWindowCompression
	}
	return setup
}
func (s *geminiSocket) write(value any) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	_ = s.conn.SetWriteDeadline(time.Now().Add(writeWait))
	return s.conn.WriteJSON(value)
}
func (s *geminiSocket) SendClientContent(v genai.LiveClientContentInput) error {
	return s.write(map[string]any{"clientContent": v})
}
func (s *geminiSocket) SendRealtimeInput(v genai.LiveRealtimeInput) error {
	return s.write(map[string]any{"realtimeInput": v})
}
func (s *geminiSocket) SendToolResponse(v genai.LiveToolResponseInput) error {
	return s.write(map[string]any{"toolResponse": v})
}
func (s *geminiSocket) Receive() (*genai.LiveServerMessage, error) {
	_, data, err := s.conn.ReadMessage()
	if err != nil {
		return nil, err
	}
	var envelope struct {
		Error json.RawMessage `json:"error"`
	}
	if json.Unmarshal(data, &envelope) != nil {
		return nil, errors.New("invalid live provider message")
	}
	if len(envelope.Error) > 0 && string(envelope.Error) != "null" {
		return nil, errors.New("live provider returned an error")
	}
	var msg genai.LiveServerMessage
	if json.Unmarshal(data, &msg) != nil {
		return nil, errors.New("invalid live provider content")
	}
	return &msg, nil
}
func (s *geminiSocket) Close() error {
	if s.stopCancel != nil {
		s.stopCancel()
	}
	return s.conn.Close()
}
