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
	sess      store.Session
	seq       int64     // insertion order, for "created_at DESC"
	created   time.Time // for CreatedAt + the "sessions today" filter
	turns     []store.Turn
	workspace string
	canvas    json.RawMessage
	events    []string // event kinds, for BehavioralSummary counts
}

type reportRec struct {
	report store.Report
	scores []store.ScoreRow
}

// Mem is a thread-safe in-memory Repo. Construct with New().
type Mem struct {
	mu       sync.Mutex
	seq      int64
	users    map[string]store.User      // id -> user
	byEmail  map[string]string          // email -> id
	settings map[string]json.RawMessage // userID -> settings
	configs  map[string]store.InterviewConfig
	resumes  map[string][]store.Resume // userID -> resumes (append order)
	sessions map[string]*sessionRec    // sessionID -> record
	reports  map[string]*reportRec     // sessionID -> report
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

func (m *Mem) CreateSession(_ context.Context, userID, questionID, modality, track string, cfg json.RawMessage) (store.Session, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if len(cfg) == 0 {
		cfg = json.RawMessage(`{}`)
	}
	m.seq++
	sess := store.Session{
		ID: store.NewID(), UserID: userID, QuestionID: questionID, Modality: modality,
		Track: track, Status: "created", Phase: "lobby", Config: cfg,
	}
	m.sessions[sess.ID] = &sessionRec{sess: sess, seq: m.seq, created: time.Now()}
	return sess, nil
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
			CreatedAt: rec.created.UTC().Format("2006-01-02T15:04:05"),
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

func (m *Mem) AddTurn(_ context.Context, sessionID, role, text string, tsMs int64, _ json.RawMessage) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if rec, ok := m.sessions[sessionID]; ok {
		rec.turns = append(rec.turns, store.Turn{Role: role, Text: text, TsMs: tsMs})
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
