package live

// This opt-in, billable evaluation uses synthetic histories and the production
// prompt builders. It is skipped in normal tests/CI. Successful generation is
// not a quality verdict: review the saved responses against each criterion.
// RUN_DIRECTOR_PROVIDER_EVAL=1 GEMINI_API_KEY=... DIRECTOR_EVAL_OUTPUT=/private/results.json
// go test ./internal/live -run TestDirectorProviderEvaluation -count=1 -timeout=12m
// DIRECTOR_EVAL_MODES=text restricts the run to text; unset runs text and voice.

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/tejo/mockinterview-api/internal/corpus"
	"github.com/tejo/mockinterview-api/internal/llm"
	"google.golang.org/genai"
)

type conversationExample struct {
	ID             string           `json:"id"`
	Question       string           `json:"question,omitempty"`
	CustomQuestion *corpus.Question `json:"custom_question,omitempty"`
	Stage          string           `json:"stage,omitempty"`
	Workspace      string           `json:"workspace,omitempty"`
	Review         string           `json:"review"`
	History        []llm.Message    `json:"history"`
}

func loadConversationExamples(t *testing.T) ([]conversationExample, *corpus.Catalog) {
	t.Helper()
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
	return examples, cat
}

func (example conversationExample) scenario(t *testing.T, cat *corpus.Catalog) (corpus.Question, []Section, Section) {
	t.Helper()
	var q corpus.Question
	if example.CustomQuestion != nil {
		if example.Question != "" || example.CustomQuestion.Domain != "custom" {
			t.Fatalf("%s: custom fixture must replace the catalog question and use custom domain", example.ID)
		}
		q = *example.CustomQuestion
		if err := corpus.Validate(q); err != nil {
			t.Fatal(err)
		}
		if q.FormatDefinition == nil {
			t.Fatalf("%s: custom fixture needs the private planned format", example.ID)
		}
		if err := corpus.ValidateFormat(*q.FormatDefinition); err != nil {
			t.Fatal(err)
		}
		q = corpus.Normalize(q)
	} else {
		var ok bool
		q, ok = cat.Get(example.Question)
		if !ok {
			t.Fatalf("unknown fixture question %s", example.Question)
		}
	}
	sections := SectionPlan(q, false, "")
	for _, candidate := range sections {
		if example.Stage != "" && candidate.ID == example.Stage || example.Stage == "" && candidate.Kind != "intro" && candidate.Kind != "wrap" {
			return q, sections, candidate
		}
	}
	t.Fatalf("%s: no matching working stage %q", example.ID, example.Stage)
	return q, sections, Section{}
}

// Keep fixtures executable in normal CI so an opt-in provider run cannot spend
// calls before discovering a missing scenario or stale stage ID. This validates
// the harness, not interview quality; generated turns still require review.
func TestConversationEvaluationFixtures(t *testing.T) {
	examples, cat := loadConversationExamples(t)
	seen := map[string]bool{}
	for _, example := range examples {
		t.Run(example.ID, func(t *testing.T) {
			if example.ID == "" || seen[example.ID] || strings.TrimSpace(example.Review) == "" {
				t.Fatal("fixture needs a unique ID and a concrete behavioral review criterion")
			}
			seen[example.ID] = true
			for _, turn := range example.History {
				if (turn.Role != "user" && turn.Role != "model") || strings.TrimSpace(turn.Text) == "" {
					t.Fatal("fixture contains an invalid synthetic interview turn")
				}
			}
			example.scenario(t, cat)
		})
	}
}

func directorEvaluationModes(value string, configured bool) ([]string, error) {
	if !configured {
		return []string{"text", "voice"}, nil
	}
	modes := strings.Split(value, ",")
	seen := map[string]bool{}
	for i, raw := range modes {
		mode := strings.TrimSpace(raw)
		if mode != "text" && mode != "voice" {
			return nil, fmt.Errorf("DIRECTOR_EVAL_MODES contains invalid mode %q; use text, voice, or text,voice", mode)
		}
		if seen[mode] {
			return nil, fmt.Errorf("DIRECTOR_EVAL_MODES repeats mode %q", mode)
		}
		seen[mode] = true
		modes[i] = mode
	}
	return modes, nil
}

