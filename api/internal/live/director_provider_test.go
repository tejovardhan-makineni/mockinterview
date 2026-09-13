package live

// This opt-in, billable evaluation uses synthetic histories and the production
// prompt builders. It is skipped in normal tests/CI. Successful generation is
// not a quality verdict: review the saved responses against each criterion.
// RUN_DIRECTOR_PROVIDER_EVAL=1 GEMINI_API_KEY=... DIRECTOR_EVAL_OUTPUT=/private/results.json
// go test ./internal/live -run TestDirectorProviderEvaluation -count=1 -timeout=12m

import (
	"context"
	"encoding/json"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/tejo/mockinterview-api/internal/corpus"
	"github.com/tejo/mockinterview-api/internal/llm"
	"google.golang.org/genai"
)

type conversationExample struct {
	ID       string        `json:"id"`
	Question string        `json:"question"`
	Review   string        `json:"review"`
	History  []llm.Message `json:"history"`
}

func TestDirectorProviderEvaluation(t *testing.T) {
	if os.Getenv("RUN_DIRECTOR_PROVIDER_EVAL") != "1" {
		t.Skip("explicit opt-in required: billable provider evaluation")
	}
	key := os.Getenv("GEMINI_API_KEY")
	output := os.Getenv("DIRECTOR_EVAL_OUTPUT")
	if key == "" || output == "" {
		t.Fatal("GEMINI_API_KEY and DIRECTOR_EVAL_OUTPUT are required")
	}
	data, err := os.ReadFile("../../data/fixtures/conversation-pacing.json")
	if err != nil {
		t.Fatal(err)
	}
	var examples []conversationExample
	if err := json.Unmarshal(data, &examples); err != nil {
		t.Fatal(err)
	}
	cat, err := corpus.Load("../../data/corpus")
	if err != nil {
		t.Fatal(err)
	}
	type sample struct {
		conversationExample
		Mode       string `json:"mode"`
		Model      string `json:"model"`
		Response   string `json:"response"`
		AudioBytes int    `json:"audio_bytes,omitempty"`
	}
	results := []sample{}
	defer func() {
		body, _ := json.MarshalIndent(map[string]any{"director_version": DirectorVersion, "review_required": true, "synthetic_data_only": true, "samples": results}, "", "  ")
		if err := os.WriteFile(output, body, 0600); err != nil {
			t.Error(err)
		}
	}()
	for _, example := range examples {
		q, ok := cat.Get(example.Question)
		if !ok {
			t.Fatalf("unknown fixture question %s", example.Question)
		}
		sections := SectionPlan(q, false, "")
		// Exercise the scenario itself, independently of the short rapport stage.
		section := sections[0]
		for _, candidate := range sections {
			if candidate.Kind != "intro" && candidate.Kind != "wrap" {
				section = candidate
				break
			}
		}
		system := SystemPrompt(q, "neutral", 3, "main", "", "", 15, "aoede", "en", sections, "") + "\n" + activeStageInstruction(section, 12*time.Minute)
		for _, mode := range []string{"text", "voice"} {
			t.Run(example.ID+"/"+mode, func(t *testing.T) {
				ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
				defer cancel()
				s := sample{conversationExample: example, Mode: mode, Model: "gemini-2.5-flash"}
				if mode == "text" {
					client, err := llm.NewGemini(ctx, key, s.Model)
					if err != nil {
						t.Fatal("text client setup failed")
					}
					s.Response, err = NextTurn(ctx, client, s.Model, system, example.History)
					if err != nil {
						t.Fatal("text generation failed (provider error omitted to protect credentials)")
					}
				} else {
					s.Model = "gemini-2.5-flash-native-audio-preview-12-2025"
					session, err := connectGemini(ctx, key, s.Model, &genai.LiveConnectConfig{
						ResponseModalities:       []genai.Modality{genai.ModalityAudio},
						SystemInstruction:        genai.NewContentFromText(system, genai.RoleUser),
						OutputAudioTranscription: &genai.AudioTranscriptionConfig{},
						SpeechConfig:             &genai.SpeechConfig{VoiceConfig: &genai.VoiceConfig{PrebuiltVoiceConfig: &genai.PrebuiltVoiceConfig{VoiceName: "Aoede"}}},
					})
					if err != nil {
						t.Fatal("voice connection failed (provider error omitted to protect credentials)")
					}
					defer session.Close()
					prompt := openingInstruction
					if len(example.History) > 0 {
						var replay strings.Builder
						replay.WriteString("[Saved synthetic interview transcript; context only, do not repeat.]\n")
						for _, turn := range example.History {
							role := "candidate"
							if turn.Role == "model" {
								role = "interviewer"
							}
							replay.WriteString(role + ": " + turn.Text + "\n")
						}
						if session.SendClientContent(genai.LiveClientContentInput{Turns: []*genai.Content{genai.NewContentFromText(replay.String(), genai.RoleUser)}, TurnComplete: genai.Ptr(false)}) != nil {
							t.Fatal("voice context send failed")
						}
						prompt = resumeInstruction
					}
					if session.SendClientContent(genai.LiveClientContentInput{Turns: []*genai.Content{genai.NewContentFromText(prompt, genai.RoleUser)}, TurnComplete: genai.Ptr(true)}) != nil {
						t.Fatal("voice turn send failed")
					}
					for {
						message, err := session.Receive()
						if err != nil {
							t.Fatal("voice generation failed (provider error omitted to protect credentials)")
						}
						if content := message.ServerContent; content != nil {
							if content.OutputTranscription != nil {
								s.Response += content.OutputTranscription.Text
							}
							if content.ModelTurn != nil {
								for _, part := range content.ModelTurn.Parts {
									if part.InlineData != nil {
										s.AudioBytes += len(part.InlineData.Data)
									}
								}
							}
							if content.TurnComplete {
								break
							}
						}
					}
					if s.AudioBytes == 0 {
						t.Error("no native audio received")
					}
				}
				results = append(results, s)
				if strings.TrimSpace(s.Response) == "" {
					t.Error("empty response")
				}
				t.Logf("REVIEW %s: %s", example.Review, s.Response)
			})
		}
	}
}
