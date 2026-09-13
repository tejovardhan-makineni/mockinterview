package store

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

var ErrDuplicateEvent = errors.New("event already persisted")
var ErrSessionConflict = errors.New("attempt is already open or no longer writable")
var ErrQuota = errors.New("interview allowance exhausted")
var ErrCredentialExpired = errors.New("personal key expired; enter it again")

type Workspace struct {
	Kind     string          `json:"kind"`
	Content  string          `json:"content"`
	Revision int64           `json:"revision"`
	Data     json.RawMessage `json:"data,omitempty"`
}
type Usage struct {
	PendingFeedback bool       `json:"-"`
	FundedAvailable bool       `json:"funded_available"`
	NextFundedAt    *time.Time `json:"next_funded_at,omitempty"`
	NextStartAt     *time.Time `json:"next_start_at,omitempty"`
	ActiveSessionID string     `json:"active_session_id,omitempty"`
	LocalUnlimited  bool       `json:"local_unlimited"`
	TesterUnlimited bool       `json:"tester_unlimited"`
}
type Reservation struct {
	Session           Session
	Identity          string
	Unlimited         bool
	Credential        []byte
	CredentialExpires time.Time
	GlobalDailyLimit  int
}
type ScoringInput struct {
	Question   json.RawMessage `json:"question"`
	Config     json.RawMessage `json:"config"`
	Turns      []Turn          `json:"turns"`
	Workspace  string          `json:"workspace"`
	Behavioral json.RawMessage `json:"behavioral"`
}
type ScoringJob struct {
	SessionID string
	Input     *ScoringInput
	Attempts  int
}

type SessionRuntime interface {
	ReserveSession(context.Context, Reservation) (Session, error)
	Usage(context.Context, string, string, bool) (Usage, error)
	AcquireLive(context.Context, string, string) (Session, error)
	ActivateLive(context.Context, string, string) (Session, error)
	HeartbeatLive(context.Context, string, string) error
	ReleaseLive(context.Context, string, string) error
	SaveArtifact(context.Context, string, Workspace) (Workspace, error)
	GetArtifact(context.Context, string) (Workspace, error)
	BeginFinish(context.Context, string) error
	BeginTimedFinish(context.Context, string) error
	ClaimScoring(context.Context) (ScoringJob, error)
	SetScoringInput(context.Context, string, int, ScoringInput) error
	FailScoring(context.Context, string, int, string) error
	CompleteScoring(context.Context, string, int, Report, []ScoreRow) error
	SessionCredential(context.Context, string) ([]byte, error)
	SetSessionCredential(context.Context, string, []byte, time.Time) error
	DeleteSession(context.Context, string) error
}

const sessionSelect = `SELECT id,user_id,question_id,modality,track,status,phase,config,pack_id,pack_round_id,duration_minutes,started_at,deadline_at,created_at,reserved_until,funding,provider,model,mode,question_snapshot,usage_identity,live_model,feedback_version FROM sessions`

func scanSession(row pgx.Row) (Session, error) {
	var s Session
	err := row.Scan(&s.ID, &s.UserID, &s.QuestionID, &s.Modality, &s.Track, &s.Status, &s.Phase, &s.Config, &s.PackID, &s.PackRoundID, &s.DurationMinutes, &s.StartedAt, &s.DeadlineAt, &s.CreatedAt, &s.ReservedUntil, &s.Funding, &s.Provider, &s.Model, &s.Mode, &s.QuestionSnapshot, &s.UsageIdentity, &s.LiveModel, &s.FeedbackVersion)
	if errors.Is(err, pgx.ErrNoRows) {
		err = ErrNotFound
	}
	return s, err
}

type queryer interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