func TestDirectorEvaluationModes(t *testing.T) {
	for _, tc := range []struct {
		name       string
		value      string
		configured bool
		want       string
	}{
		{name: "unset defaults to both", want: "text,voice"},
		{name: "text only", value: "text", configured: true, want: "text"},
		{name: "voice only", value: "voice", configured: true, want: "voice"},
		{name: "explicit ordered selection", value: " voice, text ", configured: true, want: "voice,text"},
		{name: "explicit empty", configured: true},
		{name: "whitespace only", value: " ", configured: true},
		{name: "unknown mode", value: "text,audio", configured: true},
		{name: "empty member", value: "text,", configured: true},
		{name: "duplicate would repeat a billable call", value: "text,text", configured: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := directorEvaluationModes(tc.value, tc.configured)
			if tc.want == "" {
				if err == nil {
					t.Fatal("invalid mode selection could make unintended billable calls")
				}
				return
			}
			if err != nil || strings.Join(got, ",") != tc.want {
				t.Fatalf("got modes %v and error %v, want %s", got, err, tc.want)
			}
		})
	}
}

func TestDirectorProviderEvaluation(t *testing.T) {
	if os.Getenv("RUN_DIRECTOR_PROVIDER_EVAL") != "1" {
		t.Skip("explicit opt-in required: billable provider evaluation")
	}
	modesValue, modesConfigured := os.LookupEnv("DIRECTOR_EVAL_MODES")
	modes, err := directorEvaluationModes(modesValue, modesConfigured)
	if err != nil {
		t.Fatal(err)
	}
	key := os.Getenv("GEMINI_API_KEY")
	output := os.Getenv("DIRECTOR_EVAL_OUTPUT")
	if key == "" || output == "" {
		t.Fatal("GEMINI_API_KEY and DIRECTOR_EVAL_OUTPUT are required")
	}
	examples, cat := loadConversationExamples(t)
	type sample struct {
		conversationExample
		Mode         string `json:"mode"`
		Model        string `json:"model"`
		PromptSHA256 string `json:"prompt_sha256"`
		Response     string `json:"response"`
		AudioBytes   int    `json:"audio_bytes,omitempty"`
		ElapsedMS    int64  `json:"elapsed_ms"`
	}
	results := []sample{}
	defer func() {
		body, _ := json.MarshalIndent(map[string]any{"director_version": DirectorVersion, "review_required": true, "synthetic_data_only": true, "samples": results}, "", "  ")
		if err := os.WriteFile(output, body, 0600); err != nil {
			t.Error(err)
		}
	}()
	selectedCases := "," + os.Getenv("DIRECTOR_EVAL_CASES") + ","
	for _, example := range examples {
		if selectedCases != ",," && !strings.Contains(selectedCases, ","+example.ID+",") {
			continue
		}
		q, sections, section := example.scenario(t, cat)
		system := SystemPrompt(q, "neutral", 3, "main", "", example.Workspace, 15, "aoede", "en", sections, "") + "\n" + activeStageInstruction(section, 12*time.Minute)
		promptDigest := sha256.Sum256([]byte(system))
		for _, mode := range modes {
			t.Run(example.ID+"/"+mode, func(t *testing.T) {
				ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
				defer cancel()
				s := sample{conversationExample: example, Mode: mode, Model: "gemini-2.5-flash", PromptSHA256: hex.EncodeToString(promptDigest[:])}
				started := time.Now()
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
				s.ElapsedMS = time.Since(started).Milliseconds()
				results = append(results, s)
				if strings.TrimSpace(s.Response) == "" {
					t.Error("empty response")
				}
				t.Logf("REVIEW %s: %s", example.Review, s.Response)
			})
		}
	}
}
