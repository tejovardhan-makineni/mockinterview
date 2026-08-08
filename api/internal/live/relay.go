package live

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/gorilla/websocket"
	"google.golang.org/genai"

	"github.com/tejo/mockinterview-api/internal/corpus"
	"github.com/tejo/mockinterview-api/internal/llm"
	"github.com/tejo/mockinterview-api/internal/persona"
	"github.com/tejo/mockinterview-api/internal/store"
)

// WebSocket keep-alive: ping the client periodically and require a pong (or any
// frame) within pongWait, so a half-open socket (candidate closed the laptop,
// network dropped) is reaped instead of pinning a Gemini session open.
const (
	pongWait     = 60 * time.Second
	pingPeriod   = 25 * time.Second
	writeWait    = 10 * time.Second
	persistBound = 5 * time.Second
)

// wsWriter is the slice of *websocket.Conn's write surface that wsConn needs;
// declaring it as an interface lets tests inject a fake conn to exercise the
// write serialization under -race (GO-14).
type wsWriter interface {
	WriteJSON(v interface{}) error
	WriteMessage(messageType int, data []byte) error
	WriteControl(messageType int, data []byte, deadline time.Time) error
	SetWriteDeadline(t time.Time) error
	Close() error
}

// wsConn serializes ALL writes to a single gorilla *websocket.Conn. gorilla
// forbids concurrent writers, and both the Gemini→browser reader goroutine
// (audio + transcripts) and the browser→Gemini loop (typed-text echo) write to
// the same socket — without this lock they race and panic ("concurrent write to
// websocket connection"). Every write also sets a deadline so a stuck client
// can't block a writer forever, and the error is returned so a dead socket
// triggers teardown instead of being silently swallowed.
type wsConn struct {
	mu   sync.Mutex
	conn wsWriter
}

func (c *wsConn) writeServerMsg(m serverMsg) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	_ = c.conn.SetWriteDeadline(time.Now().Add(writeWait))
	return c.conn.WriteJSON(m)
}

func (c *wsConn) writeBinary(b []byte) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	_ = c.conn.SetWriteDeadline(time.Now().Add(writeWait))
	return c.conn.WriteMessage(websocket.BinaryMessage, b)
}

func (c *wsConn) writePing() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.conn.WriteControl(websocket.PingMessage, nil, time.Now().Add(writeWait))
}

func (c *wsConn) close() error { return c.conn.Close() }

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

func NewRelay(st Store, cat *corpus.Catalog, ai llm.Client, apiKey, liveModel, reasonModel string, allowedOrigins []string, authFn func(*http.Request) (string, error)) *Relay {
	return &Relay{
		store: st, corpus: cat, llm: ai, apiKey: apiKey, liveModel: liveModel, reasonModel: reasonModel,
		authFn: authFn,
		upgrader: websocket.Upgrader{
			ReadBufferSize:  1 << 15,
			WriteBufferSize: 1 << 15,
			// SEC-6: only allow the configured web origin(s) (or a same-origin /
			// header-less non-browser client) to open the socket. A wide-open
			// CheckOrigin lets any website drive an authenticated user's live session
			// (cross-site WebSocket hijacking); the HTTP CORS layer does NOT protect
			// the WS handshake.
			CheckOrigin: originChecker(allowedOrigins),
		},
	}
}

