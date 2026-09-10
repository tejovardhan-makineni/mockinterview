package memstore

import (
	"context"
	"github.com/tejo/mockinterview-api/internal/store"
	"time"
)

type authAction struct {
	userID, purpose  string
	expires, created time.Time
}

func (m *Mem) SaveAuthAction(_ context.Context, uid, purpose, hash string, expires time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.users[uid]; !ok {
		return store.ErrNotFound
	}
	if m.authActions == nil {
		m.authActions = map[string]authAction{}
	}
	for key, a := range m.authActions {
		if a.userID == uid && a.purpose == purpose {
			if time.Since(a.created) < time.Minute {
				return store.ErrActionThrottled
			}
			delete(m.authActions, key)
		}
	}
	m.authActions[hash] = authAction{uid, purpose, expires, time.Now()}
	return nil
}
func (m *Mem) ConsumeAuthAction(_ context.Context, hash, purpose, passwordHash string) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	a, ok := m.authActions[hash]
	if !ok || a.purpose != purpose || !a.expires.After(time.Now()) {
		return "", store.ErrNotFound
	}
	u, ok := m.users[a.userID]
	if !ok {
		return "", store.ErrNotFound
	}
	if purpose == "reset" {
		if passwordHash == "" {
			return "", store.ErrNotFound
		}
		u.PasswordHash = passwordHash
		u.TokenVersion++
	}
	u.EmailVerified = true
	m.users[u.ID] = u
	delete(m.authActions, hash)
	if purpose == "reset" {
		for key, x := range m.authActions {
			if x.userID == u.ID {
				delete(m.authActions, key)
			}
		}
	}
	return u.ID, nil
}
func (m *Mem) ChangePassword(_ context.Context, uid, previous, next string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	u, ok := m.users[uid]
	if !ok || u.PasswordHash != previous {
		return store.ErrNotFound
	}
	u.PasswordHash = next
	u.TokenVersion++
	m.users[uid] = u
	for key, action := range m.authActions {
		if action.userID == uid {
			delete(m.authActions, key)
		}
	}
	return nil
}
func (m *Mem) RevokeSessions(_ context.Context, uid string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	u, ok := m.users[uid]
	if !ok {
		return store.ErrNotFound
	}
	u.TokenVersion++
	m.users[uid] = u
	return nil
}
