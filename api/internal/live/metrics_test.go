package live

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/tejo/mockinterview-api/internal/store"
	"github.com/tejo/mockinterview-api/internal/store/memstore"
)

type metricStore struct {
	*memstore.Mem
	data []json.RawMessage
}

func (m *metricStore) AddEvent(ctx context.Context, id string, ts int64, kind string, data json.RawMessage) error {
	m.data = append(m.data, append(json.RawMessage(nil), data...))
	return m.Mem.AddEvent(ctx, id, ts, kind, data)
}

func TestRuntimeErrorsAreCountedWithoutPrivateMessages(t *testing.T) {
	ctx := context.Background()
	m := &metricStore{Mem: memstore.New()}
	u, _ := m.CreateUser(ctx, "metrics@example.test", "hash")
	a, _ := m.ReserveSession(ctx, store.Reservation{Session: store.Session{UserID: u.ID, Funding: "platform", Provider: "gemini", Model: "gemini-2.5-flash", Mode: "text"}, Unlimited: true})
	r := &Relay{store: m, attempt: a}
	connection := r.socket(&fakeConn{}, a.ID)
	for i := 0; i < 3; i++ {
		_ = connection.writeServerMsg(serverMsg{Type: "error", Code: "provider_unavailable", Text: "private answer + provider secret", Retryable: true})
	}
	_ = r.socket(&fakeConn{}, a.ID).writeServerMsg(serverMsg{Type: "error", Code: "provider_unavailable", Text: "private answer + provider secret", Retryable: true})
	metrics, err := m.SessionMetrics(ctx, a.ID)
	if err != nil || metrics.ErrorCount != 2 || metrics.TurnCount != 0 {
		t.Fatalf("wrong failure episode counts: %+v %v", metrics, err)
	}
	for _, data := range m.data {
		if strings.Contains(string(data), "private") || strings.Contains(string(data), "secret") {
			t.Fatal("raw error escaped into metrics")
		}
	}
}
