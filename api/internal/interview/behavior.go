package interview

import (
	"encoding/json"
	"net/http"

	"github.com/tejo/mockinterview-api/internal/httpx"
)

// Behavioral telemetry ingest. The browser batches samples (MediaPipe-derived
// gaze/pose/lighting + VAD) and discrete events (filler words, long pauses, help
// requests) and POSTs them here. Aggregation happens at report time.

type behaviorBatch struct {
	Samples []behaviorSample `json:"samples"`
	Events  []behaviorEvent  `json:"events"`
}

type behaviorSample struct {
	TsMs       int64           `json:"ts_ms"`
	Gaze       json.RawMessage `json:"gaze"`
	HeadPose   json.RawMessage `json:"head_pose"`
	Expression json.RawMessage `json:"expression"`
	Posture    json.RawMessage `json:"posture"`
	Lighting   json.RawMessage `json:"lighting"`
	Vad        json.RawMessage `json:"vad"`
	Framing    json.RawMessage `json:"framing"`
}

type behaviorEvent struct {
	TsMs int64           `json:"ts_ms"`
	Kind string          `json:"kind"`
	Data json.RawMessage `json:"data"`
}

// Ingest accepts a batch of behavioral samples + events for a session.
func (s *Service) Ingest(w http.ResponseWriter, r *http.Request) {
	sess, ok := s.owned(w, r)
	if !ok {
		return
	}
	var batch behaviorBatch
	if !httpx.DecodeJSON(w, r, &batch) {
		return
	}
	ctx := r.Context()
	for _, smp := range batch.Samples {
		_ = s.store.AddBehaviorSample(ctx, sess.ID, smp.TsMs, smp.Gaze, smp.HeadPose, smp.Expression, smp.Posture, smp.Lighting, smp.Vad, smp.Framing)
	}
	for _, ev := range batch.Events {
		switch ev.Kind {
		case "filler", "long_pause", "help_request", "interruption":
			_ = s.store.AddEvent(ctx, sess.ID, ev.TsMs, ev.Kind, ev.Data)
		}
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]int{"samples": len(batch.Samples), "events": len(batch.Events)})
}
