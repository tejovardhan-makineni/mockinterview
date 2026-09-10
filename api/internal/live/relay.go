package live

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"time"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/gorilla/websocket"
	"google.golang.org/genai"

	"github.com/tejo/mockinterview-api/internal/auth"
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

func (c *wsConn) writeClose(code int) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.conn.WriteControl(websocket.CloseMessage, websocket.FormatCloseMessage(code, ""), time.Now().Add(writeWait))
}

func (c *wsConn) close() error { return c.conn.Close() }

// Relay bridges the browser and the interview director. When a Gemini API key is
// present it proxies real-time audio to the Gemini Live native-audio model
// (interviewer voice + barge-in). With no key it runs a text director and the
// browser speaks the lines with the Web Speech API — so the studio works
// offline. Either way, transcripts are tapped and persisted for scoring.
// Store is the persistence the relay needs during a live session.
type Store interface {
	store.SessionRuntime
	UserByID(context.Context, string) (store.User, error)
	GetSession(ctx context.Context, id string) (store.Session, error)
	UpdateSessionStatus(ctx context.Context, id, status string) error
	AddTurn(ctx context.Context, sessionID, role, text string, tsMs int64, meta json.RawMessage) error
	Transcript(ctx context.Context, sessionID string) ([]store.Turn, error)
	LatestResume(ctx context.Context, userID string) (store.Resume, error)
}

type Relay struct {
	background    context.Context
	hosted        bool
	encryptionKey []byte
	attempt       store.Session
	owner         string
	tokenVersion  int
	store         Store
	corpus        *corpus.Catalog
	llm           llm.Client
	apiKey        string
	liveModel     string
	reasonModel   string
	upgrader      websocket.Upgrader
	authFn        func(*http.Request) (string, error)
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
	EventID string `json:"event_id"`
	Type    string `json:"type"` // start | user_text | canvas | phase | end
	Text    string `json:"text"`
}

// serverMsg is a JSON frame to the browser. Binary frames carry PCM16 audio (24kHz).
type serverMsg struct {
	Code       string     `json:"code,omitempty"`
	Retryable  bool       `json:"retryable"`
	EventID    string     `json:"event_id,omitempty"`
	DeadlineAt *time.Time `json:"deadline_at,omitempty"`
	Type       string     `json:"type"` // say | transcript | phase | section | interrupted | turn_complete | error | ready
	Role       string     `json:"role,omitempty"`
	Text       string     `json:"text,omitempty"`
	Mode       string     `json:"mode,omitempty"`      // "voice" (gemini audio) | "text" (client TTS)
	Streaming  bool       `json:"streaming,omitempty"` // true while a turn is still being transcribed; false = finalized
	// section-event fields (Type == "section"): which section is now active.
	Index int    `json:"index,omitempty"`
	Total int    `json:"total,omitempty"`
	Title string `json:"title,omitempty"`
	Kind  string `json:"kind,omitempty"`
}

