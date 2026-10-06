// Package tts does one-shot Gemini text-to-speech for voice previews, so users
// hear the ACTUAL interviewer voice (not the browser's robotic fallback).
package tts

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"google.golang.org/genai"
)

// HTTP transports pool connections without retaining one user's API key for
// another user's preview. Each request carries its own credentials.
var previewHTTP = &http.Client{Timeout: 30 * time.Second}

// Synthesize returns 24kHz 16-bit mono WAV audio of `text` spoken in `voiceName`
// (a Gemini prebuilt voice, e.g. "Aoede"). Returns an error if TTS is
// unavailable (no key) or the model returns no audio.
func Synthesize(ctx context.Context, apiKey, model, voiceName, text string, style ...string) ([]byte, error) {
	if apiKey == "" {
		return nil, fmt.Errorf("tts unavailable: no api key")
	}
	delivery := ""
	if len(style) > 0 {
		delivery = style[0]
	}
	if strings.HasPrefix(strings.TrimPrefix(model, "models/"), "gemini-3.8-") {
		return synthesizeCurrent(ctx, previewHTTP, "https://generativelanguage.googleapis.com/v1beta/interactions", apiKey, model, voiceName, text, delivery)
	}
	if delivery != "" {
		text = "Say this " + delivery + ": " + text
	}
	client, err := genai.NewClient(ctx, &genai.ClientConfig{APIKey: apiKey, Backend: genai.BackendGeminiAPI})
	if err != nil {
		return nil, err
	}
	cfg := &genai.GenerateContentConfig{
		ResponseModalities: []string{string(genai.ModalityAudio)},
		SpeechConfig: &genai.SpeechConfig{
			VoiceConfig: &genai.VoiceConfig{PrebuiltVoiceConfig: &genai.PrebuiltVoiceConfig{VoiceName: voiceName}},
		},
	}
	contents := []*genai.Content{genai.NewContentFromText(text, genai.RoleUser)}
	resp, err := client.Models.GenerateContent(ctx, model, contents, cfg)
	if err != nil {
		return nil, err
	}
	// Pull the raw PCM out of the first inline-data part.
	var pcm []byte
	if len(resp.Candidates) > 0 && resp.Candidates[0].Content != nil {
		for _, p := range resp.Candidates[0].Content.Parts {
			if p.InlineData != nil && len(p.InlineData.Data) > 0 {
				if strings.HasPrefix(p.InlineData.MIMEType, "audio/wav") {
					return p.InlineData.Data, nil
				}
				pcm = p.InlineData.Data
				break
			}
		}
	}
	if len(pcm) == 0 {
		return nil, fmt.Errorf("tts: empty audio")
	}
	return wrapWAV(pcm, 24000, 1, 16), nil
}

// Gemini 3.8 treats the transcript verbatim and returns WAV by default.
// Delivery directions belong in speech_metadata, not in the spoken text.
func synthesizeCurrent(ctx context.Context, client *http.Client, endpoint, apiKey, model, voice, line, style string) ([]byte, error) {
	body := map[string]any{
		"model": strings.TrimPrefix(model, "models/"), "store": false,
		"input": []any{map[string]any{"type": "user_input", "content": []any{map[string]any{
			"type": "text", "text": line,
			"annotations": []any{map[string]string{"type": "speech_metadata", "style": style}},
		}}}},
		"response_format":   map[string]string{"type": "audio", "mime_type": "audio/wav"},
		"generation_config": map[string]any{"speech_config": []any{map[string]string{"voice": voice}}},
	}
	encoded, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(encoded))
	if err != nil {
		return nil, err
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("x-goog-api-key", apiKey)
	response, err := client.Do(request)
	if err != nil {
		return nil, fmt.Errorf("tts request unavailable")
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("tts unavailable (status %d)", response.StatusCode)
	}
	var result struct {
		Steps []struct {
			Type    string `json:"type"`
			Content []struct {
				Type string `json:"type"`
				MIME string `json:"mime_type"`
				Data []byte `json:"data"`
			} `json:"content"`
		} `json:"steps"`
	}
	if err = json.NewDecoder(io.LimitReader(response.Body, 12<<20)).Decode(&result); err != nil {
		return nil, fmt.Errorf("tts response unavailable")
	}
	for i := len(result.Steps) - 1; i >= 0; i-- {
		step := result.Steps[i]
		if step.Type != "model_output" {
			continue
		}
		for _, content := range step.Content {
			if content.Type == "audio" && len(content.Data) >= 12 && string(content.Data[:4]) == "RIFF" && string(content.Data[8:12]) == "WAVE" {
				return content.Data, nil
			}
		}
	}
	return nil, fmt.Errorf("tts: empty or invalid WAV audio")
}

// wrapWAV prepends a canonical WAV/PCM header to raw little-endian PCM samples.
func wrapWAV(pcm []byte, sampleRate, channels, bitsPerSample int) []byte {
	var b bytes.Buffer
	dataLen := len(pcm)
	byteRate := sampleRate * channels * bitsPerSample / 8
	blockAlign := channels * bitsPerSample / 8
	b.WriteString("RIFF")
	binary.Write(&b, binary.LittleEndian, uint32(36+dataLen))
	b.WriteString("WAVE")
	b.WriteString("fmt ")
	binary.Write(&b, binary.LittleEndian, uint32(16))
	binary.Write(&b, binary.LittleEndian, uint16(1)) // PCM
	binary.Write(&b, binary.LittleEndian, uint16(channels))
	binary.Write(&b, binary.LittleEndian, uint32(sampleRate))
	binary.Write(&b, binary.LittleEndian, uint32(byteRate))
	binary.Write(&b, binary.LittleEndian, uint16(blockAlign))
	binary.Write(&b, binary.LittleEndian, uint16(bitsPerSample))
	b.WriteString("data")
	binary.Write(&b, binary.LittleEndian, uint32(dataLen))
	b.Write(pcm)
	return b.Bytes()
}
