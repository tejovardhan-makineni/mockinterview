package main

import (
	"errors"
	"github.com/tejo/mockinterview-api/internal/auth"
	"github.com/tejo/mockinterview-api/internal/httpx"
	"github.com/tejo/mockinterview-api/internal/store"
	"net/http"
)

// Administration always reads the persisted account. Neither email allowlists
// nor caller-supplied token roles may grant administrative privileges.
func (a *App) testerAdmin(w http.ResponseWriter, r *http.Request) bool {
	u, err := a.Store.UserByID(r.Context(), auth.UserID(r.Context()))
	if err != nil || !u.EmailVerified || u.Role != "admin" {
		httpx.WriteProblem(w, http.StatusForbidden, "verified administrators only")
		return false
	}
	return true
}

func (a *App) listTesters(w http.ResponseWriter, r *http.Request) {
	if !a.testerAdmin(w, r) {
		return
	}
	items, err := a.Store.ListTesters(r.Context())
	if err != nil {
		httpx.WriteProblem(w, 503, "Could not load testers")
		return
	}
	httpx.WriteJSON(w, 200, map[string]any{"testers": items})
}

func (a *App) updateTester(w http.ResponseWriter, r *http.Request) {
	if !a.testerAdmin(w, r) {
		return
	}
	var req struct {
		Email string `json:"email"`
	}
	if !httpx.DecodeJSON(w, r, &req) {
		return
	}
	var item store.Tester
	var err error
	if r.Method == http.MethodDelete {
		err = a.Store.RemoveTester(r.Context(), req.Email)
	} else {
		item, err = a.Store.AddTester(r.Context(), req.Email)
	}
	if errors.Is(err, store.ErrInvalidTesterEmail) {
		httpx.WriteProblem(w, 400, store.ErrInvalidTesterEmail.Error())
		return
	}
	if err != nil {
		httpx.WriteProblem(w, 503, "Could not update testers")
		return
	}
	if r.Method == http.MethodDelete {
		w.WriteHeader(204)
		return
	}
	httpx.WriteJSON(w, 200, map[string]any{"tester": item})
}

func (a *App) testerUnlimited(nextLimit func(http.Handler) http.Handler) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		limited := nextLimit(next)
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			tester, err := a.Store.IsTester(r.Context(), auth.UserID(r.Context()))
			if err != nil {
				httpx.WriteProblem(w, 503, "Could not check account access")
				return
			}
			if tester {
				next.ServeHTTP(w, r)
				return
			}
			limited.ServeHTTP(w, r)
		})
	}
}