func (r *Relay) SetContext(ctx context.Context)     { r.background = ctx }
func (r *Relay) SetOptions(hosted bool, key []byte) { r.hosted = hosted; r.encryptionKey = key }
func (r *Relay) Handle(w http.ResponseWriter, req *http.Request) {
	uid, err := r.authFn(req)
	if err != nil {
		http.Error(w, "unauthorized", 401)
		return
	}
	id := chi.URLParam(req, "id")
	sess, err := r.store.GetSession(req.Context(), id)
	if err != nil || sess.UserID != uid {
		http.Error(w, "session not found", 404)
		return
	}
	user, err := r.store.UserByID(req.Context(), uid)
	if err != nil || r.hosted && !user.EmailVerified {
		http.Error(w, "verified account required", 403)
		return
	}
	if r.hosted && !auth.PoliciesAccepted(user) {
		auth.PolicyRequired(w)
		return
	}
	owner := store.NewID()
	sess, err = r.store.AcquireLive(req.Context(), id, owner)
	if err != nil {
		http.Error(w, "interview is closed or connected elsewhere", 409)
		return
	}
	defer func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = r.store.ReleaseLive(ctx, id, owner)
	}()
	conn, err := r.upgrader.Upgrade(w, req, nil)
	if err != nil {
		return
	}
	defer conn.Close()
	conn.SetReadLimit(1 << 20)
	_ = conn.SetReadDeadline(time.Now().Add(pongWait))
	conn.SetPongHandler(func(string) error { return conn.SetReadDeadline(time.Now().Add(pongWait)) })
	wc := &wsConn{conn: conn}
	local := *r
	if sess.LiveModel != "" {
		local.liveModel = sess.LiveModel
	}
	local.attempt = sess
	local.owner = owner
	local.tokenVersion = user.TokenVersion
	if sess.Funding == "byok" {
		sealed, e := r.store.SessionCredential(req.Context(), id)
		if e != nil {
			_ = wc.writeServerMsg(serverMsg{Type: "error", Code: "credential_expired", Text: "Your personal key expired. Re-enter it to resume.", Retryable: false})
			return
		}
		key, e := llm.OpenKey(r.encryptionKey, uid, id, sealed)
		if e != nil {
			_ = wc.writeServerMsg(serverMsg{Type: "error", Code: "credential_unavailable", Text: "Could not unlock your personal key.", Retryable: false})
			return
		}
		local.llm, e = llm.New(req.Context(), llm.Settings{Provider: llm.Provider(sess.Provider), APIKey: key, Model: sess.Model})
		if e != nil {
			_ = wc.writeServerMsg(serverMsg{Type: "error", Code: "provider_invalid", Text: "Provider settings unavailable.", Retryable: false})
			return
		}
		local.reasonModel = sess.Model
		local.apiKey = ""
		if sess.Provider == "gemini" {
			local.apiKey = key
		}
	}
	q, ok := r.corpus.Get(sess.QuestionID)
	if len(sess.QuestionSnapshot) > 2 {
		if json.Unmarshal(sess.QuestionSnapshot, &q) == nil {
			ok = true
		}
	}
	if !ok {
		_ = wc.writeServerMsg(serverMsg{Type: "error", Code: "question_unavailable", Text: "Interview content unavailable.", Retryable: false})
		return
	}
	cfg := map[string]any{}
	_ = json.Unmarshal(sess.Config, &cfg)
	cfg["minutes"] = sess.DurationMinutes
	raw, _ := json.Marshal(cfg)
	q = corpus.ApplySessionConfig(q, raw)
	pid, intensity, voice, language, focus := parseConfig(sess.Config)
	resume := ""
	if enabled, exists := cfg["include_resume"]; !exists || enabled == true {
		resume = local.resumeSummary(req.Context(), uid)
	}
	sections := SectionPlan(q, resume != "", focus)
	artifact, e := r.store.GetArtifact(req.Context(), id)
	if e != nil {
		_ = wc.writeServerMsg(serverMsg{Type: "error", Code: "storage_unavailable", Text: "Saved work could not be loaded. Retry shortly.", Retryable: true})
		return
	}
	system := SystemPrompt(q, pid, intensity, "intro", resume, artifact.Content, sess.DurationMinutes, voice, language, sections, focus)
	if sess.Mode == "text" || local.llm.Stubbed() || local.apiKey == "" {
		local.runText(conn, id, q, system)
		return
	}
	local.runGemini(conn, id, q, system, voice, sections, sess.DurationMinutes)
}

// ---- text director (stub / no key): browser speaks via Web Speech API ----

