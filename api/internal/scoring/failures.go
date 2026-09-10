package scoring

import (
	"context"
	"errors"
	"net"
)

// failure marks an evaluation boundary while preserving the original error for
// the existing retry policy. Only FailureDetails is safe to log or persist.
type failure struct {
	category string
	cause    error
}

func (e *failure) Error() string { return e.cause.Error() }
func (e *failure) Unwrap() error { return e.cause }

var errEvidenceLimit = errors.New("interview evidence exceeds the supported 512 KiB assessment limit; saved work has not been truncated")

// FailureDetails returns only fixed, allowlisted diagnostics. Provider errors,
// model output, candidate evidence and database errors must never be included.
func FailureDetails(err error) (category, message string) {
	category = "operation"
	var timeout net.Error
	var marked *failure
	switch {
	case errors.Is(err, context.DeadlineExceeded), errors.As(err, &timeout) && timeout.Timeout():
		category = "timeout"
	case errors.As(err, &marked):
		category = marked.category
	}
	switch category {
	case "provider_request":
		return category, "The feedback provider could not complete the request. Your interview is saved; check your provider settings and retry feedback."
	case "assessment_invalid":
		return category, "The feedback response could not be verified against your saved interview. Retry feedback."
	case "evidence_limit":
		return category, "Your saved interview exceeds the supported feedback size. Your transcript and workspace remain available."
	case "timeout":
		return category, "Feedback took too long to complete. Your interview is saved; retry feedback."
	default:
		return "operation", "Feedback could not be completed. Your interview is saved; retry feedback."
	}
}
