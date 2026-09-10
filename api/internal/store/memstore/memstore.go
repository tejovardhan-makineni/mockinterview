// Package memstore is an in-memory implementation of the data layer used by
// tests. It satisfies the consumer-defined Repo interfaces in the feature
// packages (auth, profile, resume, interview) and scoring.ReportStore, so the
// whole HTTP API can be exercised with `go test ./...` — no Postgres, no
// migrations, no Gemini. It mirrors the not-found and default semantics of the
// real *store.Store closely enough for handler-level tests.
package memstore

import (
	"context"
	"encoding/json"
	"sort"
	"sync"
	"time"

	"github.com/tejo/mockinterview-api/internal/store"
)

type sessionRec struct {
	artifact          store.Workspace
	owner             string
	lease             time.Time
	credential        []byte
	credentialExpires time.Time
	job               *store.ScoringJob
	jobState          string
	jobLease          time.Time
	jobNotBefore      time.Time
	eventIDs          map[string]bool
	sess              store.Session
	seq               int64     // insertion order, for "created_at DESC"
	created           time.Time // for CreatedAt + the "sessions today" filter
	turns             []store.Turn
	workspace         string
	canvas            json.RawMessage
	events            []string // event kinds, for BehavioralSummary counts
}

type reportRec struct {
	report store.Report
	scores []store.ScoreRow
}

// Compile-time proof the in-memory store implements the full production
// contract, enforced by `go build` (not just when tests run) so it stays in
// lockstep with *store.Store's identical assertion (ARCH-6).
var _ store.Datastore = (*Mem)(nil)

// Mem is a thread-safe in-memory Repo. Construct with New().
type Mem struct {
	runtimeUsage []usageRec
	authActions  map[string]authAction
	mu           sync.Mutex
	seq          int64
	users        map[string]store.User      // id -> user
	byEmail      map[string]string          // email -> id
	settings     map[string]json.RawMessage // userID -> settings
	configs      map[string]store.InterviewConfig
	resumes      map[string][]store.Resume // userID -> resumes (append order)
	sessions     map[string]*sessionRec    // sessionID -> record
	reports      map[string]*reportRec     // sessionID -> report
	feedback     []store.Feedback          // append order (newest last)
}

// New returns an empty in-memory store.
func New() *Mem {
	return &Mem{
		users:    map[string]store.User{},
		byEmail:  map[string]string{},
		settings: map[string]json.RawMessage{},
		configs:  map[string]store.InterviewConfig{},
		resumes:  map[string][]store.Resume{},
		sessions: map[string]*sessionRec{},
		reports:  map[string]*reportRec{},
	}
}

// ---- feedback ----

func (m *Mem) SaveFeedback(_ context.Context, userID, kind, message string, rating int, contextJSON json.RawMessage) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if len(contextJSON) == 0 {
		contextJSON = json.RawMessage(`{}`)
	}
	id := store.NewID()
	email := ""
	if u, ok := m.users[userID]; ok {
		email = u.Email
	}
	m.feedback = append(m.feedback, store.Feedback{
		ID: id, UserID: userID, Email: email, Kind: kind, Message: message, Status: "new",
		Rating: rating, Context: contextJSON, CreatedAt: time.Now().UTC().Format("2006-01-02T15:04:05"),
	})
	return id, nil
}

func (m *Mem) ListFeedback(_ context.Context, limit int) ([]store.Feedback, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if limit <= 0 || limit > 500 {
		limit = 200
	}
	out := make([]store.Feedback, 0, len(m.feedback))
	for i := len(m.feedback) - 1; i >= 0 && len(out) < limit; i-- { // newest first
		out = append(out, m.feedback[i])
	}
	return out, nil
}

// ---- users ----

func (m *Mem) CreateUser(_ context.Context, email, passwordHash string) (store.User, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	u := store.User{ID: store.NewID(), Email: email, PasswordHash: passwordHash}
	m.users[u.ID] = u
	m.byEmail[email] = u.ID
	return u, nil
}

func (m *Mem) UserByEmail(_ context.Context, email string) (store.User, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	id, ok := m.byEmail[email]
	if !ok {
		return store.User{}, store.ErrNotFound
	}
	return m.users[id], nil
}

func (m *Mem) UserByID(_ context.Context, id string) (store.User, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	u, ok := m.users[id]
	if !ok {
		return store.User{}, store.ErrNotFound
	}
	return u, nil
}

func (m *Mem) GetSettings(_ context.Context, userID string) (json.RawMessage, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	raw, ok := m.settings[userID]
	if !ok || len(raw) == 0 {
		return json.RawMessage(`{}`), nil
	}
	return raw, nil
}

func (m *Mem) SaveSettings(_ context.Context, userID string, settings json.RawMessage) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if len(settings) == 0 {
		settings = json.RawMessage(`{}`)
	}
	m.settings[userID] = settings
	return nil
}

