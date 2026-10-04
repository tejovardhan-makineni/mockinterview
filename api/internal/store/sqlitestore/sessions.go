package sqlitestore

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"time"

	"github.com/tejo/mockinterview-api/internal/store"
)

// Explicit private fields are essential: Session's public JSON deliberately
// omits its owner, question snapshot and quota identity.
type sessionDocument struct {
	Session          store.Session
	UserID           string
	QuestionSnapshot json.RawMessage
	UsageIdentity    string
	EndedAt          *time.Time
	LeaseOwner       string
	LeaseUntil       time.Time
	QuotaExempt      bool
	GlobalDailyLimit int
	RuntimeErrors    int
}

func readSession(ctx context.Context, q querier, id string) (sessionDocument, error) {
	d, e := readJSON[sessionDocument](ctx, q, `SELECT data FROM sessions WHERE id=?`, id)
	restoreSession(&d)
	return d, e
}
func restoreSession(d *sessionDocument) {
	d.Session.UserID = d.UserID
	d.Session.QuestionSnapshot = d.QuestionSnapshot
	d.Session.UsageIdentity = d.UsageIdentity
}
func saveSession(ctx context.Context, q executor, d sessionDocument) error {
	d.UserID = d.Session.UserID
	d.QuestionSnapshot = normalizeJSON(d.Session.QuestionSnapshot)
	d.UsageIdentity = d.Session.UsageIdentity
	d.Session.Config = normalizeJSON(d.Session.Config)
	return execJSON(ctx, q, `INSERT INTO sessions(id,user_id,status,created_at,data) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,data=excluded.data`, d, d.Session.ID, d.UserID, d.Session.Status, d.Session.CreatedAt.UnixMilli())
}
func readSessions(ctx context.Context, q querier, where string, args ...any) ([]sessionDocument, error) {
	out, e := listJSON[sessionDocument](ctx, q, `SELECT data FROM sessions `+where, args...)
	for i := range out {
		restoreSession(&out[i])
	}
	return out, e
}
func (s *Store) CreateSession(ctx context.Context, uid, qid, modality, track, pack, round string, cfg json.RawMessage) (store.Session, error) {
	a := store.Session{ID: store.NewID(), UserID: uid, QuestionID: qid, Modality: modality, Track: track, Status: "created", Phase: "lobby", Config: normalizeJSON(cfg), PackID: pack, PackRoundID: round, CreatedAt: time.Now().UTC()}
	until := a.CreatedAt.Add(10 * time.Minute)
	a.ReservedUntil = &until
	return a, saveSession(ctx, s.db, sessionDocument{Session: a})
}
func (s *Store) GetSession(ctx context.Context, id string) (store.Session, error) {
	d, e := readSession(ctx, s.db, id)
	return d.Session, e
}
func (s *Store) CountSessionsToday(ctx context.Context, uid string) (int, error) {
	now := time.Now()
	start := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	var n int
	e := s.db.QueryRowContext(ctx, `SELECT count(*) FROM sessions WHERE user_id=? AND created_at>=?`, uid, start.UnixMilli()).Scan(&n)
	return n, e
}
func (s *Store) ListUserSessions(ctx context.Context, uid string, limit int) ([]store.SessionSummary, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	return s.summaries(ctx, uid, "", limit)
}
func (s *Store) SessionsForPack(ctx context.Context, uid, pack string) ([]store.SessionSummary, error) {
	return s.summaries(ctx, uid, pack, 0)
}
func (s *Store) summaries(ctx context.Context, uid, pack string, limit int) (out []store.SessionSummary, err error) {
	out = []store.SessionSummary{}
	err = s.write(ctx, func(tx *sql.Tx) error {
		documents, e := readSessions(ctx, tx, `WHERE user_id=? ORDER BY created_at DESC,id DESC`, uid)
		if e != nil {
			return e
		}
		for _, d := range documents {
			a := d.Session
			if pack != "" && a.PackID != pack {
				continue
			}
			item := store.SessionSummary{ID: a.ID, QuestionID: a.QuestionID, Modality: a.Modality, Track: a.Track, Status: a.Status, CreatedAt: a.CreatedAt.UTC().Format(time.RFC3339Nano), PackID: a.PackID, PackRoundID: a.PackRoundID}
			var question struct {
				Title string `json:"title"`
			}
			_ = json.Unmarshal(a.QuestionSnapshot, &question)
			item.QuestionTitle = question.Title
			r, e := readJSON[store.Report](ctx, tx, `SELECT data FROM reports WHERE session_id=?`, a.ID)
			if e == nil {
				item.Overall = &r.Overall
				item.Scored = &r.Scored
			} else if !errors.Is(e, store.ErrNotFound) {
				return e
			}
			out = append(out, item)
			if limit > 0 && len(out) >= limit {
				break
			}
		}
		return nil
	})
	return
}
func (s *Store) UpdateSessionPhase(ctx context.Context, id, phase string) error {
	return s.changeSession(ctx, id, func(d *sessionDocument) error { d.Session.Phase = phase; return nil })
}
func (s *Store) UpdateSessionStatus(ctx context.Context, id, status string) error {
	return s.changeSession(ctx, id, func(d *sessionDocument) error {
		d.Session.Status = status
		if (status == "complete" || status == "abandoned") && d.EndedAt == nil {
			now := time.Now().UTC()
			d.EndedAt = &now
		}
		return nil
	})
}
func (s *Store) changeSession(ctx context.Context, id string, fn func(*sessionDocument) error) error {
	return s.write(ctx, func(tx *sql.Tx) error {
		d, e := readSession(ctx, tx, id)
		if e != nil {
			return e
		}
		if e = fn(&d); e != nil {
			return e
		}
		return saveSession(ctx, tx, d)
	})
}
func (s *Store) AddTurn(ctx context.Context, id, role, text string, _ int64, meta json.RawMessage) error {
	return s.write(ctx, func(tx *sql.Tx) error {
		d, e := readSession(ctx, tx, id)
		if e != nil {
			return e
		}
		var fields struct {
			EventID    string `json:"event_id"`
			LeaseOwner string `json:"lease_owner"`
		}
		meta = normalizeJSON(meta)
		if e = json.Unmarshal(meta, &fields); e != nil {
			return e
		}
		if fields.EventID != "" {
			var exists bool
			if e = tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM transcript_turns WHERE session_id=? AND event_id=?)`, id, fields.EventID).Scan(&exists); e != nil {
				return e
			}
			if exists {
				return store.ErrDuplicateEvent
			}
		}
		if !oneOf(d.Session.Status, "created", "reserved", "active", "interrupted", "ending") || fields.LeaseOwner != "" && (d.LeaseOwner != fields.LeaseOwner || !d.LeaseUntil.After(time.Now())) {
			return store.ErrSessionConflict
		}
		origin := d.Session.CreatedAt
		if d.Session.StartedAt != nil {
			origin = *d.Session.StartedAt
		}
		elapsed := max(int64(0), time.Since(origin).Milliseconds())
		turn := store.Turn{ID: store.NewID(), EventID: fields.EventID, Role: role, Text: text, TsMs: elapsed}
		var event any
		if fields.EventID != "" {
			event = fields.EventID
		}
		return execJSON(ctx, tx, `INSERT INTO transcript_turns(id,session_id,event_id,meta,data) VALUES(?,?,?,?,?)`, turn, turn.ID, id, event, string(meta))
	})
}
func (s *Store) Transcript(ctx context.Context, id string) ([]store.Turn, error) {
	rows, e := s.db.QueryContext(ctx, `SELECT sequence,data FROM transcript_turns WHERE session_id=? ORDER BY sequence`, id)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := []store.Turn{}
	for rows.Next() {
		var t store.Turn
		var b []byte
		var seq int64
		if e = rows.Scan(&seq, &b); e != nil {
			return nil, e
		}
		if e = json.Unmarshal(b, &t); e != nil {
			return nil, e
		}
		t.Sequence = seq
		out = append(out, t)
	}
	return out, rows.Err()
}
func (s *Store) AddWorkspaceSnapshot(ctx context.Context, id string, ts int64, kind, content string) error {
	return s.write(ctx, func(tx *sql.Tx) error {
		_, e := insertWorkspace(ctx, tx, id, ts, store.Workspace{Kind: kind, Content: content})
		return e
	})
}
func insertWorkspace(ctx context.Context, tx *sql.Tx, id string, ts int64, w store.Workspace) (store.Workspace, error) {
	var revision int64
	if e := tx.QueryRowContext(ctx, `SELECT coalesce(max(revision),0) FROM workspace_snapshots WHERE session_id=?`, id).Scan(&revision); e != nil {
		return w, e
	}
	if w.Revision > 0 && w.Revision != revision+1 {
		return w, store.ErrSessionConflict
	}
	w.Revision = revision + 1
	w.Data = normalizeJSON(w.Data)
	e := execJSON(ctx, tx, `INSERT INTO workspace_snapshots(session_id,revision,ts_ms,data) VALUES(?,?,?,?)`, w, id, w.Revision, ts)
	return w, e
}
func (s *Store) GetArtifact(ctx context.Context, id string) (store.Workspace, error) {
	w, e := readJSON[store.Workspace](ctx, s.db, `SELECT data FROM workspace_snapshots WHERE session_id=? ORDER BY revision DESC LIMIT 1`, id)
	if errors.Is(e, store.ErrNotFound) {
		e = nil
	}
	return w, e
}
func (s *Store) LatestWorkspace(ctx context.Context, id string) (string, error) {
	w, e := s.GetArtifact(ctx, id)
	return w.Content, e
}
func (s *Store) AddCanvasSnapshot(ctx context.Context, id string, ts int64, elements json.RawMessage, ref string) error {
	if len(elements) == 0 {
		elements = json.RawMessage(`[]`)
	}
	_, e := s.db.ExecContext(ctx, `INSERT INTO canvas_snapshots(session_id,ts_ms,elements,image_ref) VALUES(?,?,?,?)`, id, ts, string(elements), ref)
	return e
}
func (s *Store) LatestCanvasElements(ctx context.Context, id string) (json.RawMessage, error) {
	v, e := readJSON[json.RawMessage](ctx, s.db, `SELECT elements FROM canvas_snapshots WHERE session_id=? ORDER BY sequence DESC LIMIT 1`, id)
	if errors.Is(e, store.ErrNotFound) {
		e = nil
	}
	return v, e
}
func (s *Store) SaveScores(ctx context.Context, id string, rows []store.ScoreRow) error {
	return saveScores(ctx, s.db, id, rows)
}
func saveScores(ctx context.Context, q executor, id string, rows []store.ScoreRow) error {
	if rows == nil {
		rows = []store.ScoreRow{}
	}
	return execJSON(ctx, q, `INSERT INTO scores(session_id,data) VALUES(?,?) ON CONFLICT(session_id) DO UPDATE SET data=excluded.data`, rows, id)
}
func (s *Store) SaveReport(ctx context.Context, id string, overall float64, radar, timeline, behavioral json.RawMessage, coaching string, scored bool, note string) error {
	return saveReport(ctx, s.db, id, store.Report{Overall: overall, Radar: radar, Timeline: timeline, Behavioral: behavioral, CoachingMD: coaching, Scored: scored, Note: note})
}
func saveReport(ctx context.Context, q executor, id string, r store.Report) error {
	return execJSON(ctx, q, `INSERT INTO reports(session_id,data) VALUES(?,?) ON CONFLICT(session_id) DO UPDATE SET data=excluded.data`, r, id)
}
func (s *Store) GetReport(ctx context.Context, id string) (report store.Report, scores []store.ScoreRow, err error) {
	err = s.write(ctx, func(tx *sql.Tx) error {
		var e error
		report, e = readJSON[store.Report](ctx, tx, `SELECT data FROM reports WHERE session_id=?`, id)
		if e != nil {
			return e
		}
		scores, e = readJSON[[]store.ScoreRow](ctx, tx, `SELECT data FROM scores WHERE session_id=?`, id)
		if errors.Is(e, store.ErrNotFound) {
			return nil
		}
		return e
	})
	return
}
func oneOf(value string, values ...string) bool {
	for _, v := range values {
		if v == value {
			return true
		}
	}
	return false
}
