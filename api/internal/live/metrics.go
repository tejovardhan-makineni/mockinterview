package live

import (
	"context"
	"encoding/json"
	"log/slog"
	"time"
)

// Each connection records a failure code once, even when the transcript drain
// observes the same outage repeatedly. Only server-authored codes are stored;
// error text, candidate content and provider responses never enter metrics.
func (r *Relay) socket(conn wsWriter, sessionID string) *wsConn {
	seen := map[string]bool{}
	attempt := r.attempt
	return &wsConn{conn: conn, onError: func(message serverMsg) {
		if message.Code == "" || seen[message.Code] {
			return
		}
		seen[message.Code] = true // callback is serialized by wsConn.mu
		data, _ := json.Marshal(map[string]any{"code": message.Code, "stage": "live", "provider": attempt.Provider, "model": attempt.Model, "mode": attempt.Mode, "retryable": message.Retryable})
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		if err := r.store.AddEvent(ctx, sessionID, 0, "interview_error", data); err != nil {
			slog.Warn("interview error metric could not be saved", "session", sessionID, "code", message.Code)
		}
	}}
}
