package corpus

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/tejo/mockinterview-api/internal/httpx"
)

type Service struct{ cat *Catalog }

func NewService(cat *Catalog) *Service { return &Service{cat: cat} }

// List serves client-safe summaries with optional ?modality=&track=&domain= filters.
func (s *Service) List(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	summaries := s.cat.List(q.Get("modality"), q.Get("track"), q.Get("domain"))
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
