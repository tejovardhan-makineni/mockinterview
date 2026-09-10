package memstore

import "context"

// Standalone reviews are not persisted by this test store.
func (m *Mem) DeleteResumes(_ context.Context, userID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.resumes, userID)
	return nil
}
