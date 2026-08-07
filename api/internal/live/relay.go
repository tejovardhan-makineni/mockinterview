package live

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/gorilla/websocket"
	"google.golang.org/genai"

	"github.com/tejo/mockinterview-api/internal/corpus"
	"github.com/tejo/mockinterview-api/internal/llm"
	"github.com/tejo/mockinterview-api/internal/persona"
	"github.com/tejo/mockinterview-api/internal/store"
)

// Relay bridges the browser and the interview director. When a Gemini API key is
// present it proxies real-time audio to the Gemini Live native-audio model
// (interviewer voice + barge-in). With no key it runs a text director and the
// browser speaks the lines with the Web Speech API — so the studio works
// offline. Either way, transcripts are tapped and persisted for scoring.
// Store is the persistence the relay needs during a live session.
type Store interface {
	GetSession(ctx context.Context, id string) (store.Session, error)
	UpdateSessionStatus(ctx context.Context, id, status string) error
	AddTurn(ctx context.Context, sessionID, role, text string, tsMs int64, meta json.RawMessage) error
	Transcript(ctx context.Context, sessionID string) ([]store.Turn, error)
	LatestResume(ctx context.Context, userID string) (store.Resume, error)
}

type Relay struct {
	store       Store
	corpus      *corpus.Catalog
	llm         llm.Client
	apiKey      string
	liveModel   string
	reasonModel string
	upgrader    websocket.Upgrader
	authFn      func(*http.Request) (string, error)
}

func NewRelay(st Store, cat *corpus.Catalog, ai llm.Client, apiKey, liveModel, reasonModel string, authFn func(*http.Request) (string, error)) *Relay {
	return &Relay{
		store: st, corpus: cat, llm: ai, apiKey: apiKey, liveModel: liveModel, reasonModel: reasonModel,
		authFn: authFn,
		upgrader: websocket.Upgrader{
			ReadBufferSize:  1 << 15,
			WriteBufferSize: 1 << 15,
			CheckOrigin:     func(_ *http.Request) bool { return true }, // CORS handled at HTTP layer
		},
	}
}

// clientMsg is a JSON control frame from the browser. Binary frames are raw
// PCM16 mic audio (16kHz) and are handled separately.
type clientMsg struct {
	Type string `json:"type"` // start | user_text | canvas | phase | end
	Text string `json:"text"`
}

// serverMsg is a JSON frame to the browser. Binary frames carry PCM16 audio (24kHz).
type serverMsg struct {
	Type      string `json:"type"` // say | transcript | phase | interrupted | turn_complete | error | ready
	Role      string `json:"role,omitempty"`
	Text      string `json:"text,omitempty"`
	Mode      string `json:"mode,omitempty"`      // "voice" (gemini audio) | "text" (client TTS)
	Streaming bool   `json:"streaming,omitempty"` // true while a turn is still being transcribed; false = finalized
}

func (r *Relay) Handle(w http.ResponseWriter, req *http.Request) {
	uid, err := r.authFn(req)
	if err != nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	sessionID := chi.URLParam(req, "id")
	sess, err := r.store.GetSession(req.Context(), sessionID)
	if err != nil || sess.UserID != uid {
		http.Error(w, "session not found", http.StatusNotFound)
		return
	}
	q, ok := r.corpus.Get(sess.QuestionID)
	if !ok {
		http.Error(w, "question not found", http.StatusNotFound)
		return
	}

	conn, err := r.upgrader.Upgrade(w, req, nil)
	if err != nil {
		return
	}
	defer conn.Close()
	// Bound a single inbound frame (mic PCM chunk or JSON control) so a client
	// can't stream an unbounded message up. 1 MB is far above any real frame.
	conn.SetReadLimit(1 << 20)

	persona, intensity, voice := parseConfig(sess.Config)
	resumeSummary := r.resumeSummary(req.Context(), uid)
	durationMin := 30
	if v := req.URL.Query().Get("minutes"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n < 180 {
			durationMin = n
		}
	}
	system := SystemPrompt(q, persona, intensity, "intro", resumeSummary, "", durationMin, voice)

	_ = r.store.UpdateSessionStatus(req.Context(), sessionID, "active")

	if r.llm.Stubbed() || r.apiKey == "" {
		r.runText(conn, sessionID, q, system)
		return
	}
	r.runGemini(conn, sessionID, q, system, voice)
}

// ---- text director (stub / no key): browser speaks via Web Speech API ----

