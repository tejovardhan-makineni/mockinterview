package auth

import (
	"net/http"

	"github.com/tejo/mockinterview-api/internal/httpx"
	"github.com/tejo/mockinterview-api/internal/store"
)

// These versions identify the actual published documents, not general consent
// to optional research, marketing, recording or third-party content processing.
const TermsVersion = "2026-09-10"
const PrivacyVersion = "2026-09-10"

type policyAssertion struct {
	AdultConfirmed bool   `json:"adult_confirmed"`
	TermsVersion   string `json:"terms_version"`
	PrivacyVersion string `json:"privacy_version"`
}

func (a policyAssertion) current() bool {
	return a.AdultConfirmed && a.TermsVersion == TermsVersion && a.PrivacyVersion == PrivacyVersion
}

func PoliciesAccepted(u store.User) bool {
	return HasPolicyAcknowledgment(u) && u.TermsVersion == TermsVersion && u.PrivacyVersion == PrivacyVersion
}

// Existing paid interviews may finish under the acknowledgment in force when
// started. A document revision must not strand their already queued reports.
func HasPolicyAcknowledgment(u store.User) bool {
	return u.AdultConfirmedAt != nil && u.PoliciesAcceptedAt != nil && u.TermsVersion != "" && u.PrivacyVersion != ""
}

// PolicyRequired gives clients a stable, non-sensitive reason to show the
// acknowledgment flow without clearing authentication or private account data.
func PolicyRequired(w http.ResponseWriter) {
	httpx.WriteJSON(w, http.StatusForbidden, map[string]any{
		"status": http.StatusForbidden,
		"code":   "policies_required",
		"detail": "Review and accept the current terms, acknowledge the privacy notice, and confirm you are at least 18 before using hosted AI features.",
	})
}

func (s *Service) LegalPolicy(w http.ResponseWriter, _ *http.Request) {
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"terms_version": TermsVersion, "privacy_version": PrivacyVersion, "minimum_age": 18, "required": s.options.RequirePolicies})
}

func (s *Service) AcceptPolicies(w http.ResponseWriter, r *http.Request) {
	var a policyAssertion
	if !httpx.DecodeJSON(w, r, &a) {
		return
	}
	if !a.current() {
		PolicyRequired(w)
		return
	}
	repo, ok := s.store.(store.PolicyStore)
	if !ok {
		httpx.WriteProblem(w, 503, "account service unavailable")
		return
	}
	u, err := repo.AcceptPolicies(r.Context(), UserID(r.Context()), a.TermsVersion, a.PrivacyVersion)
	if err != nil {
		httpx.WriteProblem(w, 503, "account service unavailable")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, s.payload(u))
}

// Eligible is deliberately mounted only on hosted AI routes, never on account
// recovery, history, exports, deletion or private support.
func (s *Service) Eligible(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !s.options.RequirePolicies {
			next.ServeHTTP(w, r)
			return
		}
		u, err := s.store.UserByID(r.Context(), UserID(r.Context()))
		if err != nil {
			httpx.WriteProblem(w, 503, "account service unavailable")
			return
		}
		if !PoliciesAccepted(u) {
			PolicyRequired(w)
			return
		}
		next.ServeHTTP(w, r)
	})
}
