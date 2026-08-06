// Package httpx holds shared HTTP plumbing: RFC-7807 problem responses, JSON
// encode/decode helpers, and small middleware. Feature packages register their
// routes onto the chi router built in cmd/mockinterview.
package httpx

import (
	"encoding/json"
	"log/slog"
	"net/http"
)

// Problem is an RFC-7807 problem+json body.
type Problem struct {
	Type   string `json:"type"`
	Title  string `json:"title"`
	Status int    `json:"status"`
	Detail string `json:"detail,omitempty"`
}

// WriteProblem emits an RFC-7807 error response.
func WriteProblem(w http.ResponseWriter, status int, detail string) {
	w.Header().Set("Content-Type", "application/problem+json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(Problem{
		Type:   "about:blank",
		Title:  http.StatusText(status),
		Status: status,
		Detail: detail,
	})
}

// WriteJSON emits a JSON response with the given status.
func WriteJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if v != nil {
		if err := json.NewEncoder(w).Encode(v); err != nil {
			slog.Error("write json", "err", err)
		}
	}
}

// DecodeJSON reads and validates a JSON request body. Returns false (and writes
// a 400 problem) on failure.
func DecodeJSON(w http.ResponseWriter, r *http.Request, dst any) bool {
	if r.Body == nil {
		WriteProblem(w, http.StatusBadRequest, "empty body")
		return false
	}
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		WriteProblem(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return false
	}
	return true
}