func (r *Relay) runText(conn *websocket.Conn, sessionID string, q corpus.Question, system string) {
	ctx := context.Background()
	start := time.Now()
	writeJSON(conn, serverMsg{Type: "ready", Mode: "text"})

	history := []llm.Message{}
	say := func(text string) {
		history = append(history, llm.Message{Role: "model", Text: text})
		_ = r.store.AddTurn(ctx, sessionID, "interviewer", text, time.Since(start).Milliseconds(), nil)
		writeJSON(conn, serverMsg{Type: "say", Role: "interviewer", Text: text})
	}

	// Opening line.
	if first, err := NextTurn(ctx, r.llm, r.reasonModel, system, nil); err == nil {
		say(first)
	}

	for {
		mt, data, err := conn.ReadMessage()
		if err != nil {
			return
		}
		if mt != websocket.TextMessage {
			continue // no audio path in text mode; mic is transcribed client-side
		}
		var m clientMsg
		if json.Unmarshal(data, &m) != nil {
			continue
		}
		switch m.Type {
		case "user_text":
			if m.Text == "" {
				continue
			}
			history = append(history, llm.Message{Role: "user", Text: m.Text})
			_ = r.store.AddTurn(ctx, sessionID, "candidate", m.Text, time.Since(start).Milliseconds(), nil)
			reply, err := NextTurn(ctx, r.llm, r.reasonModel, system, history)
			if err != nil {
				writeJSON(conn, serverMsg{Type: "error", Text: "director error"})
				continue
			}
			say(reply)
		case "canvas":
			// Record the drawing as context for the next director turn.
			history = append(history, llm.Message{Role: "user", Text: "[my current diagram: " + clipText(m.Text, 1500) + "]"})
		case "nudge":
			say("Take your time — whenever you're ready, walk me through your thinking.")
		case "end":
			return
		}
	}
}

// ---- Gemini Live (real audio) ----

