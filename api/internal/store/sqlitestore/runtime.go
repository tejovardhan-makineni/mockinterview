package sqlitestore

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"time"

	"github.com/tejo/mockinterview-api/internal/store"
)

func readUsage(ctx context.Context, q querier, uid, identity string, unlimited bool) (store.Usage, error) {
	u := store.Usage{FundedAvailable: true, LocalUnlimited: unlimited}
	tester, e := isTester(ctx, q, uid)
	if e != nil {
		return u, e
	}
	u.TesterUnlimited = tester
	if !unlimited && !tester {
		var claimed bool
		if e = q.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM free_interview_claims WHERE identity=?)`, identity).Scan(&claimed); e != nil {
			return u, e
		}
		u.FreeInterviewUsed, u.FundedAvailable = claimed, !claimed
	}
	documents, e := readSessions(ctx, q, `ORDER BY created_at DESC,id DESC`)
	if e != nil {
		return u, e
	}
	now := time.Now()
	for _, d := range documents {
		a := d.Session
		if a.UserID != uid && a.UsageIdentity != identity {
			continue
		}
		reserved := a.CreatedAt.Add(10 * time.Minute)
		if a.ReservedUntil != nil {
			reserved = *a.ReservedUntil
		}
		deadline := a.CreatedAt.Add(70 * time.Minute)
		if a.DeadlineAt != nil {
			deadline = *a.DeadlineAt
		}
		if u.ActiveSessionID == "" && (oneOf(a.Status, "created", "preparing", "reserved") && reserved.After(now) || oneOf(a.Status, "active", "interrupted", "ending") && (a.StartedAt != nil || deadline.After(now))) {
			u.ActiveSessionID = a.ID
		}
		if a.UserID == uid && !tester && store.InterviewFeedbackEligible(a) {
			var exists bool
			if e = q.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM interview_feedback WHERE session_id=?)`, a.ID).Scan(&exists); e != nil {
				return u, e
			}
			if !exists {
				u.PendingFeedback = true
			}
		}
	}
	return u, nil
}
func (s *Store) Usage(ctx context.Context, uid, identity string, unlimited bool, limits ...int) (u store.Usage, err error) {
	err = s.write(ctx, func(tx *sql.Tx) error {
		var e error
		u, e = readUsage(ctx, tx, uid, identity, unlimited)
		if e != nil || unlimited || len(limits) == 0 || limits[0] <= 0 {
			return e
		}
		n, e := globalStarts(ctx, tx, u.ActiveSessionID)
		if e == nil {
			store.ApplyGlobalUsage(&u, limits[0], n, time.Now())
		}
		return e
	})
	return
}
func checkGlobal(ctx context.Context, q querier, limit int, exclude string) error {
	if limit <= 0 {
		return nil
	}
	count, e := globalStarts(ctx, q, exclude)
	if e != nil {
		return e
	}
	if count >= limit {
		return store.ErrGlobalQuota
	}
	return nil
}
func globalStarts(ctx context.Context, q querier, exclude string) (int, error) {
	var count int
	if e := q.QueryRowContext(ctx, `SELECT count(*) FROM interview_usage WHERE funding='platform' AND activated_at>=?`, store.UTCDayStart(time.Now()).UnixMilli()).Scan(&count); e != nil {
		return 0, e
	}
	docs, e := readSessions(ctx, q, `WHERE status IN ('reserved','preparing','created')`)
	if e != nil {
		return 0, e
	}
	for _, d := range docs {
		a := d.Session
		if a.ID != exclude && a.Funding == "platform" && a.ReservedUntil != nil && a.ReservedUntil.After(time.Now()) {
			count++
		}
	}
	return count, nil
}
func (s *Store) ReserveSession(ctx context.Context, r store.Reservation) (a store.Session, err error) {
	err = s.write(ctx, func(tx *sql.Tx) error {
		if _, e := readJSON[store.User](ctx, tx, `SELECT data FROM users WHERE id=?`, r.Session.UserID); e != nil {
			return e
		}
		usage, e := readUsage(ctx, tx, r.Session.UserID, r.Identity, r.Unlimited)
		if e != nil {
			return e
		}
		if usage.PendingFeedback {
			return store.ErrInterviewFeedbackRequired
		}
		if usage.ActiveSessionID != "" {
			return store.ErrSessionConflict
		}
		if r.Session.Funding == "platform" {
			if !r.Unlimited && !usage.TesterUnlimited && !usage.FundedAvailable {
				return store.ErrQuota
			}
			if e = checkGlobal(ctx, tx, r.GlobalDailyLimit, ""); e != nil {
				return e
			}
		}
		a = r.Session
		if a.ID == "" {
			a.ID = store.NewID()
		}
		var exists bool
		if e = tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM sessions WHERE id=?)`, a.ID).Scan(&exists); e != nil {
			return e
		}
		if exists {
			return store.ErrSessionConflict
		}
		a.CreatedAt = time.Now().UTC()
		until := a.CreatedAt.Add(10 * time.Minute)
		a.ReservedUntil = &until
		a.Status = "reserved"
		if r.Preparing {
			a.Status = "preparing"
		}
		a.Phase = "lobby"
		a.UsageIdentity = r.Identity
		a.Config = normalizeJSON(a.Config)
		a.QuestionSnapshot = normalizeJSON(a.QuestionSnapshot)
		if e = saveSession(ctx, tx, sessionDocument{Session: a, QuotaExempt: r.Unlimited, GlobalDailyLimit: r.GlobalDailyLimit}); e != nil {
			return e
		}
		if len(r.Credential) > 0 {
			return setCredential(ctx, tx, a.ID, r.Credential, r.CredentialExpires)
		}
		return nil
	})
	return
}
func (s *Store) CompletePreparation(ctx context.Context, id, qid string, snapshot, config json.RawMessage) error {
	return s.changeSession(ctx, id, func(d *sessionDocument) error {
		a := &d.Session
		if a.Status != "preparing" || a.ReservedUntil == nil || !a.ReservedUntil.After(time.Now()) {
			return store.ErrSessionConflict
		}
		a.Status = "reserved"
		a.QuestionID = qid
		a.QuestionSnapshot = snapshot
		a.Config = config
		return nil
	})
}
func (s *Store) FailPreparation(ctx context.Context, id string) error {
	return s.write(ctx, func(tx *sql.Tx) error {
		d, e := readSession(ctx, tx, id)
		if errors.Is(e, store.ErrNotFound) {
			return nil
		}
		if e != nil {
			return e
		}
		if d.Session.Status != "preparing" {
			return nil
		}
		d.Session.Status = "expired"
		now := time.Now().UTC()
		d.EndedAt = &now
		if e = saveSession(ctx, tx, d); e != nil {
			return e
		}
		_, e = tx.ExecContext(ctx, `DELETE FROM session_credentials WHERE session_id=?`, id)
		return e
	})
}
func (s *Store) AcquireLive(ctx context.Context, id, owner string) (a store.Session, err error) {
	err = s.changeSession(ctx, id, func(d *sessionDocument) error {
		now := time.Now()
		a = d.Session
		if owner == "" || d.LeaseUntil.After(now) || !oneOf(a.Status, "created", "reserved", "active", "interrupted") {
			return store.ErrSessionConflict
		}
		if oneOf(a.Status, "created", "reserved") {
			until := a.CreatedAt.Add(10 * time.Minute)
			if a.ReservedUntil != nil {
				until = *a.ReservedUntil
			}
			if !until.After(now) {
				return store.ErrSessionConflict
			}
		} else if a.DeadlineAt == nil || !a.DeadlineAt.After(now) {
			return store.ErrSessionConflict
		}
		d.LeaseOwner = owner
		d.LeaseUntil = now.Add(30 * time.Second)
		return nil
	})
	return
}
func (s *Store) ActivateLive(ctx context.Context, id, owner string) (a store.Session, err error) {
	err = s.write(ctx, func(tx *sql.Tx) error {
		d, e := readSession(ctx, tx, id)
		if e != nil {
			return e
		}
		a = d.Session
		now := time.Now().UTC()
		if owner == "" || d.LeaseOwner != owner || !d.LeaseUntil.After(now) || !oneOf(a.Status, "created", "reserved", "active", "interrupted") {
			return store.ErrSessionConflict
		}
		if a.StartedAt == nil {
			usage, e := readUsage(ctx, tx, a.UserID, a.UsageIdentity, d.QuotaExempt)
			if e != nil {
				return e
			}
			if usage.PendingFeedback {
				return store.ErrInterviewFeedbackRequired
			}
			if a.Funding == "platform" {
				if !d.QuotaExempt && !usage.TesterUnlimited && !usage.FundedAvailable {
					return store.ErrQuota
				}
				if e = checkGlobal(ctx, tx, d.GlobalDailyLimit, id); e != nil {
					return e
				}
			}
			if a.ReservedUntil != nil && !a.ReservedUntil.After(now) {
				return store.ErrSessionConflict
			}
			until := now.Add(time.Duration(a.DurationMinutes) * time.Minute)
			a.StartedAt = &now
			a.DeadlineAt = &until
			if a.Funding == "platform" && !d.QuotaExempt {
				if _, e = tx.ExecContext(ctx, `INSERT INTO free_interview_claims(identity,claimed_at) VALUES(?,?) ON CONFLICT DO NOTHING`, a.UsageIdentity, now.UnixMilli()); e != nil {
					return e
				}
			}
			if _, e = tx.ExecContext(ctx, `INSERT INTO interview_usage(session_id,identity,funding,activated_at,tester_exempt) VALUES(?,?,?,?,?) ON CONFLICT(session_id) DO NOTHING`, id, a.UsageIdentity, a.Funding, now.UnixMilli(), usage.TesterUnlimited); e != nil {
				return e
			}
		} else if a.DeadlineAt == nil || !a.DeadlineAt.After(now) {
			return store.ErrSessionConflict
		}
		a.Status = "active"
		d.Session = a
		return saveSession(ctx, tx, d)
	})
	return
}
func (s *Store) HeartbeatLive(ctx context.Context, id, owner string) error {
	return s.changeSession(ctx, id, func(d *sessionDocument) error {
		now := time.Now()
		a := d.Session
		if owner == "" || d.LeaseOwner != owner || !d.LeaseUntil.After(now) || !oneOf(a.Status, "created", "reserved", "active", "interrupted") || a.DeadlineAt != nil && !a.DeadlineAt.After(now) {
			return store.ErrSessionConflict
		}
		d.LeaseUntil = now.Add(30 * time.Second)
		return nil
	})
}
func (s *Store) ReleaseLive(ctx context.Context, id, owner string) error {
	return s.changeSession(ctx, id, func(d *sessionDocument) error {
		if d.LeaseOwner == owner {
			d.LeaseOwner = ""
			d.LeaseUntil = time.Time{}
			if d.Session.Status == "active" {
				d.Session.Status = "interrupted"
			} else if oneOf(d.Session.Status, "reserved", "created") {
				d.Session.Status = "expired"
			}
		}
		return nil
	})
}
func (s *Store) SaveArtifact(ctx context.Context, id string, w store.Workspace) (out store.Workspace, err error) {
	err = s.write(ctx, func(tx *sql.Tx) error {
		d, e := readSession(ctx, tx, id)
		if e != nil {
			return e
		}
		allowed := oneOf(d.Session.Status, "active", "interrupted", "reserved", "created")
		if d.Session.Status == "ending" {
			j, e := readJob(ctx, tx, id)
			if e != nil && !errors.Is(e, store.ErrNotFound) {
				return e
			}
			allowed = e == nil && j.Status == "pending" && j.NotBefore.After(time.Now()) && j.Job.Input == nil
		}
		if !allowed {
			return store.ErrSessionConflict
		}
		out, e = insertWorkspace(ctx, tx, id, 0, w)
		return e
	})
	return
}

type scoringDocument struct {
	Job        store.ScoringJob
	Status     string
	LeaseUntil time.Time
	NotBefore  time.Time
	CreatedAt  time.Time
	Error      string
}

func readJob(ctx context.Context, q querier, id string) (scoringDocument, error) {
	return readJSON[scoringDocument](ctx, q, `SELECT data FROM scoring_jobs WHERE session_id=?`, id)
}
func saveJob(ctx context.Context, q executor, j scoringDocument) error {
	return execJSON(ctx, q, `INSERT INTO scoring_jobs(session_id,status,created_at,data) VALUES(?,?,?,?) ON CONFLICT(session_id) DO UPDATE SET status=excluded.status,data=excluded.data`, j, j.Job.SessionID, j.Status, j.CreatedAt.UnixMilli())
}
func (s *Store) BeginFinish(ctx context.Context, id string) error { return s.beginFinish(ctx, id, 0) }
func (s *Store) BeginTimedFinish(ctx context.Context, id string) error {
	return s.beginFinish(ctx, id, 5*time.Second)
}
func (s *Store) beginFinish(ctx context.Context, id string, grace time.Duration) error {
	return s.write(ctx, func(tx *sql.Tx) error {
		d, e := readSession(ctx, tx, id)
		if e != nil {
			return e
		}
		if oneOf(d.Session.Status, "complete", "scoring", "ending") {
			return nil
		}
		if d.Session.Status == "preparing" {
			return store.ErrSessionConflict
		}
		now := time.Now().UTC()
		d.Session.Status = "ending"
		if d.EndedAt == nil {
			d.EndedAt = &now
		}
		if e = saveSession(ctx, tx, d); e != nil {
			return e
		}
		j, e := readJob(ctx, tx, id)
		if e != nil && !errors.Is(e, store.ErrNotFound) {
			return e
		}
		if errors.Is(e, store.ErrNotFound) {
			j = scoringDocument{Job: store.ScoringJob{SessionID: id}, CreatedAt: now}
		}
		if e != nil || j.Status == "failed" {
			j.Status = "pending"
			j.Error = ""
			j.LeaseUntil = time.Time{}
			j.NotBefore = now.Add(grace)
			return saveJob(ctx, tx, j)
		}
		return nil
	})
}
func (s *Store) ClaimScoring(ctx context.Context) (job store.ScoringJob, err error) {
	found := false
	err = s.write(ctx, func(tx *sql.Tx) error {
		now := time.Now().UTC()
		docs, e := readSessions(ctx, tx, `WHERE status IN ('active','interrupted') ORDER BY created_at,id`)
		if e != nil {
			return e
		}
		for _, d := range docs {
			a := d.Session
			if a.DeadlineAt == nil || a.DeadlineAt.After(now) || d.LeaseUntil.After(now) {
				continue
			}
			d.Session.Status = "ending"
			if d.EndedAt == nil {
				d.EndedAt = a.DeadlineAt
			}
			if e = saveSession(ctx, tx, d); e != nil {
				return e
			}
			_, e := readJob(ctx, tx, a.ID)
			if errors.Is(e, store.ErrNotFound) {
				e = saveJob(ctx, tx, scoringDocument{Job: store.ScoringJob{SessionID: a.ID}, Status: "pending", CreatedAt: now})
			}
			if e != nil {
				return e
			}
		}
		jobs, e := listJSON[scoringDocument](ctx, tx, `SELECT data FROM scoring_jobs WHERE status IN ('pending','running') ORDER BY created_at,session_id`)
		if e != nil {
			return e
		}
		for _, j := range jobs {
			if !(j.Status == "pending" && !j.NotBefore.After(now) || j.Status == "running" && !j.LeaseUntil.After(now)) {
				continue
			}
			d, e := readSession(ctx, tx, j.Job.SessionID)
			if e != nil {
				return e
			}
			if d.LeaseUntil.After(now) {
				continue
			}
			j.Status = "running"
			j.Job.Attempts++
			j.LeaseUntil = now.Add(3 * time.Minute)
			d.Session.Status = "scoring"
			if e = saveJob(ctx, tx, j); e != nil {
				return e
			}
			if e = saveSession(ctx, tx, d); e != nil {
				return e
			}
			job = j.Job
			found = true
			break
		}
		return nil
	})
	if err == nil && !found {
		err = store.ErrNotFound
	}
	return
}
func activeJob(ctx context.Context, q querier, id string, attempt int) (scoringDocument, error) {
	j, e := readJob(ctx, q, id)
	if e != nil {
		return j, e
	}
	if j.Job.Attempts != attempt || j.Status != "running" || !j.LeaseUntil.After(time.Now()) {
		return j, store.ErrSessionConflict
	}
	return j, nil
}
func (s *Store) SetScoringInput(ctx context.Context, id string, attempt int, input store.ScoringInput) error {
	return s.write(ctx, func(tx *sql.Tx) error {
		j, e := activeJob(ctx, tx, id, attempt)
		if e != nil {
			return e
		}
		if j.Job.Input == nil {
			j.Job.Input = &input
		}
		return saveJob(ctx, tx, j)
	})
}
func (s *Store) FailScoring(ctx context.Context, id string, attempt int, msg string) error {
	return s.write(ctx, func(tx *sql.Tx) error {
		j, e := activeJob(ctx, tx, id, attempt)
		if e != nil {
			return e
		}
		d, e := readSession(ctx, tx, id)
		if e != nil {
			return e
		}
		j.Status = "failed"
		j.Error = msg
		j.LeaseUntil = time.Time{}
		d.Session.Status = "feedback_failed"
		d.RuntimeErrors++
		if e = saveJob(ctx, tx, j); e != nil {
			return e
		}
		if e = saveSession(ctx, tx, d); e != nil {
			return e
		}
		_, e = tx.ExecContext(ctx, `INSERT INTO events(session_id,ts_ms,kind,data,created_at) VALUES(?,0,'scoring_error','{"stage":"scoring"}',?)`, id, nowMillis())
		return e
	})
}
func (s *Store) CompleteScoring(ctx context.Context, id string, attempt int, r store.Report, rows []store.ScoreRow) error {
	return s.write(ctx, func(tx *sql.Tx) error {
		j, e := activeJob(ctx, tx, id, attempt)
		if e != nil {
			return e
		}
		d, e := readSession(ctx, tx, id)
		if e != nil {
			return e
		}
		if e = saveScores(ctx, tx, id, rows); e != nil {
			return e
		}
		if e = saveReport(ctx, tx, id, r); e != nil {
			return e
		}
		j.Status = "complete"
		j.LeaseUntil = time.Time{}
		d.Session.Status = "complete"
		if d.EndedAt == nil {
			now := time.Now().UTC()
			d.EndedAt = &now
		}
		if e = saveSession(ctx, tx, d); e != nil {
			return e
		}
		if e = saveJob(ctx, tx, j); e != nil {
			return e
		}
		_, e = tx.ExecContext(ctx, `DELETE FROM session_credentials WHERE session_id=?`, id)
		return e
	})
}
func setCredential(ctx context.Context, q executor, id string, b []byte, until time.Time) error {
	_, e := q.ExecContext(ctx, `INSERT INTO session_credentials(session_id,ciphertext,expires_at) VALUES(?,?,?) ON CONFLICT(session_id) DO UPDATE SET ciphertext=excluded.ciphertext,expires_at=excluded.expires_at`, id, b, until.UnixMilli())
	return e
}
func (s *Store) SetSessionCredential(ctx context.Context, id string, b []byte, until time.Time) error {
	return setCredential(ctx, s.db, id, b, until)
}
func (s *Store) SessionCredential(ctx context.Context, id string) ([]byte, error) {
	var b []byte
	e := s.db.QueryRowContext(ctx, `SELECT ciphertext FROM session_credentials WHERE session_id=? AND expires_at>?`, id, nowMillis()).Scan(&b)
	if errors.Is(e, sql.ErrNoRows) {
		e = store.ErrCredentialExpired
	}
	return b, e
}
func (s *Store) DeleteSession(ctx context.Context, id string) error {
	return s.write(ctx, func(tx *sql.Tx) error {
		d, e := readSession(ctx, tx, id)
		if e != nil {
			return e
		}
		if d.LeaseUntil.After(time.Now()) || oneOf(d.Session.Status, "ending", "scoring") {
			return store.ErrSessionConflict
		}
		_, e = tx.ExecContext(ctx, `DELETE FROM sessions WHERE id=?`, id)
		return e
	})
}
