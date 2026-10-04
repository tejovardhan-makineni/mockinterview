package memstore

import (
	"context"
	"github.com/tejo/mockinterview-api/internal/store"
	"sort"
	"strings"
	"time"
)

func (m *Mem) BetaApplication(_ context.Context, uid string) (store.BetaApplication, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	a, ok := m.betaApplications[uid]
	if !ok {
		return a, store.ErrNotFound
	}
	return a, nil
}
func (m *Mem) ApplyBeta(_ context.Context, uid, motivation string) (store.BetaApplication, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.betaApplications == nil {
		m.betaApplications = map[string]store.BetaApplication{}
	}
	a, ok := m.betaApplications[uid]
	if !ok {
		a = store.BetaApplication{ID: store.NewID(), UserID: uid, Email: m.users[uid].Email, CreatedAt: time.Now()}
	}
	if !ok || a.Status == "rejected" {
		a.Motivation = motivation
		a.FeedbackCommitment = true
		a.Status = "pending"
		a.ReviewedAt = nil
		m.betaApplications[uid] = a
	}
	return a, nil
}
func (m *Mem) ListBetaApplications(_ context.Context) ([]store.BetaApplication, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := []store.BetaApplication{}
	for _, a := range m.betaApplications {
		out = append(out, a)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.After(out[j].CreatedAt) })
	if len(out) > 200 {
		out = out[:200]
	}
	return out, nil
}
func (m *Mem) ReviewBetaApplication(_ context.Context, id, status, _ string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	for uid, a := range m.betaApplications {
		if a.ID == id {
			u := m.users[uid]
			if !u.EmailVerified || !a.FeedbackCommitment {
				return store.ErrNotFound
			}
			email := strings.ToLower(strings.TrimSpace(u.Email))
			if m.testers == nil {
				m.testers = map[string]store.Tester{}
			}
			if status == "approved" {
				m.testers[email] = store.Tester{Email: email, CreatedAt: time.Now()}
			} else {
				delete(m.testers, email)
			}
			a.Status = status
			now := time.Now()
			a.ReviewedAt = &now
			m.betaApplications[uid] = a
			return nil
		}
	}
	return store.ErrNotFound
}
func (m *Mem) SaveTemplateRequest(_ context.Context, a store.TemplateRequest) (store.TemplateRequest, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.templateRequests == nil {
		m.templateRequests = map[string]store.TemplateRequest{}
	}
	a.ID = store.NewID()
	a.Status = "new"
	a.Email = m.users[a.UserID].Email
	a.CreatedAt = time.Now()
	m.templateRequests[a.ID] = a
	return a, nil
}
func (m *Mem) ListTemplateRequests(_ context.Context) ([]store.TemplateRequest, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := []store.TemplateRequest{}
	for _, a := range m.templateRequests {
		out = append(out, a)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.After(out[j].CreatedAt) })
	if len(out) > 200 {
		out = out[:200]
	}
	return out, nil
}
func (m *Mem) ReviewTemplateRequest(_ context.Context, id, status, _ string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	a, ok := m.templateRequests[id]
	if !ok {
		return store.ErrNotFound
	}
	a.Status = status
	m.templateRequests[id] = a
	return nil
}
func (m *Mem) SaveSharedInterviewResult(_ context.Context, a store.SharedInterviewResult) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.sharedResults == nil {
		m.sharedResults = map[string]store.SharedInterviewResult{}
	}
	key := a.UserID + ":" + a.Source + ":" + a.ClientSessionID
	existing, ok := m.sharedResults[key]
	if ok {
		a.ID = existing.ID
		a.CreatedAt = existing.CreatedAt
	} else {
		a.ID = store.NewID()
		a.CreatedAt = time.Now()
	}
	a.Payload = append([]byte(nil), a.Payload...)
	m.sharedResults[key] = a
	return a.ID, nil
}
func (m *Mem) ListSharedInterviewResults(_ context.Context) ([]store.SharedInterviewResult, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := []store.SharedInterviewResult{}
	for _, a := range m.sharedResults {
		a.Payload = append([]byte(nil), a.Payload...)
		out = append(out, a)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.After(out[j].CreatedAt) })
	if len(out) > 200 {
		out = out[:200]
	}
	return out, nil
}
func (m *Mem) DeleteSharedInterviewResults(_ context.Context, uid string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	for key, a := range m.sharedResults {
		if a.UserID == uid {
			delete(m.sharedResults, key)
		}
	}
	return nil
}