func (r *Relay) runGemini(conn *websocket.Conn, sessionID string, q corpus.Question, system, voice string) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()

	client, err := genai.NewClient(ctx, &genai.ClientConfig{APIKey: r.apiKey, Backend: genai.BackendGeminiAPI})
	if err != nil {
		writeJSON(conn, serverMsg{Type: "error", Text: "live connect failed"})
		return
	}
	cfg := &genai.LiveConnectConfig{
		ResponseModalities:       []genai.Modality{genai.ModalityAudio},
		SystemInstruction:        genai.NewContentFromText(system, genai.RoleUser),
		InputAudioTranscription:  &genai.AudioTranscriptionConfig{},
		OutputAudioTranscription: &genai.AudioTranscriptionConfig{},
		SpeechConfig: &genai.SpeechConfig{
			VoiceConfig: &genai.VoiceConfig{PrebuiltVoiceConfig: &genai.PrebuiltVoiceConfig{VoiceName: persona.GeminiVoiceName(voice)}},
		},
		// Turn-taking. The candidate MUST be heard readily (voice in + barge-in
		// interruption), so start-of-speech stays HIGH sensitivity. We only make
		// the model patient about deciding the candidate has FINISHED (low
		// end-sensitivity + a longer silence window) so it doesn't cut them off or
		// jump in during a short think-pause.
		RealtimeInputConfig: &genai.RealtimeInputConfig{
			AutomaticActivityDetection: &genai.AutomaticActivityDetection{
				StartOfSpeechSensitivity: genai.StartSensitivityHigh,
				EndOfSpeechSensitivity:   genai.EndSensitivityLow,
				PrefixPaddingMs:          genai.Ptr(int32(200)),
				SilenceDurationMs:        genai.Ptr(int32(1200)),
			},
		},
		// The interviewer can end the interview itself (time up / wrapping up /
		// candidate asks to end).
		Tools: []*genai.Tool{{
			FunctionDeclarations: []*genai.FunctionDeclaration{{
				Name:        "end_interview",
				Description: "Conclude and end the interview. Call this AFTER a brief closing line when time is up, when you decide to wrap up, or when the candidate asks to end.",
			}},
		}},
	}
	session, err := client.Live.Connect(ctx, r.liveModel, cfg)
	if err != nil {
		writeJSON(conn, serverMsg{Type: "error", Text: "live model unavailable: " + err.Error()})
		return
	}
	defer session.Close()
	writeJSON(conn, serverMsg{Type: "ready", Mode: "voice"})

	start := time.Now()
	var wg sync.WaitGroup
	wg.Add(1)

	// Gemini → browser: audio + transcripts. Transcriptions arrive in small
	// chunks; we ACCUMULATE per role and emit the full text-so-far (streaming),
	// then persist ONE transcript turn when the role switches or the turn ends —
	// so the UI shows one growing message, not one entry per token.
	go func() {
		defer wg.Done()
		var curRole, curText string
		flush := func() {
			if curText == "" {
				return
			}
			_ = r.store.AddTurn(context.Background(), sessionID, curRole, curText, time.Since(start).Milliseconds(), nil)
			writeJSON(conn, serverMsg{Type: "transcript", Role: curRole, Text: curText, Streaming: false})
			curRole, curText = "", ""
		}
		accumulate := func(role, chunk string) {
			if chunk == "" {
				return
			}
			if curRole != "" && curRole != role {
				flush()
			}
			curRole = role
			curText += chunk
			writeJSON(conn, serverMsg{Type: "transcript", Role: role, Text: curText, Streaming: true})
		}
		for {
			msg, err := session.Receive()
			if err != nil {
				flush()
				// The Gemini session dropped (error, or the 30-min cap). Close the
				// browser socket so the client's auto-reconnect kicks in and opens a
				// FRESH Gemini session — otherwise the candidate keeps talking into a
				// dead session and nothing is heard. Transcript is already persisted.
				_ = conn.Close()
				return
			}
			// The interviewer decided to end the interview.
			if msg.ToolCall != nil {
				for _, fc := range msg.ToolCall.FunctionCalls {
					if fc.Name == "end_interview" {
						_ = session.SendToolResponse(genai.LiveToolResponseInput{FunctionResponses: []*genai.FunctionResponse{{ID: fc.ID, Name: fc.Name, Response: map[string]any{"ok": true}}}})
						flush()
						writeJSON(conn, serverMsg{Type: "ended", Text: "The interviewer concluded the interview."})
					}
				}
				continue
			}
			sc := msg.ServerContent
			if sc == nil {
				continue
			}
			if sc.ModelTurn != nil {
				for _, p := range sc.ModelTurn.Parts {
					if p.InlineData != nil && len(p.InlineData.Data) > 0 {
						_ = conn.WriteMessage(websocket.BinaryMessage, p.InlineData.Data)
					}
				}
			}
			if sc.OutputTranscription != nil {
				accumulate("interviewer", sc.OutputTranscription.Text)
			}
			if sc.InputTranscription != nil {
				accumulate("candidate", sc.InputTranscription.Text)
			}
			if sc.Interrupted {
				writeJSON(conn, serverMsg{Type: "interrupted"})
			}
			if sc.TurnComplete {
				flush()
				writeJSON(conn, serverMsg{Type: "turn_complete"})
			}
		}
	}()

	// Kick off the interviewer's turn. If there's already a transcript, this is a
	// RESUME (reconnect after a drop, or the candidate returning) — feed the
	// conversation so far and tell the interviewer to CONTINUE, never restart or
	// re-greet. Otherwise it's a fresh start.
	prior, _ := r.store.Transcript(ctx, sessionID)
	if len(prior) == 0 {
		_ = session.SendClientContent(genai.LiveClientContentInput{
			Turns:        []*genai.Content{genai.NewContentFromText("Please begin the interview now: greet the candidate warmly and make a little genuine small talk before any question.", genai.RoleUser)},
			TurnComplete: genai.Ptr(true),
		})
	} else {
		var b strings.Builder
		b.WriteString("IMPORTANT: This interview is ALREADY IN PROGRESS — you just reconnected after a brief network drop. Do NOT restart, do NOT greet again, do NOT re-introduce yourself or repeat the opening. Here is the conversation so far:\n\n")
		for _, t := range prior {
			role := "You (interviewer)"
			if t.Role == "candidate" {
				role = "Candidate"
			}
			fmt.Fprintf(&b, "%s: %s\n", role, t.Text)
		}
		// Context only (no reply).
		_ = session.SendClientContent(genai.LiveClientContentInput{
			Turns:        []*genai.Content{genai.NewContentFromText(b.String(), genai.RoleUser)},
			TurnComplete: genai.Ptr(false),
		})
		// Now prompt one continuing turn.
		_ = session.SendClientContent(genai.LiveClientContentInput{
			Turns:        []*genai.Content{genai.NewContentFromText("(Reconnected.) Continue the interview naturally from the last exchange above — pick up exactly where you left off. No greeting, no restart.", genai.RoleUser)},
			TurnComplete: genai.Ptr(true),
		})
	}

	// Browser → Gemini: audio (binary) + control (JSON).
	for {
		mt, data, err := conn.ReadMessage()
		if err != nil {
			break
		}
		switch mt {
		case websocket.BinaryMessage:
			_ = session.SendRealtimeInput(genai.LiveRealtimeInput{
				Audio: &genai.Blob{Data: data, MIMEType: "audio/pcm;rate=16000"},
			})
		case websocket.TextMessage:
			var m clientMsg
			if json.Unmarshal(data, &m) != nil {
				continue
			}
			switch m.Type {
			case "canvas":
				// Feed the drawing in as CONTEXT ONLY (turnComplete=false) so the
				// model can reference it later WITHOUT being prompted to respond —
				// otherwise it talks over the candidate while they draw.
				_ = session.SendClientContent(genai.LiveClientContentInput{
					Turns:        []*genai.Content{genai.NewContentFromText("[The candidate's diagram now shows: "+clipText(m.Text, 2000)+"]", genai.RoleUser)},
					TurnComplete: genai.Ptr(false),
				})
			case "user_text":
				// A typed answer IS a completed candidate turn — PERSIST it (Gemini
				// won't echo typed text back as an input transcription, so without
				// this the scorer would never see typed answers) and prompt a reply.
				if strings.TrimSpace(m.Text) != "" {
					_ = r.store.AddTurn(context.Background(), sessionID, "candidate", m.Text, time.Since(start).Milliseconds(), nil)
					writeJSON(conn, serverMsg{Type: "transcript", Role: "candidate", Text: m.Text, Streaming: false})
				}
				_ = session.SendClientContent(genai.LiveClientContentInput{
					Turns:        []*genai.Content{genai.NewContentFromText(m.Text, genai.RoleUser)},
					TurnComplete: genai.Ptr(true),
				})
			case "nudge":
				_ = session.SendClientContent(genai.LiveClientContentInput{
					Turns:        []*genai.Content{genai.NewContentFromText("[The candidate has been quiet for a while. Give ONE short, friendly nudge like 'Take your time — whenever you're ready, walk me through it.' Do NOT repeat the question or answer it, then wait silently.]", genai.RoleUser)},
					TurnComplete: genai.Ptr(true),
				})
			case "time":
				// Periodic time-remaining update as CONTEXT only (no forced reply).
				_ = session.SendClientContent(genai.LiveClientContentInput{
					Turns:        []*genai.Content{genai.NewContentFromText("[Time check: "+clipText(m.Text, 60)+". Pace accordingly; when time is nearly up, give a brief closing and call end_interview.]", genai.RoleUser)},
					TurnComplete: genai.Ptr(false),
				})
			case "end":
				cancel()
				wg.Wait()
				return
			}
		}
	}
	cancel()
	wg.Wait()
}