func (r *Relay) runText(conn *websocket.Conn, sessionID string, q corpus.Question, system string) {
	ctx, cancel := context.WithDeadline(r.parentContext(), r.deadline())
	defer cancel()
	wc := &wsConn{conn: conn}
	var once sync.Once
	stop := func() { once.Do(func() { cancel(); _ = conn.Close() }) }
	defer stop()
	prior, e := r.store.Transcript(ctx, sessionID)
	if e != nil {
		return
	}
	history := []llm.Message{}
	for _, t := range prior {
		role := "user"
		if t.Role == "interviewer" {
			role = "model"
		}
		history = append(history, llm.Message{Role: role, Text: t.Text})
	}
	// A restored unanswered question must remain unanswered. Reconnects never
	// create another interviewer turn unless a saved candidate answer needs one.
	first := ""
	if len(prior) == 0 || prior[len(prior)-1].Role == "candidate" {
		call, done := context.WithTimeout(ctx, 20*time.Second)
		first, e = NextTurn(call, r.llm, r.reasonModel, system, history)
		done()
		if e != nil {
			_ = wc.writeServerMsg(serverMsg{Type: "error", Code: "provider_unavailable", Text: "The interviewer could not start. No new allowance was used.", Retryable: false})
			return
		}
	}
	r.attempt, e = r.store.ActivateLive(ctx, sessionID, r.owner)
	if e != nil {
		return
	}
	go r.watch(ctx, conn, wc, stop)
	if wc.writeServerMsg(serverMsg{Type: "ready", Mode: "text", DeadlineAt: r.attempt.DeadlineAt}) != nil {
		return
	}
	say := func(text string) error {
		if e := r.record(ctx, "interviewer", text, ""); e != nil {
			return e
		}
		history = append(history, llm.Message{Role: "model", Text: text})
		return wc.writeServerMsg(serverMsg{Type: "say", Role: "interviewer", Text: text})
	}
	if first != "" && say(first) != nil {
		return
	}
	for {
		mt, data, e := conn.ReadMessage()
		if e != nil {
			return
		}
		if mt != websocket.TextMessage {
			continue
		}
		var m clientMsg
		if json.Unmarshal(data, &m) != nil {
			continue
		}
		switch m.Type {
		case "user_text":
			if strings.TrimSpace(m.Text) == "" || len(m.Text) > 24000 || len(m.EventID) > 128 {
				continue
			}
			if e = r.record(ctx, "candidate", m.Text, m.EventID); errors.Is(e, store.ErrDuplicateEvent) {
				_ = wc.writeServerMsg(serverMsg{Type: "ack", EventID: m.EventID})
				continue
			} else if e != nil {
				_ = wc.writeServerMsg(serverMsg{Type: "error", Code: "save_failed", Text: "Your answer could not be saved. Reconnect and retry.", Retryable: true})
				return
			}
			if m.EventID != "" {
				_ = wc.writeServerMsg(serverMsg{Type: "ack", EventID: m.EventID})
			}
			history = append(history, llm.Message{Role: "user", Text: m.Text})
			call, done := context.WithTimeout(ctx, 30*time.Second)
			reply, e := NextTurn(call, r.llm, r.reasonModel, system+r.stageContext(q, wc), history)
			done()
			if e != nil {
				_ = wc.writeServerMsg(serverMsg{Type: "error", Code: "provider_unavailable", Text: "Your answer is saved. Reconnect to continue with the interviewer.", Retryable: true})
				return
			}
			if say(reply) != nil {
				return
			}
		case "canvas":
			history = append(history, llm.Message{Role: "user", Text: "[Workspace context only: " + clipText(m.Text, 12000) + "]"})
		case "end":
			_ = wc.writeServerMsg(serverMsg{Type: "saved"})
			return
		}
	}
}

// ---- Gemini Live (real audio) ----

