// Package tts does one-shot Gemini text-to-speech for voice previews, so users
// hear the ACTUAL interviewer voice (not the browser's robotic fallback).
package tts

import (
	"bytes"
	"context"
	"encoding/binary"
	"fmt"
	"sync"

	"google.golang.org/genai"
)

// The genai client is safe for concurrent reuse and holds pooled HTTP
// connections, so we build it once and share it across previews rather than
// paying client-setup + a fresh TLS handshake on every synthesis (that setup
// cost was a real chunk of the voice-preview latency).
var (
	clientOnce sync.Once
	client     *genai.Client
	clientErr  error
)

func sharedClient(apiKey string) (*genai.Client, error) {
	clientOnce.Do(func() {
		client, clientErr = genai.NewClient(context.Background(), &genai.ClientConfig{APIKey: apiKey, Backend: genai.BackendGeminiAPI})
	})
	return client, clientErr
}

// Synthesize returns 24kHz 16-bit mono WAV audio of `text` spoken in `voiceName`
// (a Gemini prebuilt voice, e.g. "Aoede"). Returns an error if TTS is
// unavailable (no key) or the model returns no audio.
func Synthesize(ctx context.Context, apiKey, model, voiceName, text string) ([]byte, error) {
	if apiKey == "" {
		return nil, fmt.Errorf("tts unavailable: no api key")
	}
	client, err := sharedClient(apiKey)
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
