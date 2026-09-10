package interview

import (
	"github.com/tejo/mockinterview-api/internal/httpx"
	"net/http"
)

// Ingest is retired: the current product does not collect or infer camera-based
// behavior. Keep an explicit response for old clients instead of silently storing
// unvalidated gaze, expression or posture samples.
func (s *Service) Ingest(w http.ResponseWriter, r *http.Request) {
	httpx.WriteProblem(w, http.StatusGone, "Camera and behavioral analysis collection is disabled. Interviews work without these samples.")
}