func (r *Relay) runGemini(conn *websocket.Conn, sessionID string, q corpus.Question, system, voice string, sections []Section, durationMin int) {
	ctx, cancel := context.WithDeadline(r.parentContext(), r.deadline())
	defer cancel()

	wc := &wsConn{conn: conn}

	prior, loadErr := r.store.Transcript(ctx, sessionID)
	if loadErr != nil {
		_ = wc.writeServerMsg(serverMsg{Type: "error", Code: "save_unavailable", Text: "Saved conversation temporarily unavailable.", Retryable: true})
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
	session, err := connectGemini(ctx, r.apiKey, r.liveModel, cfg)
	if err != nil {
		// Provider errors can contain request URLs or credentials; log no raw error.
		slog.Error("live model connect failed", "session", sessionID, "model", r.liveModel)
		_ = wc.writeServerMsg(serverMsg{Type: "error", Text: "live model unavailable", Code: "provider_unavailable", Retryable: false})
		return
	}

	up := &upstream{session: session}
	r.attempt, err = r.store.ActivateLive(ctx, sessionID, r.owner)
	if err != nil {
		_ = session.Close()
		_ = wc.writeServerMsg(serverMsg{Type: "error", Code: "start_failed", Text: "Could not confirm interview start.", Retryable: true})
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
	var gracefulEnd atomic.Bool
	stop := func() {
		stopOnce.Do(func() {
			cancel()
			_ = session.Close()
			if !gracefulEnd.Load() {
				_ = wc.close()
			}
		})
	}
	defer stop()
	go r.watch(ctx, conn, wc, stop)

	_ = wc.writeServerMsg(serverMsg{Type: "ready", Mode: "voice", DeadlineAt: r.attempt.DeadlineAt})

	start := time.Now()
	if r.attempt.StartedAt != nil {
		start = *r.attempt.StartedAt
	}

	// A bounded ordered writer survives socket teardown. Typed acknowledgements
	// happen only after the same queue has committed preceding transcript turns.
	type pendingTurn struct {
		role, text, event string
		done              chan error
	}
	turns := make(chan pendingTurn, 256)
	var queueMu sync.RWMutex
	accepting := true
	enqueue := func(t pendingTurn) error {
		queueMu.RLock()
		defer queueMu.RUnlock()
		if !accepting {
			return errors.New("transcript writer stopped")
		}
		select {
		case turns <- t:
			return nil
		case <-time.After(5 * time.Second):
			return errors.New("transcript queue unavailable")
		}
	}
	persist := func(role, text string, _ int64) {
		if enqueue(pendingTurn{role: role, text: text}) != nil {
			_ = wc.writeServerMsg(serverMsg{Type: "error", Code: "save_failed", Text: "Transcript could not be saved. Please reconnect.", Retryable: true})
			stop()
		}
	}
	var persistWg sync.WaitGroup
	persistWg.Add(1)
	go func() {
		defer persistWg.Done()
		for t := range turns {
			e := r.record(context.Background(), t.role, t.text, t.event)
			if t.done != nil {
				t.done <- e
			}
			if e != nil && !errors.Is(e, store.ErrDuplicateEvent) {
				_ = wc.writeServerMsg(serverMsg{Type: "error", Code: "save_failed", Text: "Transcript could not be saved. Please reconnect.", Retryable: true})
				stop()
			}
		}
	}()
	up.onError = func() {
		_ = wc.writeServerMsg(serverMsg{Type: "error", Code: "provider_unavailable", Text: "The provider connection ended. Your saved work can be resumed.", Retryable: true})
		stop()
	}

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
	var transcriptMu sync.Mutex
	var interviewerSpeaking, discardInterruptedOutput atomic.Bool
	var curRole, curText string
	flushLocked := func() {
		if curText == "" {
			return
		}
		persist(curRole, curText, time.Since(start).Milliseconds())
		_ = wc.writeServerMsg(serverMsg{Type: "transcript", Role: curRole, Text: curText, Streaming: false})
		curRole, curText = "", ""
	}
	flush := func() { transcriptMu.Lock(); defer transcriptMu.Unlock(); flushLocked() }
	accumulate := func(role, chunk string) {
		transcriptMu.Lock()
		defer transcriptMu.Unlock()
		if chunk == "" {
			return
		}
		if curRole != "" && curRole != role {
			flushLocked()
		}
		curRole = role
		curText += chunk
		// GO-13: a failed write means the client is gone — tear down instead of
		// swallowing the error and looping.
		if err := wc.writeServerMsg(serverMsg{Type: "transcript", Role: role, Text: curText, Streaming: true}); err != nil {
			stop()
		}
	}
	go func() {
		defer wg.Done()
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
						_ = up.tool(genai.LiveToolResponseInput{FunctionResponses: []*genai.FunctionResponse{{ID: fc.ID, Name: fc.Name, Response: map[string]any{"ok": true}}}})
						flush()
						emitEnded()
						ended = true
					}
				}
				if ended {
					// Mark the session complete and tear the whole relay down instead of
					// continuing the receive loop with a session the interviewer ended.
					uctx, ucancel := context.WithTimeout(context.Background(), persistBound)
					_ = r.store.BeginTimedFinish(uctx, sessionID)
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
			if sc.Interrupted {
				flush()
				interviewerSpeaking.Store(false)
				discardInterruptedOutput.Store(false)
				_ = wc.writeServerMsg(serverMsg{Type: "interrupted"})
			}
			if sc.ModelTurn != nil && !discardInterruptedOutput.Load() {
				interviewerSpeaking.Store(true)
				for _, p := range sc.ModelTurn.Parts {
					if p.InlineData != nil && len(p.InlineData.Data) > 0 {
						if err := wc.writeBinary(p.InlineData.Data); err != nil {
							stop()
							return
						}
					}
				}
			}
			if sc.OutputTranscription != nil && !discardInterruptedOutput.Load() {
				interviewerSpeaking.Store(true)
				accumulate("interviewer", sc.OutputTranscription.Text)
			}
			if sc.InputTranscription != nil {
				accumulate("candidate", sc.InputTranscription.Text)
			}
			if sc.TurnComplete {
				interviewerSpeaking.Store(false)
				discardInterruptedOutput.Store(false)
				flush()
				_ = wc.writeServerMsg(serverMsg{Type: "turn_complete"})
			}
		}
	}()

	// Kick off the interviewer's turn. If there's already a transcript, this is a
	// RESUME (reconnect after a drop, or the candidate returning) — feed the
	// conversation so far and tell the interviewer to CONTINUE, never restart or
	// re-greet. Otherwise it's a fresh start.
	if len(prior) == 0 {
		_ = up.content(genai.LiveClientContentInput{
			Turns:        []*genai.Content{genai.NewContentFromText("Begin with the authored opening for the active stage. Follow the format timing: a brief introduction only; do not add small talk or resume questions when the format excludes them. Ask one question and wait for the candidate.", genai.RoleUser)},
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
		_ = up.content(genai.LiveClientContentInput{
			Turns:        []*genai.Content{genai.NewContentFromText(b.String(), genai.RoleUser)},
			TurnComplete: genai.Ptr(false),
		})
		if prior[len(prior)-1].Role == "candidate" {
			_ = up.content(genai.LiveClientContentInput{Turns: []*genai.Content{genai.NewContentFromText("Continue naturally from the last saved candidate answer. Do not greet, restart, or repeat a question already answered.", genai.RoleUser)}, TurnComplete: genai.Ptr(true)})
		}

	}

	// SECTION PROGRESSION. Announce the first section (intro) right after the
	// greeting kick-off, then drive transitions on TIME: intro gets the first few
	// minutes, wrap the last couple, and the middle sections split the remainder
	// evenly. Each transition (a) injects a context-only "[SECTION CHANGE → ...]"
	// directive to Gemini (TurnComplete=false, so it steers WITHOUT forcing a
	// barge-in) and (b) emits a `section` event to the browser. All browser writes
	// go through the single wsConn writer; the goroutine exits on ctx cancel.
	go func() {
		sched := SectionSchedule(time.Duration(durationMin)*time.Minute, sections)
		stage := 0
		for i, at := range sched {
			if time.Since(start) >= at {
				stage = i + 1
			}
		}
		emit := func(i int) bool {
			sec := sections[i]
			if up.content(genai.LiveClientContentInput{Turns: []*genai.Content{genai.NewContentFromText("[ACTIVE STAGE: "+sec.Title+". "+sec.Guidance+"]", genai.RoleUser)}, TurnComplete: genai.Ptr(false)}) != nil {
				return false
			}
			return wc.writeServerMsg(serverMsg{Type: "section", Index: i, Total: len(sections), Title: sec.Title, Kind: sec.Kind}) == nil
		}
		if len(sections) > 0 && !emit(stage) {
			return
		}
		for i, at := range sched {
			if i+1 <= stage {
				continue
			}
			timer := time.NewTimer(max(at-time.Since(start), 0))
			select {
			case <-ctx.Done():
				timer.Stop()
				return
			case <-timer.C:
			}
			if !emit(i + 1) {
				return
			}
		}
	}()

	// Browser → Gemini: audio (binary) + control (JSON).
readLoop:
	for {
		mt, data, err := conn.ReadMessage()
		if err != nil {
			break
		}
		switch mt {
		case websocket.BinaryMessage:
			_ = up.audio(genai.LiveRealtimeInput{
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
				_ = up.content(genai.LiveClientContentInput{
					Turns:        []*genai.Content{genai.NewContentFromText("[The candidate's diagram now shows: "+clipText(m.Text, 12000)+"]", genai.RoleUser)},
					TurnComplete: genai.Ptr(false),
				})
			case "user_text":
				// A typed answer IS a completed candidate turn — PERSIST it (Gemini
				// won't echo typed text back as an input transcription, so without
				// this the scorer would never see typed answers) and prompt a reply.
				// Persistence goes through the off-hot-path channel (GO-2), and the
				// echo through the serialized writer (GO-1) — this write races the
				// reader goroutine's audio/transcript writes.
				if strings.TrimSpace(m.Text) != "" && len(m.Text) <= 24000 && len(m.EventID) <= 128 {
					if interviewerSpeaking.Load() {
						discardInterruptedOutput.Store(true)
					}
					flush()
					_ = wc.writeServerMsg(serverMsg{Type: "interrupted"})
					ack := make(chan error, 1)
					if enqueue(pendingTurn{role: "candidate", text: m.Text, event: m.EventID, done: ack}) != nil {
						break readLoop
					}
					saveErr := <-ack
					if errors.Is(saveErr, store.ErrDuplicateEvent) {
						_ = wc.writeServerMsg(serverMsg{Type: "ack", EventID: m.EventID})
						continue
					}
					if saveErr != nil {
						_ = wc.writeServerMsg(serverMsg{Type: "error", Code: "save_failed", Text: "Your answer could not be saved. Retry after reconnecting.", Retryable: true})
						break readLoop
					}
					if m.EventID != "" {
						_ = wc.writeServerMsg(serverMsg{Type: "ack", EventID: m.EventID})
					}
					_ = wc.writeServerMsg(serverMsg{Type: "transcript", Role: "candidate", Text: m.Text, Streaming: false})
				}
				if strings.TrimSpace(m.Text) == "" || len(m.Text) > 24000 || len(m.EventID) > 128 {
					continue
				}
				_ = up.audio(genai.LiveRealtimeInput{Text: m.Text})
			case "nudge":
				_ = up.content(genai.LiveClientContentInput{
					Turns:        []*genai.Content{genai.NewContentFromText("[The candidate has been quiet for a while. Give ONE short, friendly nudge like 'Take your time — whenever you're ready, walk me through it.' Do NOT repeat the question or answer it, then wait silently.]", genai.RoleUser)},
					TurnComplete: genai.Ptr(true),
				})
			case "time":
				// Periodic time-remaining update as CONTEXT only (no forced reply).
				_ = up.content(genai.LiveClientContentInput{
					Turns:        []*genai.Content{genai.NewContentFromText(fmt.Sprintf("[Time check: %d seconds remain on the server clock. Pace accordingly; when time is nearly up, give a brief closing and call end_interview.]", max(0, int(time.Until(*r.attempt.DeadlineAt).Seconds()))), genai.RoleUser)},
					TurnComplete: genai.Ptr(false),
				})
			case "end":
				gracefulEnd.Store(true)
				break readLoop
			}
		}
	}

	// Teardown: cancel + force-close so the reader goroutine's blocked
	// session.Receive() errors out, then wait for it (bounded), then drain and
	// wait for the persistence goroutine so no finished turn is lost (GO-3).
	stop()
	readerDrained := waitTimeout(&wg, writeWait)
	queueMu.Lock()
	accepting = false
	close(turns)
	queueMu.Unlock()
	// All acknowledged typed turns are already committed. Closing the queue also
	// prevents a delayed SDK reader from enqueuing after the lease is released.
	persistDrained := waitTimeout(&persistWg, writeWait)
	if gracefulEnd.Load() {
		closeCode := websocket.CloseNormalClosure
		if readerDrained && persistDrained {
			_ = wc.writeServerMsg(serverMsg{Type: "saved"})
		} else {
			closeCode = websocket.CloseInternalServerErr
			_ = wc.writeServerMsg(serverMsg{Type: "error", Code: "save_unavailable", Text: "Some final speech could not be confirmed saved. Review your transcript.", Retryable: false})
		}
		// Complete the WebSocket closing handshake after the final save result.
		// Closing TCP immediately reports an abnormal 1006 to browser/proxy
		// clients, even when the final application message was written locally.
		if wc.writeClose(closeCode) == nil {
			_ = conn.SetReadDeadline(time.Now().Add(time.Second))
			for {
				if _, _, err := conn.ReadMessage(); err != nil {
					break
				}
			}
		}
		_ = wc.close()
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

// sectionSchedule returns, for an n-section plan running for total, the elapsed
// time at which to transition INTO each section 1..n-1 (so the returned slice
// has length n-1; index i is the transition into section i+1). Section 0 (intro)
// starts at t=0. The intro gets the first ~3.5 min, wrap the last ~2.5 min, and
// the middle sections split the remainder evenly. Boundaries are clamped so a
// short interview still yields a sane, monotonic schedule.
func sectionSchedule(total time.Duration, n int) []time.Duration {
	if n <= 1 {
		return nil
	}
	introDur := 3*time.Minute + 30*time.Second
	wrapDur := 2*time.Minute + 30*time.Second
	// Clamp for short interviews so intro+wrap never swallow the whole thing.
	if introDur+wrapDur > total {
		introDur = total / 4
		wrapDur = total / 4
	}
	out := make([]time.Duration, n-1)
	// Wrap (last section) starts at total-wrapDur.
	out[n-2] = total - wrapDur
	middle := n - 2 // sections between intro and wrap
	if middle >= 1 {
		per := (total - introDur - wrapDur) / time.Duration(middle)
		if per < 0 {
			per = 0
		}
		for k := 1; k <= middle; k++ {
			out[k-1] = introDur + time.Duration(k-1)*per
		}
	}
	// Guarantee monotonic non-decreasing transitions.
	for i := 1; i < len(out); i++ {
		if out[i] < out[i-1] {
			out[i] = out[i-1]
		}
	}
	return out
}

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

func parseConfig(cfg json.RawMessage) (personaID string, intensity int, voice, language, roundFocus string) {
	def := store.DefaultConfig() // single source of truth for defaults (from persona catalogs)
	personaID, intensity, voice = def.Personality, def.Intensity, def.VoiceID
	language = persona.DefaultLanguageCode()
	var c struct {
		Personality string `json:"personality"`
		Intensity   int    `json:"intensity"`
		VoiceID     string `json:"voice_id"`
		Language    string `json:"language"`
		RoundFocus  string `json:"round_focus"`
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
		roundFocus = strings.TrimSpace(c.RoundFocus)
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