// originChecker builds the upgrader's CheckOrigin: permit requests with no Origin
// header (native/test clients that can't be a browser CSRF vector), same-origin
// requests, and any explicitly-allowed web origin.
func originChecker(allowed []string) func(*http.Request) bool {
	return func(req *http.Request) bool {
		origin := req.Header.Get("Origin")
		if origin == "" {
			return true // non-browser client (no Origin header)
		}
		u, err := url.Parse(origin)
		if err != nil || u.Host == "" {
			return false
		}
		// Same-origin: the WS request Host matches the page's Origin host.
		if strings.EqualFold(u.Host, req.Host) {
			return true
		}
		for _, a := range allowed {
			if strings.EqualFold(origin, strings.TrimRight(a, "/")) {
				return true
			}
		}
		return false
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

	personaID, intensity, voice, language := parseConfig(sess.Config)
	resumeSummary := r.resumeSummary(req.Context(), uid)
	durationMin := 30
	if v := req.URL.Query().Get("minutes"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n < 180 {
			durationMin = n
		}
	}
	system := SystemPrompt(q, personaID, intensity, "intro", resumeSummary, "", durationMin, voice, language)

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

	wc := &wsConn{conn: conn}

	client, err := genai.NewClient(ctx, &genai.ClientConfig{APIKey: r.apiKey, Backend: genai.BackendGeminiAPI})
	if err != nil {
		slog.Error("live client init failed", "session", sessionID, "err", err)
		_ = wc.writeServerMsg(serverMsg{Type: "error", Text: "live connect failed"})
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
		// Keep the session alive for the full interview. Without this, Gemini
		// terminates the native-audio session once its context window fills (well
		// under our 30-min cap in a talky interview) — which surfaced as the
		// intermittent mid-interview drops that then auto-reconnected. A sliding
		// window compresses older turns instead of ending the session.
		ContextWindowCompression: &genai.ContextWindowCompressionConfig{SlidingWindow: &genai.SlidingWindow{}},
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
		// GO-9/SEC-9: log the raw provider error server-side; return a generic
		// message so upstream/internal detail never reaches the browser.
		slog.Error("live model connect failed", "session", sessionID, "model", r.liveModel, "err", err)
		_ = wc.writeServerMsg(serverMsg{Type: "error", Text: "live model unavailable"})
		return
	}

	// Keep-alive (GO-3): a pong (or any frame) must arrive within pongWait or the
	// read errors out, reaping half-open sockets. Pings are sent below.
	_ = conn.SetReadDeadline(time.Now().Add(pongWait))
	conn.SetPongHandler(func(string) error { return conn.SetReadDeadline(time.Now().Add(pongWait)) })

	// Teardown (GO-3): idempotent and safe from any goroutine. cancel() alone can
	// hang because session.Receive()/conn.ReadMessage() may not honor ctx, so we
	// also force-close both so those blocked reads error out immediately.
	var stopOnce sync.Once
	stop := func() {
		stopOnce.Do(func() {
			cancel()
			_ = session.Close()
			_ = wc.close()
		})
	}
	defer stop()

	_ = wc.writeServerMsg(serverMsg{Type: "ready", Mode: "voice"})

	start := time.Now()

	// GO-2: keep transcript persistence OFF the audio hot path. Finished turns are
	// pushed onto a buffered channel and written by a dedicated goroutine with a
	// bounded timeout, so a slow DB write never stalls the interviewer's audio.
	// The write ctx is independent of the session ctx so an in-flight persist
	// survives teardown (we don't want to drop the last turn on disconnect).
	type pendingTurn struct {
		role, text string
		tsMs       int64
	}
	turns := make(chan pendingTurn, 256)
	persist := func(role, text string, tsMs int64) {
		select {
		case turns <- pendingTurn{role, text, tsMs}:
		default:
			// Buffer full (pathological): persist in a throwaway goroutine so the hot
			// path still never blocks and the turn isn't dropped.
			go func() {
				pctx, pcancel := context.WithTimeout(context.Background(), persistBound)
				defer pcancel()
				_ = r.store.AddTurn(pctx, sessionID, role, text, tsMs, nil)
			}()
		}
	}
	var persistWg sync.WaitGroup
	persistWg.Add(1)
	go func() {
		defer persistWg.Done()
		for t := range turns {
			pctx, pcancel := context.WithTimeout(context.Background(), persistBound)
			_ = r.store.AddTurn(pctx, sessionID, t.role, t.text, t.tsMs, nil)
			pcancel()
		}
	}()

	// Ping ticker (GO-3): rides the write lock like every other write.
	go func() {
		ticker := time.NewTicker(pingPeriod)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if err := wc.writePing(); err != nil {
					stop()
					return
				}
			}
		}
	}()

	var wg sync.WaitGroup
	wg.Add(1)

	// endedOnce guards against emitting "ended" twice (GO-11).
	var endedOnce sync.Once
	emitEnded := func() {
		endedOnce.Do(func() {
			_ = wc.writeServerMsg(serverMsg{Type: "ended", Text: "The interviewer concluded the interview."})
		})
	}

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
			persist(curRole, curText, time.Since(start).Milliseconds())
			_ = wc.writeServerMsg(serverMsg{Type: "transcript", Role: curRole, Text: curText, Streaming: false})
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
			// GO-13: a failed write means the client is gone — tear down instead of
			// swallowing the error and looping.
			if err := wc.writeServerMsg(serverMsg{Type: "transcript", Role: role, Text: curText, Streaming: true}); err != nil {
				stop()
			}
		}
		for {
			msg, err := session.Receive()
			if err != nil {
				flush()
				// The Gemini session dropped (error, or the 30-min cap). Tear down so
				// the browser socket closes and the client's auto-reconnect opens a
				// FRESH Gemini session. Transcript is already persisted.
				stop()
				return
			}
			// The interviewer decided to end the interview (GO-11).
			if msg.ToolCall != nil {
				ended := false
				for _, fc := range msg.ToolCall.FunctionCalls {
					if fc.Name == "end_interview" {
						_ = session.SendToolResponse(genai.LiveToolResponseInput{FunctionResponses: []*genai.FunctionResponse{{ID: fc.ID, Name: fc.Name, Response: map[string]any{"ok": true}}}})
						flush()
						emitEnded()
						ended = true
					}
				}
				if ended {
					// Mark the session complete and tear the whole relay down instead of
					// continuing the receive loop with a session the interviewer ended.
					uctx, ucancel := context.WithTimeout(context.Background(), persistBound)
					_ = r.store.UpdateSessionStatus(uctx, sessionID, "complete")
					ucancel()
					stop()
					return
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
						if err := wc.writeBinary(p.InlineData.Data); err != nil {
							stop()
							return
						}
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
				_ = wc.writeServerMsg(serverMsg{Type: "interrupted"})
			}
			if sc.TurnComplete {
				flush()
				_ = wc.writeServerMsg(serverMsg{Type: "turn_complete"})
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
		// Now prompt one continuing turn — acknowledge the network blip and ask
		// the candidate to repeat, since their last words may have been lost.
		_ = session.SendClientContent(genai.LiveClientContentInput{
			Turns:        []*genai.Content{genai.NewContentFromText("(You just reconnected after a brief NETWORK ISSUE — the candidate's last words may have been cut off and not captured.) In ONE short, natural line, acknowledge the hiccup and ask them to repeat their last point — e.g. \"Sorry, I think we had a brief connection issue there — could you repeat that last part?\" Then continue from where you left off. Do NOT greet, do NOT restart, do NOT re-introduce yourself.", genai.RoleUser)},
			TurnComplete: genai.Ptr(true),
		})
	}

	// Browser → Gemini: audio (binary) + control (JSON).
readLoop:
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
				// Persistence goes through the off-hot-path channel (GO-2), and the
				// echo through the serialized writer (GO-1) — this write races the
				// reader goroutine's audio/transcript writes.
				if strings.TrimSpace(m.Text) != "" {
					persist("candidate", m.Text, time.Since(start).Milliseconds())
					_ = wc.writeServerMsg(serverMsg{Type: "transcript", Role: "candidate", Text: m.Text, Streaming: false})
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
				break readLoop
			}
		}
	}

	// Teardown: cancel + force-close so the reader goroutine's blocked
	// session.Receive() errors out, then wait for it (bounded), then drain and
	// wait for the persistence goroutine so no finished turn is lost (GO-3).
	stop()
	if waitTimeout(&wg, writeWait) {
		close(turns)
		persistWg.Wait()
	}
}