func (m *Mem) DeleteUser(_ context.Context, userID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if u, ok := m.users[userID]; ok {
		delete(m.byEmail, u.Email)
	}
	retained := m.feedback[:0]
	for _, item := range m.feedback {
		if item.UserID != userID {
			retained = append(retained, item)
		}
	}
	m.feedback = retained
	delete(m.users, userID)
	delete(m.settings, userID)
	delete(m.configs, userID)
	delete(m.resumes, userID)
	for id, rec := range m.sessions { // cascade sessions + their reports
		if rec.sess.UserID == userID {
			delete(m.sessions, id)
			delete(m.reports, id)
		}
	}
	return nil
}

// ---- config ----

func (m *Mem) GetConfig(_ context.Context, userID string) (store.InterviewConfig, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if c, ok := m.configs[userID]; ok {
		return c, nil
	}
	return store.DefaultConfig(), nil
}

func (m *Mem) SaveConfig(_ context.Context, userID string, c store.InterviewConfig) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.configs[userID] = c
	return nil
}

// ---- resumes ----

func (m *Mem) SaveResume(_ context.Context, userID, filename, parsedText string, parsedJSON json.RawMessage) (store.Resume, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	r := store.Resume{ID: store.NewID(), Filename: filename, ParsedText: parsedText, ParsedJSON: parsedJSON}
	m.resumes[userID] = append(m.resumes[userID], r)
	return r, nil
}

func (m *Mem) LatestResume(_ context.Context, userID string) (store.Resume, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	rs := m.resumes[userID]
	if len(rs) == 0 {
		return store.Resume{}, store.ErrNotFound
	}
	return rs[len(rs)-1], nil
}

func (m *Mem) SaveResumeReview(_ context.Context, _, _, _, _ string, _ json.RawMessage) (string, error) {
	return store.NewID(), nil
}

// ---- sessions ----

func (m *Mem) CreateSession(_ context.Context, userID, questionID, modality, track, packID, roundID string, cfg json.RawMessage) (store.Session, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if len(cfg) == 0 {
		cfg = json.RawMessage(`{}`)
	}
	m.seq++
	sess := store.Session{
		ID: store.NewID(), UserID: userID, QuestionID: questionID, Modality: modality,
		Track: track, Status: "created", Phase: "lobby", Config: cfg,
		PackID: packID, PackRoundID: roundID,
	}
	m.sessions[sess.ID] = &sessionRec{sess: sess, seq: m.seq, created: time.Now()}
	return sess, nil
}

// SessionsForPack returns the user's sessions belonging to a pack (newest first).
func (m *Mem) SessionsForPack(_ context.Context, userID, packID string) ([]store.SessionSummary, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	recs := make([]*sessionRec, 0)
	for _, rec := range m.sessions {
		if rec.sess.UserID == userID && rec.sess.PackID == packID {
			recs = append(recs, rec)
		}
	}
	sort.Slice(recs, func(i, j int) bool { return recs[i].seq > recs[j].seq })
	out := make([]store.SessionSummary, 0, len(recs))
	for _, rec := range recs {
		ss := store.SessionSummary{
			ID: rec.sess.ID, QuestionID: rec.sess.QuestionID, Modality: rec.sess.Modality,
			Track: rec.sess.Track, Status: rec.sess.Status,
			CreatedAt:   rec.created.UTC().Format("2006-01-02T15:04:05"),
			PackID:      rec.sess.PackID,
			PackRoundID: rec.sess.PackRoundID,
		}
		if rep, ok := m.reports[rec.sess.ID]; ok {
			overall := rep.report.Overall
			scored := rep.report.Scored
			ss.Overall = &overall
			ss.Scored = &scored
		}
		out = append(out, ss)
	}
	return out, nil
}

// CountSessionsToday mirrors the SQL store: only sessions created since local
// midnight count toward the daily limit.
func (m *Mem) CountSessionsToday(_ context.Context, userID string) (int, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	now := time.Now()
	startOfDay := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	n := 0
	for _, rec := range m.sessions {
		if rec.sess.UserID == userID && !rec.created.Before(startOfDay) {
			n++
		}
	}
	return n, nil
}

func (m *Mem) ListUserSessions(_ context.Context, userID string, limit int) ([]store.SessionSummary, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	recs := make([]*sessionRec, 0)
	for _, rec := range m.sessions {
		if rec.sess.UserID == userID {
			recs = append(recs, rec)
		}
	}
	sort.Slice(recs, func(i, j int) bool { return recs[i].seq > recs[j].seq }) // newest first
	out := make([]store.SessionSummary, 0, len(recs))
	for _, rec := range recs {
		if len(out) >= limit {
			break
		}
		ss := store.SessionSummary{
			ID: rec.sess.ID, QuestionID: rec.sess.QuestionID, Modality: rec.sess.Modality,
			Track: rec.sess.Track, Status: rec.sess.Status,
			CreatedAt:   rec.created.UTC().Format("2006-01-02T15:04:05"),
			PackID:      rec.sess.PackID,
			PackRoundID: rec.sess.PackRoundID,
		}
		if rep, ok := m.reports[rec.sess.ID]; ok {
			overall := rep.report.Overall
			scored := rep.report.Scored
			ss.Overall = &overall
			ss.Scored = &scored
		}
		out = append(out, ss)
	}
	return out, nil
}

