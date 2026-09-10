// Package httpx holds shared HTTP plumbing: RFC-7807 problem responses, JSON
// encode/decode helpers, and small middleware. Feature packages register their
// routes onto the chi router built in cmd/mockinterview.
package httpx

import (
	"encoding/json"
	"errors"
	"io"
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

// MaxJSONBody caps the size of a JSON request body (1 MB) to prevent an
// authenticated client from buffering unbounded data into memory.
const MaxJSONBody = 1 << 20

// DecodeJSON reads and validates a JSON request body. Returns false (and writes
// a 400 problem) on failure. The body is capped at MaxJSONBody, and decode
// errors are not echoed verbatim (they can leak internal field names).
func DecodeJSON(w http.ResponseWriter, r *http.Request, dst any) bool {
	if r.Body == nil {
		WriteProblem(w, http.StatusBadRequest, "empty body")
		return false
	}
	r.Body = http.MaxBytesReader(w, r.Body, MaxJSONBody)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		var maxErr *http.MaxBytesError
		if errors.As(err, &maxErr) {
			WriteProblem(w, http.StatusRequestEntityTooLarge, "request body too large")
			return false
		}
		WriteProblem(w, http.StatusBadRequest, "invalid or malformed JSON body")
		return false
	}
	if err := dec.Decode(new(any)); err != io.EOF {
		WriteProblem(w, http.StatusBadRequest, "request must contain exactly one JSON value")
		return false
	}
	return true
}
