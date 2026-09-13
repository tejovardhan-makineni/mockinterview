package memstore

import (
	"context"
	"github.com/tejo/mockinterview-api/internal/store"
	"sort"
	"strings"
	"time"
)

func (m *Mem) isTester(uid string) bool {
	u, ok := m.users[uid]
	_, listed := m.testers[strings.ToLower(strings.TrimSpace(u.Email))]
	return ok && u.EmailVerified && listed
}

func (m *Mem) IsTester(_ context.Context, uid string) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.isTester(uid), nil
}

func (m *Mem) ListTesters(_ context.Context) ([]store.Tester, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	items := []store.Tester{}
	for _, item := range m.testers {
		items = append(items, item)
	}
	sort.Slice(items, func(i, j int) bool { return items[i].Email < items[j].Email })
	return items, nil
}

func (m *Mem) AddTester(_ context.Context, email string) (store.Tester, error) {
	email, err := store.NormalizeTesterEmail(email)
	if err != nil {
		return store.Tester{}, err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.testers == nil {
		m.testers = map[string]store.Tester{}
	}
	if existing, ok := m.testers[email]; ok {
		return existing, nil
	}
	item := store.Tester{Email: email, CreatedAt: time.Now().UTC()}
	m.testers[email] = item
	return item, nil
}

func (m *Mem) RemoveTester(_ context.Context, email string) error {
	email, err := store.NormalizeTesterEmail(email)
	if err != nil {
		return err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.testers, email)
	return nil
}
