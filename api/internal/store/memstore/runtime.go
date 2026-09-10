package memstore

import (
	"context"
	"github.com/tejo/mockinterview-api/internal/store"
	"time"
)

type usageRec struct {
	id, identity, funding string
	at                    time.Time
}

func (m *Mem) usage(uid, identity string, unlimited bool) store.Usage {
	u := store.Usage{FundedAvailable: true, LocalUnlimited: unlimited}
	now := time.Now()
	for _, v := range m.runtimeUsage {
		if unlimited || v.identity != identity {
			continue
		}
		d := v.at.Add(24 * time.Hour)
		w := v.at.Add(7 * 24 * time.Hour)
		if d.After(now) && (u.NextStartAt == nil || d.After(*u.NextStartAt)) {
			u.NextStartAt = &d
		}
		if v.funding == "platform" && w.After(now) && (u.NextFundedAt == nil || w.After(*u.NextFundedAt)) {
			u.NextFundedAt = &w
		}
	}
	u.FundedAvailable = unlimited || (u.NextStartAt == nil && u.NextFundedAt == nil)
	for _, v := range m.sessions {
		if v.sess.UserID != uid && v.sess.UsageIdentity != identity {
			continue
		}
		st := v.sess.Status
		if (st == "reserved" || st == "created") && v.sess.ReservedUntil != nil && v.sess.ReservedUntil.After(now) || (st == "active" || st == "interrupted" || st == "ending") && (v.sess.StartedAt != nil || v.sess.DeadlineAt != nil && v.sess.DeadlineAt.After(now)) {
			u.ActiveSessionID = v.sess.ID
		}
	}
	return u
}
func (m *Mem) Usage(_ context.Context, uid, identity string, unlimited bool) (store.Usage, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.usage(uid, identity, unlimited), nil
}
func (m *Mem) ReserveSession(_ context.Context, r store.Reservation) (store.Session, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if len(m.pendingSurvey(r.Session.UserID)) > 0 {
		return store.Session{}, store.ErrInterviewFeedbackRequired
	}
	u := m.usage(r.Session.UserID, r.Identity, r.Unlimited)
	if u.ActiveSessionID != "" {
		return store.Session{}, store.ErrSessionConflict
	}
	if !r.Unlimited && (u.NextStartAt != nil || (r.Session.Funding == "platform" && u.NextFundedAt != nil)) {
		return store.Session{}, store.ErrQuota
	}
	if r.Session.Funding == "platform" && r.GlobalDailyLimit > 0 {
		n := 0
		for _, v := range m.runtimeUsage {
			if v.funding == "platform" && v.at.After(time.Now().Add(-24*time.Hour)) {
				n++
			}
		}
		for _, v := range m.sessions {
			if v.sess.Funding == "platform" && v.sess.Status == "reserved" && v.sess.ReservedUntil.After(time.Now()) {
				n++
			}
		}
		if n >= r.GlobalDailyLimit {
			return store.Session{}, store.ErrQuota
		}
	}
	a := r.Session
	if a.ID == "" {
		a.ID = store.NewID()
	}
	a.Status = "reserved"
	a.Phase = "lobby"
	a.UsageIdentity = r.Identity
	now := time.Now().UTC()
	a.CreatedAt = now
	until := now.Add(10 * time.Minute)
	a.ReservedUntil = &until
	m.seq++
	m.sessions[a.ID] = &sessionRec{sess: a, created: now, seq: m.seq, credential: append([]byte(nil), r.Credential...), credentialExpires: r.CredentialExpires}
	return a, nil
}
func (m *Mem) AcquireLive(_ context.Context, id, owner string) (store.Session, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	v, ok := m.sessions[id]
	if !ok {
		return store.Session{}, store.ErrNotFound
	}
	now := time.Now()
	if v.lease.After(now) {
		return store.Session{}, store.ErrSessionConflict
	}
	st := v.sess.Status
	if st != "reserved" && st != "created" && st != "active" && st != "interrupted" {
		return store.Session{}, store.ErrSessionConflict
	}
	if v.sess.DeadlineAt != nil && v.sess.DeadlineAt.Before(now) || v.sess.ReservedUntil != nil && (st == "reserved" || st == "created") && v.sess.ReservedUntil.Before(now) {
		return store.Session{}, store.ErrSessionConflict
	}
	v.owner = owner
	v.lease = now.Add(30 * time.Second)
	return v.sess, nil
}
func (m *Mem) ActivateLive(_ context.Context, id, owner string) (store.Session, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	v, ok := m.sessions[id]
	if !ok || v.owner != owner || v.lease.Before(time.Now()) {
		return store.Session{}, store.ErrSessionConflict
	}
	if v.sess.Status != "reserved" && v.sess.Status != "created" && v.sess.Status != "active" && v.sess.Status != "interrupted" {
		return store.Session{}, store.ErrSessionConflict
	}
	if v.sess.StartedAt == nil {
		if len(m.pendingSurvey(v.sess.UserID)) > 0 {
			return store.Session{}, store.ErrInterviewFeedbackRequired
		}
		now := time.Now().UTC()
		until := now.Add(time.Duration(v.sess.DurationMinutes) * time.Minute)
		v.sess.StartedAt = &now
		v.sess.DeadlineAt = &until
		m.runtimeUsage = append(m.runtimeUsage, usageRec{id: id, identity: v.sess.UsageIdentity, funding: v.sess.Funding, at: now})
	}
	v.sess.Status = "active"
	return v.sess, nil
}
func (m *Mem) HeartbeatLive(_ context.Context, id, owner string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	v, ok := m.sessions[id]
	if !ok || v.owner != owner || v.lease.Before(time.Now()) || v.sess.Status == "ending" || v.sess.Status == "scoring" || v.sess.Status == "complete" || v.sess.DeadlineAt != nil && v.sess.DeadlineAt.Before(time.Now()) {
		return store.ErrSessionConflict
	}
	v.lease = time.Now().Add(30 * time.Second)
	return nil
}
func (m *Mem) ReleaseLive(_ context.Context, id, owner string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if v, ok := m.sessions[id]; ok && v.owner == owner {
		v.owner = ""
		v.lease = time.Time{}
		if v.sess.Status == "active" {
			v.sess.Status = "interrupted"
		} else if v.sess.Status == "reserved" || v.sess.Status == "created" {
			v.sess.Status = "expired"
		}
	}
	return nil
}
func (m *Mem) GetArtifact(_ context.Context, id string) (store.Workspace, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	v, ok := m.sessions[id]
	if !ok {
		return store.Workspace{}, store.ErrNotFound
	}
	return v.artifact, nil
}
func (m *Mem) SaveArtifact(_ context.Context, id string, w store.Workspace) (store.Workspace, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	v, ok := m.sessions[id]
	if !ok {
		return w, store.ErrNotFound
	}
	st := v.sess.Status
	if st != "reserved" && st != "created" && st != "active" && st != "interrupted" && !(st == "ending" && v.jobState == "pending" && v.jobNotBefore.After(time.Now()) && v.job.Input == nil) {
		return w, store.ErrSessionConflict
	}
	if w.Revision > 0 && w.Revision != v.artifact.Revision+1 {
		return w, store.ErrSessionConflict
	}
	w.Revision = v.artifact.Revision + 1
	v.artifact = w
	v.workspace = w.Content
	return w, nil
}
func (m *Mem) BeginFinish(ctx context.Context, id string) error { return m.beginFinish(id, 0) }
func (m *Mem) BeginTimedFinish(ctx context.Context, id string) error {
	return m.beginFinish(id, 5*time.Second)
}
func (m *Mem) beginFinish(id string, grace time.Duration) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	v, ok := m.sessions[id]
	if !ok {
		return store.ErrNotFound
	}
	if v.sess.Status == "complete" || v.sess.Status == "scoring" || v.sess.Status == "ending" {
		return nil
	}
	v.sess.Status = "ending"
	if v.job == nil {
		v.job = &store.ScoringJob{SessionID: id}
	}
	v.jobState = "pending"
	v.jobNotBefore = time.Now().Add(grace)
	return nil
}
func (m *Mem) ClaimScoring(_ context.Context) (store.ScoringJob, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, v := range m.sessions {
		if (v.sess.Status == "active" || v.sess.Status == "interrupted") && v.sess.DeadlineAt != nil && !v.sess.DeadlineAt.After(time.Now()) && !v.lease.After(time.Now()) {
			v.sess.Status = "ending"
			v.jobState = "pending"
			v.job = &store.ScoringJob{SessionID: v.sess.ID}
		}
	}
	for _, v := range m.sessions {
		if v.job != nil && (v.jobState == "pending" && !v.jobNotBefore.After(time.Now()) || v.jobState == "running" && v.jobLease.Before(time.Now())) && !v.lease.After(time.Now()) {
			v.jobState = "running"
			v.job.Attempts++
			v.jobLease = time.Now().Add(3 * time.Minute)
			v.sess.Status = "scoring"
			return *v.job, nil
		}
	}
	return store.ScoringJob{}, store.ErrNotFound
}
func (m *Mem) SetScoringInput(_ context.Context, id string, attempt int, in store.ScoringInput) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	current, found := m.sessions[id]
	if !found || current.job == nil || current.job.Attempts != attempt || current.jobState != "running" || current.jobLease.Before(time.Now()) {
		return store.ErrSessionConflict
	}

	if v, ok := m.sessions[id]; ok && v.job != nil && v.job.Input == nil {
		v.job.Input = &in
	}
	return nil
}
func (m *Mem) FailScoring(_ context.Context, id string, attempt int, msg string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	current, found := m.sessions[id]
	if !found || current.job == nil || current.job.Attempts != attempt || current.jobState != "running" || current.jobLease.Before(time.Now()) {
		return store.ErrSessionConflict
	}

	if v, ok := m.sessions[id]; ok {
		v.jobState = "failed"
		v.sess.Status = "feedback_failed"
	}
	return nil
}
func (m *Mem) CompleteScoring(_ context.Context, id string, attempt int, r store.Report, rows []store.ScoreRow) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	current, found := m.sessions[id]
	if !found || current.job == nil || current.job.Attempts != attempt || current.jobState != "running" || current.jobLease.Before(time.Now()) {
		return store.ErrSessionConflict
	}

	v, ok := m.sessions[id]
	if !ok {
		return store.ErrNotFound
	}
	m.reports[id] = &reportRec{report: r, scores: append([]store.ScoreRow(nil), rows...)}
	v.sess.Status = "complete"
	v.jobState = "complete"
	v.credential = nil
	return nil
}
func (m *Mem) SessionCredential(_ context.Context, id string) ([]byte, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	v, ok := m.sessions[id]
	if !ok || len(v.credential) == 0 || v.credentialExpires.Before(time.Now()) {
		return nil, store.ErrCredentialExpired
	}
	return append([]byte(nil), v.credential...), nil
}
func (m *Mem) SetSessionCredential(_ context.Context, id string, b []byte, until time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	v, ok := m.sessions[id]
	if !ok {
		return store.ErrNotFound
	}
	v.credential = append([]byte(nil), b...)
	v.credentialExpires = until
	return nil
}
func (m *Mem) DeleteSession(_ context.Context, id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	v, ok := m.sessions[id]
	if !ok {
		return store.ErrNotFound
	}
	if v.lease.After(time.Now()) || v.sess.Status == "ending" || v.sess.Status == "scoring" {
		return store.ErrSessionConflict
	}
	delete(m.sessions, id)
	delete(m.interviewFeedback, id)
	delete(m.reports, id)
	return nil
}

func (m *Mem) UpdateFeedbackStatus(_ context.Context, id, status string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	for i := range m.feedback {
		if m.feedback[i].ID == id {
			m.feedback[i].Status = status
			return nil
		}
	}
	return store.ErrNotFound
}
