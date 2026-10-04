package sqlitestore

import (
	"context"
	"database/sql"
	"encoding/json"
	"github.com/tejo/mockinterview-api/internal/store"
	"math"
	"time"
)

type behaviorDocument struct{ Gaze, HeadPose, Expression, Posture, Lighting, VAD, Framing json.RawMessage }

func (s *Store) AddBehaviorSample(ctx context.Context, id string, ts int64, gaze, head, expression, posture, lighting, vad, framing json.RawMessage) error {
	d := behaviorDocument{normalizeJSON(gaze), normalizeJSON(head), normalizeJSON(expression), normalizeJSON(posture), normalizeJSON(lighting), normalizeJSON(vad), normalizeJSON(framing)}
	return execJSON(ctx, s.db, `INSERT INTO behavior_samples(session_id,ts_ms,created_at,data) VALUES(?,?,?,?)`, d, id, ts, nowMillis())
}
func (s *Store) AddEvent(ctx context.Context, id string, ts int64, kind string, data json.RawMessage) error {
	return s.write(ctx, func(tx *sql.Tx) error {
		if oneOf(kind, "interview_error", "scoring_error") {
			d, e := readSession(ctx, tx, id)
			if e != nil {
				return e
			}
			d.RuntimeErrors++
			if e = saveSession(ctx, tx, d); e != nil {
				return e
			}
		}
		_, e := tx.ExecContext(ctx, `INSERT INTO events(session_id,ts_ms,kind,data,created_at) VALUES(?,?,?,?,?)`, id, ts, kind, string(normalizeJSON(data)), nowMillis())
		return e
	})
}
func (s *Store) SessionMetrics(ctx context.Context, id string) (metrics store.SessionMetrics, err error) {
	err = s.write(ctx, func(tx *sql.Tx) error {
		d, e := readSession(ctx, tx, id)
		if e != nil {
			return e
		}
		metrics.ErrorCount = d.RuntimeErrors
		if e = tx.QueryRowContext(ctx, `SELECT count(*) FROM transcript_turns WHERE session_id=?`, id).Scan(&metrics.TurnCount); e != nil {
			return e
		}
		if d.Session.StartedAt != nil {
			end := time.Now()
			if d.EndedAt != nil {
				end = *d.EndedAt
			}
			if d.Session.DeadlineAt != nil && d.Session.DeadlineAt.Before(end) {
				end = *d.Session.DeadlineAt
			}
			metrics.DurationSeconds = max(0, int(end.Sub(*d.Session.StartedAt).Seconds()))
		}
		return nil
	})
	return
}
func (s *Store) BehavioralSummary(ctx context.Context, id string) (result json.RawMessage, err error) {
	err = s.write(ctx, func(tx *sql.Tx) error {
		var fillers, pauses, help int
		if e := tx.QueryRowContext(ctx, `SELECT coalesce(sum(kind='filler'),0),coalesce(sum(kind='long_pause'),0),coalesce(sum(kind='help_request'),0) FROM events WHERE session_id=?`, id).Scan(&fillers, &pauses, &help); e != nil {
			return e
		}
		rows, e := tx.QueryContext(ctx, `SELECT ts_ms,data FROM behavior_samples WHERE session_id=?`, id)
		if e != nil {
			return e
		}
		type average struct {
			total float64
			n     int
		}
		var eye, light, posture, framing, speaking average
		var duration int64
		count := 0
		add := func(a *average, raw json.RawMessage, key string) {
			var fields map[string]any
			if json.Unmarshal(raw, &fields) == nil {
				if n, ok := fields[key].(float64); ok && !math.IsInf(n, 0) && !math.IsNaN(n) {
					a.total += n
					a.n++
				}
			}
		}
		for rows.Next() {
			var ts int64
			var b []byte
			var d behaviorDocument
			if e = rows.Scan(&ts, &b); e != nil {
				rows.Close()
				return e
			}
			if e = json.Unmarshal(b, &d); e != nil {
				rows.Close()
				return e
			}
			duration = max(duration, ts)
			count++
			add(&eye, d.Gaze, "on_screen")
			add(&light, d.Lighting, "score")
			add(&posture, d.Posture, "score")
			add(&framing, d.Framing, "score")
			add(&speaking, d.VAD, "speaking")
		}
		e = rows.Err()
		rows.Close()
		if e != nil {
			return e
		}
		if count == 0 && fillers == 0 && pauses == 0 && help == 0 {
			result = json.RawMessage(`{}`)
			return nil
		}
		avg := func(a average) float64 {
			if a.n == 0 {
				return 0
			}
			return math.Round(a.total/float64(a.n)*10) / 10
		}
		eyePct := 0
		if eye.n > 0 {
			eyePct = int(eye.total / float64(eye.n) * 100)
		}
		fillerRate := 0.0
		minutes := float64(duration) / 60000
		if minutes > .1 {
			fillerRate = math.Round(float64(fillers)/minutes*10) / 10
		}
		result, e = json.Marshal(map[string]any{"filler_per_min": fillerRate, "long_pauses": pauses, "help_requests": help, "eye_contact_pct": eyePct, "posture_score": avg(posture), "lighting_score": avg(light), "framing_score": avg(framing), "speaking_ratio": avg(speaking), "samples": count})
		return e
	})
	return
}
func (s *Store) PurgeBehaviorSamplesOlderThan(ctx context.Context, age time.Duration) (removed int64, err error) {
	err = s.write(ctx, func(tx *sql.Tx) error {
		cutoff := time.Now().Add(-age).UnixMilli()
		r, e := tx.ExecContext(ctx, `DELETE FROM behavior_samples WHERE created_at<?`, cutoff)
		if e != nil {
			return e
		}
		removed, e = r.RowsAffected()
		if e != nil {
			return e
		}
		_, e = tx.ExecContext(ctx, `DELETE FROM events WHERE created_at<?`, cutoff)
		return e
	})
	return
}