// waitTimeout waits for wg for at most d, returning true if it completed. Used so
// teardown can't hang forever on a reader goroutine that (pathologically) fails
// to observe the closed session.
func waitTimeout(wg *sync.WaitGroup, d time.Duration) bool {
	done := make(chan struct{})
	go func() { wg.Wait(); close(done) }()
	select {
	case <-done:
		return true
	case <-time.After(d):
		return false
	}
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

func parseConfig(cfg json.RawMessage) (personaID string, intensity int, voice, language string) {
	def := store.DefaultConfig() // single source of truth for defaults (from persona catalogs)
	personaID, intensity, voice = def.Personality, def.Intensity, def.VoiceID
	language = persona.DefaultLanguageCode()
	var c struct {
		Personality string `json:"personality"`
		Intensity   int    `json:"intensity"`
		VoiceID     string `json:"voice_id"`
		Language    string `json:"language"`
	}
	if json.Unmarshal(cfg, &c) == nil {
		if c.Personality != "" {
			personaID = c.Personality
		}
		if c.Intensity >= 1 && c.Intensity <= 5 {
			intensity = c.Intensity
		}
		if c.VoiceID != "" {
			voice = c.VoiceID
		}
		if c.Language != "" {
			language = persona.NormalizeLanguage(c.Language)
		}
	}
	return
}

func writeJSON(conn *websocket.Conn, m serverMsg) {
	_ = conn.WriteJSON(m)
}

// clipText truncates s to at most n bytes WITHOUT splitting a UTF-8 rune — a
// naive s[:n] can slice through a multi-byte character (e.g. Telugu/Hindi text)
// and emit invalid UTF-8. Back off to the nearest rune boundary at or before n.
func clipText(s string, n int) string {
	if n <= 0 {
		return ""
	}
	if len(s) <= n {
		return s
	}
	for n > 0 && !utf8.RuneStart(s[n]) {
		n--
	}
	return s[:n]
}
