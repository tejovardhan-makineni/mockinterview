package profile

import (
	"context"
	"encoding/json"
	"github.com/tejo/mockinterview-api/internal/auth"
	"github.com/tejo/mockinterview-api/internal/httpx"
	"net/http"
)

func (s *Service) ExportAccount(w http.ResponseWriter, r *http.Request) {
	repo, ok := s.store.(interface {
		ExportAccount(context.Context, string) (json.RawMessage, error)
	})
	if !ok {
		httpx.WriteProblem(w, 503, "Account export is unavailable in this storage mode.")
		return
	}
	data, err := repo.ExportAccount(r.Context(), auth.UserID(r.Context()))
	if err != nil {
		httpx.WriteProblem(w, 503, "Could not export account data. Try again.")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Content-Disposition", `attachment; filename="mockinterview-data.json"`)
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write(data)
}
