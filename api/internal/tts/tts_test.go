package tts

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCurrentTTSSeparatesStylePreservesWAVAndUsesEachPersonalKey(t *testing.T) {
	wav := wrapWAV([]byte{1, 2, 3, 4}, 24000, 1, 16)
	var keys []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		keys = append(keys, r.Header.Get("x-goog-api-key"))
		var request struct {
			Model string `json:"model"`
			Store bool   `json:"store"`
			Input []struct {
				Content []struct {
					Text        string `json:"text"`
					Annotations []struct {
						Type  string `json:"type"`
						Style string `json:"style"`
					} `json:"annotations"`
				} `json:"content"`
			} `json:"input"`
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Error(err)
		}
		content := request.Input[0].Content[0]
		if request.Model != "gemini-3.8-flash-tts" || request.Store || content.Text != "Hello there." || content.Annotations[0].Style != "warm and conversational" || content.Annotations[0].Type != "speech_metadata" {
			t.Errorf("incorrect TTS request: %+v", request)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"steps": []any{map[string]any{"type": "model_output", "content": []any{map[string]any{"type": "audio", "mime_type": "audio/wav", "data": wav}}}}})
	}))
	defer server.Close()
	for _, key := range []string{"personal-one", "personal-two"} {
		audio, err := synthesizeCurrent(context.Background(), server.Client(), server.URL, key, "gemini-3.8-flash-tts", "Kore", "Hello there.", "warm and conversational")
		if err != nil || !bytes.Equal(audio, wav) {
			t.Fatalf("WAV corrupted by wrapping: %v", err)
		}
	}
	if len(keys) != 2 || keys[0] != "personal-one" || keys[1] != "personal-two" {
		t.Fatalf("credentials crossed requests: %v", keys)
	}
}