// ---- helpers ----

func (r *Relay) resumeSummary(ctx context.Context, uid string) string {
	res, err := r.store.LatestResume(ctx, uid)
	if err != nil {
		return ""
	}
	var parsed struct {
		Name     string   `json:"name"`
		Headline string   `json:"headline"`
		Summary  string   `json:"summary"`
		Skills   []string `json:"skills"`
		Projects []struct {
			Name    string   `json:"name"`
			Summary string   `json:"summary"`
			Tech    []string `json:"tech"`
		} `json:"projects"`
	}
	_ = json.Unmarshal(res.ParsedJSON, &parsed)

	var b strings.Builder
	if parsed.Name != "" {
		fmt.Fprintf(&b, "%s — %s\n", parsed.Name, parsed.Headline)
	}
	if parsed.Summary != "" {
		b.WriteString(parsed.Summary + "\n")
	}
	if len(parsed.Skills) > 0 {
		fmt.Fprintf(&b, "Skills: %s\n", strings.Join(parsed.Skills, ", "))
	}
	for _, p := range parsed.Projects {
		fmt.Fprintf(&b, "Project \"%s\": %s (tech: %s)\n", p.Name, p.Summary, strings.Join(p.Tech, ", "))
	}
	out := strings.TrimSpace(b.String())
	if out == "" {
		return clipText(res.ParsedText, 800)
	}
	return out
}

func parseConfig(cfg json.RawMessage) (persona string, intensity int, voice string) {
	def := store.DefaultConfig() // single source of truth for defaults (from persona catalogs)
	persona, intensity, voice = def.Personality, def.Intensity, def.VoiceID
	var c struct {
		Personality string `json:"personality"`
		Intensity   int    `json:"intensity"`
		VoiceID     string `json:"voice_id"`
	}
	if json.Unmarshal(cfg, &c) == nil {
		if c.Personality != "" {
			persona = c.Personality
		}
		if c.Intensity >= 1 && c.Intensity <= 5 {
			intensity = c.Intensity
		}
		if c.VoiceID != "" {
			voice = c.VoiceID
		}
	}
	return
}

func writeJSON(conn *websocket.Conn, m serverMsg) {
	_ = conn.WriteJSON(m)
}

func clipText(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}
