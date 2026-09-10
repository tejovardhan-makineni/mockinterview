package memstore

import (
	"context"
	"time"

	"github.com/tejo/mockinterview-api/internal/store"
)

func (m *Mem) CreateUserWithPolicies(_ context.Context, email, passwordHash, terms, privacy string) (store.User, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	now := time.Now().UTC()
	u := store.User{ID: store.NewID(), Email: email, PasswordHash: passwordHash, Role: "user", AdultConfirmedAt: &now, TermsVersion: terms, PrivacyVersion: privacy, PoliciesAcceptedAt: &now}
	m.users[u.ID] = u
	m.byEmail[email] = u.ID
	return u, nil
}

func (m *Mem) AcceptPolicies(_ context.Context, uid, terms, privacy string) (store.User, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	u, ok := m.users[uid]
	if !ok {
		return store.User{}, store.ErrNotFound
	}
	now := time.Now().UTC()
	if u.AdultConfirmedAt == nil || u.PoliciesAcceptedAt == nil || u.TermsVersion != terms || u.PrivacyVersion != privacy {
		u.PoliciesAcceptedAt = &now
	}
	if u.AdultConfirmedAt == nil {
		u.AdultConfirmedAt = &now
	}
	u.TermsVersion, u.PrivacyVersion = terms, privacy
	m.users[uid] = u
	return u, nil
}
