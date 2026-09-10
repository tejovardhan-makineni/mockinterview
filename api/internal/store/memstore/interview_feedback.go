package memstore

import (
	"context"
	"encoding/json"
	"reflect"
	"sort"
	"time"

	"github.com/tejo/mockinterview-api/internal/store"
)

func cloneSurvey(f store.InterviewFeedback) store.InterviewFeedback {
	answers := map[string]string{}
	for k, v := range f.Answers {
		answers[k] = v
	}
	f.Answers = answers
	if f.Comparison != nil {
		comparison := *f.Comparison
		f.Comparison = &comparison
	}
	f.ComparisonSet = false
	return f
}
func (m *Mem) pendingSurvey(uid string) []store.Session {
	out := []store.Session{}
	for _, v := range m.sessions {
		if v.sess.UserID == uid && store.InterviewFeedbackEligible(v.sess) {
			if _, ok := m.interviewFeedback[v.sess.ID]; !ok {
				out = append(out, v.sess)
			}
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.Before(out[j].CreatedAt) })
	return out
}
func (m *Mem) PendingInterviewFeedback(_ context.Context, uid string) ([]store.Session, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.pendingSurvey(uid), nil
}
func (m *Mem) GetInterviewFeedback(_ context.Context, uid, id string) (*store.InterviewFeedback, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	v, ok := m.sessions[id]
	if !ok || v.sess.UserID != uid {
		return nil, store.ErrNotFound
	}
	f, ok := m.interviewFeedback[id]
	if !ok {
		return nil, nil
	}
	f = cloneSurvey(f)
	return &f, nil
}
func (m *Mem) PutInterviewFeedback(_ context.Context, f store.InterviewFeedback) (store.InterviewFeedback, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if !f.ComparisonSet {
		f.Comparison = nil
		if old, ok := m.interviewFeedback[f.SessionID]; ok {
			f.Comparison = old.Comparison
		}
	}
	if e := store.ValidateInterviewFeedback(f); e != nil {
		return store.InterviewFeedback{}, e
	}
	v, ok := m.sessions[f.SessionID]
	if !ok || v.sess.UserID != f.UserID {
		return store.InterviewFeedback{}, store.ErrNotFound
	}
	if !store.InterviewFeedbackEligible(v.sess) || v.sess.FeedbackVersion != f.Version {
		return store.InterviewFeedback{}, store.ErrInterviewFeedbackInvalid
	}
	now := time.Now().UTC()
	if old, ok := m.interviewFeedback[f.SessionID]; ok {
		f.SubmittedAt = old.SubmittedAt
		f.UpdatedAt = old.UpdatedAt
		if !reflect.DeepEqual(f.Answers, old.Answers) || f.Comment != old.Comment || f.ShareTranscript != old.ShareTranscript || !reflect.DeepEqual(f.Comparison, old.Comparison) {
			f.UpdatedAt = now
		}
	} else {
		f.SubmittedAt = now
		f.UpdatedAt = now
	}
	if m.interviewFeedback == nil {
		m.interviewFeedback = map[string]store.InterviewFeedback{}
	}
	m.interviewFeedback[f.SessionID] = cloneSurvey(f)
	return cloneSurvey(f), nil
}
func (m *Mem) InterviewFeedbackWindow(_ context.Context, from, to time.Time) ([]store.InterviewFeedbackRow, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := []store.InterviewFeedbackRow{}
	for _, v := range m.sessions {
		if !store.InterviewFeedbackEligible(v.sess) || v.sess.StartedAt.Before(from) || !v.sess.StartedAt.Before(to) {
			continue
		}
		r := store.InterviewFeedbackRow{Session: v.sess}
		if f, ok := m.interviewFeedback[v.sess.ID]; ok {
			f = cloneSurvey(f)
			if f.Comparison != nil {
				f.Comparison.ToolNames = ""
				f.Comparison.Details = ""
			}
			r.Response = &f
		}
		out = append(out, r)
	}
	return out, nil
}

// Mirrors the account export's privacy boundary for deterministic handler tests.
func (m *Mem) ExportAccount(_ context.Context, uid string) (json.RawMessage, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	u, ok := m.users[uid]
	if !ok {
		return nil, store.ErrNotFound
	}
	sessions := []store.Session{}
	responses := []store.InterviewFeedback{}
	for _, v := range m.sessions {
		if v.sess.UserID == uid {
			sessions = append(sessions, v.sess)
		}
	}
	for _, f := range m.interviewFeedback {
		if f.UserID == uid {
			responses = append(responses, cloneSurvey(f))
		}
	}
	return json.Marshal(map[string]any{"export_version": 1, "account": map[string]any{"id": u.ID, "email": u.Email, "role": u.Role, "email_verified": u.EmailVerified, "adult_confirmed_at": u.AdultConfirmedAt, "terms_version": u.TermsVersion, "privacy_version": u.PrivacyVersion, "policies_accepted_at": u.PoliciesAcceptedAt}, "sessions": sessions, "interview_feedback": responses})
}

func (m *Mem) InterviewFeedbackComments(_ context.Context, limit int, before *store.FeedbackCursor) ([]store.InterviewFeedbackRow, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if limit < 1 || limit > 100 {
		return nil, false, store.ErrInterviewFeedbackInvalid
	}
	out := []store.InterviewFeedbackRow{}
	for id, f := range m.interviewFeedback {
		if f.Comment == "" && f.Comparison == nil {
			continue
		}
		if before != nil && (f.UpdatedAt.After(before.UpdatedAt) || f.UpdatedAt.Equal(before.UpdatedAt) && id >= before.SessionID) {
			continue
		}
		a, ok := m.sessions[id]
		if !ok {
			continue
		}
		f = cloneSurvey(f)
		out = append(out, store.InterviewFeedbackRow{Session: a.sess, Response: &f})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Response.UpdatedAt.Equal(out[j].Response.UpdatedAt) {
			return out[i].Session.ID > out[j].Session.ID
		}
		return out[i].Response.UpdatedAt.After(out[j].Response.UpdatedAt)
	})
	more := len(out) > limit
	if more {
		out = out[:limit]
	}
	return out, more, nil
}