func (m *Mem) GetSession(_ context.Context, id string) (store.Session, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	rec, ok := m.sessions[id]
	if !ok {
		return store.Session{}, store.ErrNotFound
	}
	return rec.sess, nil
}

func (m *Mem) UpdateSessionPhase(_ context.Context, id, phase string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if rec, ok := m.sessions[id]; ok {
		rec.sess.Phase = phase
	}
	return nil
}

func (m *Mem) UpdateSessionStatus(_ context.Context, id, status string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if rec, ok := m.sessions[id]; ok {
		rec.sess.Status = status
	}
	return nil
}

func (m *Mem) AddTurn(_ context.Context, sessionID, role, text string, tsMs int64, meta json.RawMessage) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if rec, ok := m.sessions[sessionID]; ok {
		if rec.sess.Status != "active" && rec.sess.Status != "interrupted" && rec.sess.Status != "reserved" && rec.sess.Status != "created" && rec.sess.Status != "ending" {
			return store.ErrSessionConflict
		}
		var ev struct {
			EventID    string `json:"event_id"`
			LeaseOwner string `json:"lease_owner"`
		}
		_ = json.Unmarshal(meta, &ev)
		if ev.LeaseOwner != "" && (rec.owner != ev.LeaseOwner || !rec.lease.After(time.Now())) {
			return store.ErrSessionConflict
		}
		if rec.eventIDs == nil {
			rec.eventIDs = map[string]bool{}
		}
		if ev.EventID != "" && rec.eventIDs[ev.EventID] {
			return store.ErrDuplicateEvent
		}
		if ev.EventID != "" {
			rec.eventIDs[ev.EventID] = true
		}
		origin := rec.created
		if rec.sess.StartedAt != nil {
			origin = *rec.sess.StartedAt
		}
		rec.turns = append(rec.turns, store.Turn{ID: store.NewID(), EventID: ev.EventID, Sequence: int64(len(rec.turns) + 1), Role: role, Text: text, TsMs: time.Since(origin).Milliseconds()})
	}
	return nil
}

func (m *Mem) Transcript(_ context.Context, sessionID string) ([]store.Turn, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if rec, ok := m.sessions[sessionID]; ok {
		return append([]store.Turn(nil), rec.turns...), nil
	}
	return nil, nil
}

func (m *Mem) AddCanvasSnapshot(_ context.Context, sessionID string, _ int64, elements json.RawMessage, _ string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if rec, ok := m.sessions[sessionID]; ok {
		rec.canvas = elements
	}
	return nil
}

func (m *Mem) AddWorkspaceSnapshot(_ context.Context, sessionID string, _ int64, _, content string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if rec, ok := m.sessions[sessionID]; ok {
		rec.workspace = content
	}
	return nil
}

func (m *Mem) LatestWorkspace(_ context.Context, sessionID string) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if rec, ok := m.sessions[sessionID]; ok {
		return rec.workspace, nil
	}
	return "", nil
}

func (m *Mem) LatestCanvasElements(_ context.Context, sessionID string) (json.RawMessage, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if rec, ok := m.sessions[sessionID]; ok {
		return rec.canvas, nil
	}
	return nil, nil
}

// ---- behavior ----

func (m *Mem) AddBehaviorSample(_ context.Context, _ string, _ int64, _, _, _, _, _, _, _ json.RawMessage) error {
	return nil
}

func (m *Mem) AddEvent(_ context.Context, sessionID string, _ int64, kind string, _ json.RawMessage) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if rec, ok := m.sessions[sessionID]; ok {
		rec.events = append(rec.events, kind)
	}
	return nil
}

func (m *Mem) BehavioralSummary(_ context.Context, _ string) (json.RawMessage, error) {
	return json.RawMessage(`{}`), nil
}

// ---- reports ----

func (m *Mem) SaveScores(_ context.Context, sessionID string, rows []store.ScoreRow) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	r := m.reports[sessionID]
	if r == nil {
		r = &reportRec{}
		m.reports[sessionID] = r
	}
	r.scores = append([]store.ScoreRow(nil), rows...)
	return nil
}

func (m *Mem) SaveReport(_ context.Context, sessionID string, overall float64, radar, timeline, behavioral json.RawMessage, coachingMD string, scored bool, note string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	r := m.reports[sessionID]
	if r == nil {
		r = &reportRec{}
		m.reports[sessionID] = r
	}
	r.report = store.Report{
		Overall: overall, Radar: radar, Timeline: timeline, Behavioral: behavioral,
		CoachingMD: coachingMD, Scored: scored, Note: note,
	}
	return nil
}

func (m *Mem) GetReport(_ context.Context, sessionID string) (store.Report, []store.ScoreRow, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	r, ok := m.reports[sessionID]
	if !ok {
		return store.Report{}, nil, store.ErrNotFound
	}
	return r.report, append([]store.ScoreRow(nil), r.scores...), nil
}