func readUsage(ctx context.Context, q queryer, uid, identity string, unlimited bool) (Usage, error) {
	u := Usage{LocalUnlimited: unlimited, FundedAvailable: true}
	tester, err := readTester(ctx, q, uid)
	if err != nil {
		return u, err
	}
	u.TesterUnlimited = tester
	if !unlimited && !tester {
		var daily, weekly *time.Time
		e := q.QueryRow(ctx, `SELECT max(activated_at) FILTER (WHERE activated_at>now()-interval '24 hours')+interval '24 hours', max(activated_at) FILTER (WHERE funding='platform' AND activated_at>now()-interval '7 days')+interval '7 days' FROM interview_usage WHERE identity=$1`, identity).Scan(&daily, &weekly)
		if e != nil {
			return u, e
		}
		u.NextStartAt = daily
		u.NextFundedAt = weekly
		u.FundedAvailable = weekly == nil && daily == nil
	}
	// Active and pending states share one MVCC statement snapshot. A scoring
	// worker may transition ending -> scoring without the admission lock.
	err = q.QueryRow(ctx, `SELECT COALESCE((SELECT id::text FROM sessions WHERE (user_id=$1 OR usage_identity=$2) AND (status IN ('reserved','created') AND COALESCE(reserved_until,created_at+interval '10 minutes')>now() OR status IN ('active','interrupted','ending') AND (started_at IS NOT NULL OR COALESCE(deadline_at,created_at+interval '70 minutes')>now())) ORDER BY created_at DESC LIMIT 1),''),
 EXISTS(SELECT 1 FROM sessions WHERE user_id=$1 AND `+feedbackEligibleSQL+` AND NOT EXISTS(SELECT 1 FROM interview_feedback f WHERE f.session_id=sessions.id))`, uid, identity).Scan(&u.ActiveSessionID, &u.PendingFeedback)
	if err != nil {
		return u, err
	}
	if tester {
		u.PendingFeedback = false
	}
	return u, nil
}
func (s *Store) Usage(ctx context.Context, uid, identity string, unlimited bool) (Usage, error) {
	return readUsage(ctx, s.Pool, uid, identity, unlimited)
}
func (s *Store) ReserveSession(ctx context.Context, r Reservation) (Session, error) {
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return Session{}, e
	}
	defer tx.Rollback(ctx)
	var uid string
	if e = tx.QueryRow(ctx, `SELECT id FROM users WHERE id=$1 FOR UPDATE`, r.Session.UserID).Scan(&uid); e != nil {
		return Session{}, e
	}
	if _, e = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, r.Identity); e != nil {
		return Session{}, e
	}
	u, e := readUsage(ctx, tx, uid, r.Identity, r.Unlimited)
	if e != nil {
		return Session{}, e
	}
	if u.PendingFeedback {
		return Session{}, ErrInterviewFeedbackRequired
	}
	if u.ActiveSessionID != "" {
		return Session{}, ErrSessionConflict
	}
	if !r.Unlimited && !u.TesterUnlimited && (u.NextStartAt != nil || (r.Session.Funding == "platform" && u.NextFundedAt != nil)) {
		return Session{}, ErrQuota
	}
	if !u.TesterUnlimited && r.Session.Funding == "platform" && r.GlobalDailyLimit > 0 {
		if e = checkGlobal(ctx, tx, r.GlobalDailyLimit, ""); e != nil {
			return Session{}, e
		}
	}
	a := r.Session
	if a.ID == "" {
		a.ID = NewID()
	}
	if len(a.Config) == 0 {
		a.Config = json.RawMessage(`{}`)
	}
	if len(a.QuestionSnapshot) == 0 {
		a.QuestionSnapshot = json.RawMessage(`{}`)
	}
	_, e = tx.Exec(ctx, `INSERT INTO sessions(id,user_id,question_id,modality,track,status,phase,config,pack_id,pack_round_id,duration_minutes,reserved_until,funding,provider,model,mode,question_snapshot,usage_identity,quota_exempt,global_daily_limit,live_model,feedback_version) VALUES($1,$2,$3,$4,$5,'reserved','lobby',$6,$7,$8,$9,now()+interval '10 minutes',$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`, a.ID, uid, a.QuestionID, a.Modality, a.Track, a.Config, a.PackID, a.PackRoundID, a.DurationMinutes, a.Funding, a.Provider, a.Model, a.Mode, a.QuestionSnapshot, r.Identity, r.Unlimited, r.GlobalDailyLimit, a.LiveModel, a.FeedbackVersion)
	if e != nil {
		return Session{}, e
	}
	if len(r.Credential) > 0 {
		_, e = tx.Exec(ctx, `INSERT INTO session_credentials(session_id,ciphertext,expires_at) VALUES($1,$2,$3)`, a.ID, r.Credential, r.CredentialExpires)
		if e != nil {
			return Session{}, e
		}
	}
	if e = tx.Commit(ctx); e != nil {
		return Session{}, e
	}
	return s.GetSession(ctx, a.ID)
}
func (s *Store) AcquireLive(ctx context.Context, id, owner string) (Session, error) {
	tag, e := s.Pool.Exec(ctx, `UPDATE sessions SET lease_owner=$2,lease_until=now()+interval '30 seconds' WHERE id=$1 AND (lease_until IS NULL OR lease_until<now()) AND (status IN ('reserved','created') AND COALESCE(reserved_until,created_at+interval '10 minutes')>now() OR status IN ('active','interrupted') AND deadline_at>now())`, id, owner)
	if e != nil {
		return Session{}, e
	}
	if tag.RowsAffected() != 1 {
		return Session{}, ErrSessionConflict
	}
	return s.GetSession(ctx, id)
}
func (s *Store) ActivateLive(ctx context.Context, id, owner string) (Session, error) {
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return Session{}, e
	}
	defer tx.Rollback(ctx)
	a, e := scanSession(tx.QueryRow(ctx, sessionSelect+` WHERE id=$1 AND lease_owner=$2 AND lease_until>now() AND status IN ('created','reserved','active','interrupted') FOR UPDATE`, id, owner))
	if e != nil {
		return Session{}, ErrSessionConflict
	}
	if a.StartedAt == nil || a.Status == "created" || a.Status == "reserved" {
		if _, e = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, a.UsageIdentity); e != nil {
			return Session{}, e
		}
		var globalLimit int
		var exempt bool
		if e = tx.QueryRow(ctx, `SELECT quota_exempt,global_daily_limit FROM sessions WHERE id=$1`, id).Scan(&exempt, &globalLimit); e != nil {
			return Session{}, e
		}
		usage, e := readUsage(ctx, tx, a.UserID, a.UsageIdentity, exempt)
		if e != nil {
			return Session{}, e
		}
		if !usage.TesterUnlimited && a.Funding == "platform" && globalLimit > 0 {
			if e = checkGlobal(ctx, tx, globalLimit, id); e != nil {
				return Session{}, e
			}
		}
		if usage.PendingFeedback {
			return Session{}, ErrInterviewFeedbackRequired
		}
		if !exempt && !usage.TesterUnlimited && (usage.NextStartAt != nil || (a.Funding == "platform" && usage.NextFundedAt != nil)) {
			return Session{}, ErrQuota
		}

		_, e = tx.Exec(ctx, `INSERT INTO interview_usage(session_id,identity,funding,activated_at,tester_exempt) VALUES($1,$2,$3,now(),$4) ON CONFLICT DO NOTHING`, id, a.UsageIdentity, a.Funding, usage.TesterUnlimited)
		if e != nil {
			return Session{}, e
		}
		_, e = tx.Exec(ctx, `UPDATE sessions SET started_at=now(),deadline_at=now()+make_interval(mins=>duration_minutes),status='active' WHERE id=$1`, id)
	} else {
		_, e = tx.Exec(ctx, `UPDATE sessions SET status='active' WHERE id=$1`, id)
	}
	if e != nil {
		return Session{}, e
	}
	if e = tx.Commit(ctx); e != nil {
		return Session{}, e
	}
	return s.GetSession(ctx, id)
}
func (s *Store) HeartbeatLive(ctx context.Context, id, owner string) error {
	tag, e := s.Pool.Exec(ctx, `UPDATE sessions SET lease_until=now()+interval '30 seconds' WHERE id=$1 AND lease_owner=$2 AND lease_until>now() AND status IN ('created','reserved','active','interrupted') AND (deadline_at IS NULL OR deadline_at>now())`, id, owner)
	if e != nil {
		return e
	}
	if tag.RowsAffected() != 1 {
		return ErrSessionConflict
	}
	return nil
}
func (s *Store) ReleaseLive(ctx context.Context, id, owner string) error {
	_, e := s.Pool.Exec(ctx, `UPDATE sessions SET lease_owner=NULL,lease_until=NULL,status=CASE WHEN status='active' THEN 'interrupted' WHEN status IN ('reserved','created') THEN 'expired' ELSE status END WHERE id=$1 AND lease_owner=$2`, id, owner)
	return e
}
func (s *Store) GetArtifact(ctx context.Context, id string) (Workspace, error) {
	var w Workspace
	e := s.Pool.QueryRow(ctx, `SELECT kind,content,revision,data FROM workspace_snapshots WHERE session_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1`, id).Scan(&w.Kind, &w.Content, &w.Revision, &w.Data)
	if errors.Is(e, pgx.ErrNoRows) {
		return Workspace{}, nil
	}
	return w, e
}
func (s *Store) SaveArtifact(ctx context.Context, id string, w Workspace) (Workspace, error) {
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return w, e
	}
	defer tx.Rollback(ctx)
	var status string
	e = tx.QueryRow(ctx, `SELECT status FROM sessions WHERE id=$1 FOR UPDATE`, id).Scan(&status)
	if e != nil {
		return w, e
	}
	if status != "active" && status != "interrupted" && status != "reserved" && status != "created" {
		var finalFlush bool
		if status == "ending" {
			e = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM scoring_jobs WHERE session_id=$1 AND status='pending' AND input IS NULL AND not_before>now())`, id).Scan(&finalFlush)
			if e != nil {
				return w, e
			}
		}
		if !finalFlush {
			return w, ErrSessionConflict
		}
	}
	var last int64
	e = tx.QueryRow(ctx, `SELECT COALESCE(max(revision),0) FROM workspace_snapshots WHERE session_id=$1`, id).Scan(&last)
	if e != nil {
		return w, e
	}
	if w.Revision > 0 && w.Revision != last+1 {
		return w, ErrSessionConflict
	}
	w.Revision = last + 1
	if len(w.Data) == 0 {
		w.Data = json.RawMessage(`{}`)
	}
	_, e = tx.Exec(ctx, `INSERT INTO workspace_snapshots(id,session_id,ts_ms,kind,content,revision,data) VALUES($1,$2,0,$3,$4,$5,$6)`, NewID(), id, w.Kind, w.Content, w.Revision, w.Data)
	if e != nil {
		return w, e
	}
	return w, tx.Commit(ctx)
}
func (s *Store) BeginFinish(ctx context.Context, id string) error { return s.beginFinish(ctx, id, 0) }
func (s *Store) BeginTimedFinish(ctx context.Context, id string) error {
	return s.beginFinish(ctx, id, 5)
}
func (s *Store) beginFinish(ctx context.Context, id string, graceSeconds int) error {
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	var status string
	e = tx.QueryRow(ctx, `SELECT status FROM sessions WHERE id=$1 FOR UPDATE`, id).Scan(&status)
	if e != nil {
		return e
	}
	if status == "complete" || status == "scoring" || status == "ending" {
		return nil
	}
	_, e = tx.Exec(ctx, `UPDATE sessions SET status='ending',ended_at=now() WHERE id=$1`, id)
	if e != nil {
		return e
	}
	_, e = tx.Exec(ctx, `INSERT INTO scoring_jobs(session_id,not_before) VALUES($1,now()+make_interval(secs=>$2)) ON CONFLICT(session_id) DO UPDATE SET status='pending',error='',lease_until=NULL,not_before=EXCLUDED.not_before,updated_at=now() WHERE scoring_jobs.status='failed'`, id, graceSeconds)
	if e != nil {
		return e
	}
	return tx.Commit(ctx)
}
func (s *Store) ClaimScoring(ctx context.Context) (ScoringJob, error) {
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return ScoringJob{}, e
	}
	defer tx.Rollback(ctx)
	// A disconnected attempt still ends at its server deadline, including after
	// a process restart. Wait for the live writer lease to drain before freezing it.
	_, e = tx.Exec(ctx, `WITH due AS (SELECT id FROM sessions WHERE status IN ('active','interrupted') AND deadline_at<=now() AND (lease_until IS NULL OR lease_until<now()) FOR UPDATE SKIP LOCKED LIMIT 50), ended AS (UPDATE sessions SET status='ending',ended_at=COALESCE(ended_at,deadline_at) FROM due WHERE sessions.id=due.id RETURNING sessions.id) INSERT INTO scoring_jobs(session_id) SELECT id FROM ended ON CONFLICT DO NOTHING`)
	if e != nil {
		return ScoringJob{}, e
	}
	var j ScoringJob
	var raw []byte
	e = tx.QueryRow(ctx, `SELECT j.session_id,j.input,j.attempts FROM scoring_jobs j JOIN sessions s ON s.id=j.session_id WHERE (j.status='pending' AND j.not_before<=now() OR j.status='running' AND j.lease_until<now()) AND (s.lease_until IS NULL OR s.lease_until<now()) ORDER BY j.created_at FOR UPDATE OF j SKIP LOCKED LIMIT 1`).Scan(&j.SessionID, &raw, &j.Attempts)
	if errors.Is(e, pgx.ErrNoRows) {
		return j, ErrNotFound
	}
	if e != nil {
		return j, e
	}
	if len(raw) > 0 {
		j.Input = &ScoringInput{}
		if e = json.Unmarshal(raw, j.Input); e != nil {
			return j, e
		}
	}
	_, e = tx.Exec(ctx, `UPDATE scoring_jobs SET status='running',attempts=attempts+1,lease_until=now()+interval '3 minutes',updated_at=now() WHERE session_id=$1`, j.SessionID)
	if e != nil {
		return j, e
	}
	_, e = tx.Exec(ctx, `UPDATE sessions SET status='scoring' WHERE id=$1`, j.SessionID)
	if e != nil {
		return j, e
	}
	j.Attempts++
	return j, tx.Commit(ctx)
}
func (s *Store) SetScoringInput(ctx context.Context, id string, attempt int, in ScoringInput) error {
	b, e := json.Marshal(in)
	if e != nil {
		return e
	}
	tag, e := s.Pool.Exec(ctx, `UPDATE scoring_jobs SET input=COALESCE(input,$2) WHERE session_id=$1 AND attempts=$3 AND status='running' AND lease_until>now()`, id, b, attempt)
	if e == nil && tag.RowsAffected() != 1 {
		return ErrSessionConflict
	}
	return e
}
func (s *Store) FailScoring(ctx context.Context, id string, attempt int, msg string) error {
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	var current int
	if e = tx.QueryRow(ctx, `SELECT attempts FROM scoring_jobs WHERE session_id=$1 AND attempts=$2 AND status='running' AND lease_until>now() FOR UPDATE`, id, attempt).Scan(&current); e != nil {
		if errors.Is(e, pgx.ErrNoRows) {
			return ErrSessionConflict
		}
		return e
	}

	_, e = tx.Exec(ctx, `UPDATE scoring_jobs SET status='failed',error=$2,lease_until=NULL,updated_at=now() WHERE session_id=$1`, id, msg)
	if e != nil {
		return e
	}
	_, e = tx.Exec(ctx, `UPDATE sessions SET status='feedback_failed' WHERE id=$1`, id)
	if e != nil {
		return e
	}
	return tx.Commit(ctx)
}
func (s *Store) CompleteScoring(ctx context.Context, id string, attempt int, r Report, rows []ScoreRow) error {
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	var current int
	if e = tx.QueryRow(ctx, `SELECT attempts FROM scoring_jobs WHERE session_id=$1 AND attempts=$2 AND status='running' AND lease_until>now() FOR UPDATE`, id, attempt).Scan(&current); e != nil {
		if errors.Is(e, pgx.ErrNoRows) {
			return ErrSessionConflict
		}
		return e
	}

	_, e = tx.Exec(ctx, `DELETE FROM scores WHERE session_id=$1`, id)
	if e != nil {
		return e
	}
	for _, v := range rows {
		_, e = tx.Exec(ctx, `INSERT INTO scores(id,session_id,dimension,phase,score,weight,evidence,expected,actual,coverage_pct,assessed) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, NewID(), id, v.Dimension, v.Phase, v.Score, v.Weight, v.Evidence, v.Expected, v.Actual, v.CoveragePct, v.Assessed)
		if e != nil {
			return e
		}
	}
	_, e = tx.Exec(ctx, `INSERT INTO reports(id,session_id,overall,radar,timeline,behavioral,coaching_md,scored,note) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(session_id) DO UPDATE SET overall=EXCLUDED.overall,radar=EXCLUDED.radar,timeline=EXCLUDED.timeline,behavioral=EXCLUDED.behavioral,coaching_md=EXCLUDED.coaching_md,scored=EXCLUDED.scored,note=EXCLUDED.note`, NewID(), id, r.Overall, r.Radar, r.Timeline, r.Behavioral, r.CoachingMD, r.Scored, r.Note)
	if e != nil {
		return e
	}
	for _, q := range []string{`UPDATE sessions SET status='complete',ended_at=COALESCE(ended_at,now()) WHERE id=$1`, `UPDATE scoring_jobs SET status='complete',lease_until=NULL,updated_at=now() WHERE session_id=$1`, `DELETE FROM session_credentials WHERE session_id=$1`} {
		if _, e = tx.Exec(ctx, q, id); e != nil {
			return e
		}
	}
	return tx.Commit(ctx)
}
func (s *Store) SessionCredential(ctx context.Context, id string) ([]byte, error) {
	var b []byte
	e := s.Pool.QueryRow(ctx, `SELECT ciphertext FROM session_credentials WHERE session_id=$1 AND expires_at>now()`, id).Scan(&b)
	if errors.Is(e, pgx.ErrNoRows) {
		e = ErrCredentialExpired
	}
	return b, e
}
func (s *Store) SetSessionCredential(ctx context.Context, id string, b []byte, until time.Time) error {
	_, e := s.Pool.Exec(ctx, `INSERT INTO session_credentials(session_id,ciphertext,expires_at) VALUES($1,$2,$3) ON CONFLICT(session_id) DO UPDATE SET ciphertext=EXCLUDED.ciphertext,expires_at=EXCLUDED.expires_at`, id, b, until)
	return e
}
func (s *Store) DeleteSession(ctx context.Context, id string) error {
	tag, e := s.Pool.Exec(ctx, `DELETE FROM sessions WHERE id=$1 AND (lease_until IS NULL OR lease_until<now()) AND status NOT IN ('ending','scoring')`, id)
	if e != nil {
		return e
	}
	if tag.RowsAffected() != 1 {
		return ErrSessionConflict
	}
	return nil
}

func checkGlobal(ctx context.Context, tx pgx.Tx, limit int, exclude string) error {
	if _, e := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(1296648001)`); e != nil {
		return e
	}
	var n int
	e := tx.QueryRow(ctx, `SELECT (SELECT count(*) FROM interview_usage WHERE funding='platform' AND NOT tester_exempt AND activated_at>now()-interval '24 hours')+(SELECT count(*) FROM sessions s WHERE funding='platform' AND status='reserved' AND reserved_until>now() AND id::text<>$1 AND NOT EXISTS(SELECT 1 FROM users u JOIN tester_emails t ON t.email=lower(btrim(u.email)) WHERE u.id=s.user_id AND u.email_verified=true))`, exclude).Scan(&n)
	if e != nil {
		return e
	}
	if n >= limit {
		return ErrQuota
	}
	return nil
}
