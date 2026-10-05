package corpus

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/tejo/mockinterview-api/internal/httpx"
)

type Service struct{ cat *Catalog }

func NewService(cat *Catalog) *Service { return &Service{cat: cat} }

// List serves client-safe summaries with optional modality, track, domain and
// role_track filters. "unspecified" selects shared/legacy role scope only.
func (s *Service) List(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	roleTrack := q.Get("role_track")
	if roleTrack != "" && roleTrack != "unspecified" && !ValidRoleTrack(roleTrack) {
		httpx.WriteProblem(w, http.StatusBadRequest, "invalid role_track")
		return
	}
	summaries := s.cat.List(q.Get("modality"), q.Get("track"), q.Get("domain"))
	if roleTrack != "" {
		matching := []Summary{}
		for _, summary := range summaries {
			if summary.RoleTrack == roleTrack || (roleTrack == "unspecified" && summary.RoleTrack == "") {
				matching = append(matching, summary)
			}
		}
		summaries = matching
	}
	httpx.WriteJSON(w, http.StatusOK, summaries)
}

// Get serves a single question summary (never the reference material).
func (s *Service) Get(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	q, ok := s.cat.Get(id)
	if !ok {
		httpx.WriteProblem(w, http.StatusNotFound, "question not found")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, q.Summary())
}
