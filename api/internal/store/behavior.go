package store

import (
	"context"
	"encoding/json"
)

// Behavioral telemetry is captured client-side (MediaPipe + VAD) and POSTed as
// samples/events. The client sends normalized numeric fields on each sample:
//   gaze.on_screen (0..1), lighting.score (0..4), posture.score (0..4),
//   framing.score (0..4), vad.speaking (0/1)
// and discrete events with kind in {filler, long_pause, help_request, interruption}.

func (s *Store) AddBehaviorSample(ctx context.Context, sessionID string, tsMs int64, gaze, headPose, expression, posture, lighting, vad, framing json.RawMessage) error {
	def := func(r json.RawMessage) json.RawMessage {
		if len(r) == 0 {
			return json.RawMessage(`{}`)
		}
		return r
	}
	_, err := s.Pool.Exec(ctx,
		`INSERT INTO behavior_samples (id, session_id, ts_ms, gaze, head_pose, expression, posture, lighting, vad, framing)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
		NewID(), sessionID, tsMs, def(gaze), def(headPose), def(expression), def(posture), def(lighting), def(vad), def(framing))
	return err
}

func (s *Store) AddEvent(ctx context.Context, sessionID string, tsMs int64, kind string, data json.RawMessage) error {
	if len(data) == 0 {
		data = json.RawMessage(`{}`)
	}
	_, err := s.Pool.Exec(ctx,
		`INSERT INTO events (id, session_id, ts_ms, kind, data) VALUES ($1,$2,$3,$4,$5)`,
		NewID(), sessionID, tsMs, kind, data)
	return err
}

// BehavioralSummary aggregates raw samples + events into the presence/communication
// numbers shown on the report. Returns "{}" (valid JSON) when there is no data.
func (s *Store) BehavioralSummary(ctx context.Context, sessionID string) (json.RawMessage, error) {
	var (
		fillers, longPauses, helpReqs                    int
		durationMs                                       int64
		eyeContact, lighting, posture, framing, speaking *float64
		sampleCount                                      int
	)

	_ = s.Pool.QueryRow(ctx, `
		SELECT
		  COUNT(*) FILTER (WHERE kind='filler'),
		  COUNT(*) FILTER (WHERE kind='long_pause'),
		  COUNT(*) FILTER (WHERE kind='help_request')
		FROM events WHERE session_id=$1`, sessionID).Scan(&fillers, &longPauses, &helpReqs)

	_ = s.Pool.QueryRow(ctx, `
		SELECT
		  COUNT(*),
		  COALESCE(MAX(ts_ms),0),
		  AVG((gaze->>'on_screen')::float),
		  AVG((lighting->>'score')::float),
		  AVG((posture->>'score')::float),
		  AVG((framing->>'score')::float),
		  AVG((vad->>'speaking')::float)
		FROM behavior_samples WHERE session_id=$1`, sessionID).
		Scan(&sampleCount, &durationMs, &eyeContact, &lighting, &posture, &framing, &speaking)

	minutes := float64(durationMs) / 60000.0
	fillerPerMin := 0.0
	if minutes > 0.1 {
		fillerPerMin = float64(fillers) / minutes
	}

	if sampleCount == 0 && fillers == 0 && longPauses == 0 && helpReqs == 0 {
		return json.RawMessage(`{}`), nil
	}

	out := map[string]any{
		"filler_per_min":  round1(fillerPerMin),
		"long_pauses":     longPauses,
		"help_requests":   helpReqs,
		"eye_contact_pct": pct(eyeContact),
		"posture_score":   deref(posture),
		"lighting_score":  deref(lighting),
		"framing_score":   deref(framing),
		"speaking_ratio":  deref(speaking),
		"samples":         sampleCount,
	}
	b, _ := json.Marshal(out)
	return b, nil
}

func deref(f *float64) float64 {
	if f == nil {
		return 0
	}
	return round1(*f)
}
func pct(f *float64) int {
	if f == nil {
		return 0
	}
	return int(*f * 100)
}
func round1(f float64) float64 { return float64(int(f*10+0.5)) / 10 }
