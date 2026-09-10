package live

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"google.golang.org/genai"
)

func TestGeminiSocketWireAndCancellation(t *testing.T) {
	frames := make(chan map[string]any, 4)
	serverDone := make(chan struct{})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer close(serverDone)
		if r.Header.Get("X-Goog-Api-Key") != "personal-test-key" {
			t.Error("key missing from header")
		}
		if r.URL.RawQuery != "" {
			t.Error("key must not travel in URL")
		}
		conn, e := (&websocket.Upgrader{}).Upgrade(w, r, nil)
		if e != nil {
			t.Error(e)
			return
		}
		defer conn.Close()
		var setup map[string]any
		if e = conn.ReadJSON(&setup); e != nil {
			t.Error(e)
			return
		}
		frames <- setup
		_ = conn.WriteJSON(map[string]any{"setupComplete": map[string]any{}})
		for i := 0; i < 3; i++ {
			var frame map[string]any
			if e = conn.ReadJSON(&frame); e != nil {
				t.Error(e)
				return
			}
			frames <- frame
		}
		_ = conn.WriteJSON(map[string]any{"serverContent": map[string]any{"inputTranscription": map[string]any{"text": "heard candidate"}, "turnComplete": true}})
		_, _, _ = conn.ReadMessage() // cancellation must close this connection
	}))
	defer srv.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	cfg := &genai.LiveConnectConfig{ResponseModalities: []genai.Modality{genai.ModalityAudio}, InputAudioTranscription: &genai.AudioTranscriptionConfig{}, ContextWindowCompression: &genai.ContextWindowCompressionConfig{SlidingWindow: &genai.SlidingWindow{}}, SpeechConfig: &genai.SpeechConfig{VoiceConfig: &genai.VoiceConfig{PrebuiltVoiceConfig: &genai.PrebuiltVoiceConfig{VoiceName: "Aoede"}}}}
	socket, e := dialGemini(ctx, "ws"+strings.TrimPrefix(srv.URL, "http"), "personal-test-key", "native-audio-test", cfg)
	if e != nil {
		t.Fatal(e)
	}
	defer socket.Close()
	if e = socket.SendClientContent(genai.LiveClientContentInput{Turns: []*genai.Content{genai.NewContentFromText("answer", genai.RoleUser)}, TurnComplete: genai.Ptr(true)}); e != nil {
		t.Fatal(e)
	}
	if e = socket.SendRealtimeInput(genai.LiveRealtimeInput{Audio: &genai.Blob{Data: []byte{1, 2, 3}, MIMEType: "audio/pcm;rate=16000"}}); e != nil {
		t.Fatal(e)
	}
	if e = socket.SendToolResponse(genai.LiveToolResponseInput{FunctionResponses: []*genai.FunctionResponse{{ID: "tool-1", Name: "end_interview", Response: map[string]any{"ok": true}}}}); e != nil {
		t.Fatal(e)
	}
	setup := <-frames
	b, _ := json.Marshal(setup)
	for _, want := range []string{`"generationConfig"`, `"responseModalities":["AUDIO"]`, `"speechConfig"`, `"inputAudioTranscription":{}`, `"contextWindowCompression"`, `"models/native-audio-test"`} {
		if !strings.Contains(string(b), want) {
			t.Errorf("setup lacks %s: %s", want, b)
		}
	}
	for _, kind := range []string{"clientContent", "realtimeInput", "toolResponse"} {
		frame := <-frames
		if frame[kind] == nil {
			t.Errorf("wrong frame %s: %v", kind, frame)
		}
	}
	msg, e := socket.Receive()
	if e != nil || msg.ServerContent.InputTranscription.Text != "heard candidate" {
		t.Fatalf("decode=%+v %v", msg, e)
	}
	cancel()
	select {
	case <-serverDone:
	case <-time.After(time.Second):
		t.Fatal("cancellation left socket alive")
	}
}
func TestGeminiSetupCannotHangOrLeakProviderErrors(t *testing.T) {
	for _, providerError := range []bool{false, true} {
		t.Run(map[bool]string{false: "stalled setup", true: "provider error"}[providerError], func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				conn, e := (&websocket.Upgrader{}).Upgrade(w, r, nil)
				if e != nil {
					return
				}
				defer conn.Close()
				_, _, _ = conn.ReadMessage()
				if providerError {
					_ = conn.WriteJSON(map[string]any{"error": map[string]string{"message": "private-key-in-upstream"}})
				}
				_, _, _ = conn.ReadMessage()
			}))
			defer srv.Close()
			ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
			defer cancel()
			start := time.Now()
			_, e := dialGemini(ctx, "ws"+strings.TrimPrefix(srv.URL, "http"), "key", "model", &genai.LiveConnectConfig{})
			if e == nil || strings.Contains(e.Error(), "private-key") {
				t.Fatalf("unsafe setup error=%v", e)
			}
			if time.Since(start) > time.Second {
				t.Fatal("setup ignored deadline")
			}
		})
	}
}
