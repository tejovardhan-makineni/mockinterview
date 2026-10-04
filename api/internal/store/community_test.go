package store

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"testing"
)

func TestPostgresCommunityApprovalAndPrivacy(t *testing.T) {
	s := postgresRuntime(t)
	ctx := context.Background()
	owner, err := s.CreateUser(ctx, OwnerEmail, "unused")
	if err != nil {
		t.Fatal(err)
	}
	user, err := s.CreateUser(ctx, "community@example.test", "unused")
	if err != nil {
		t.Fatal(err)
	}
	a, err := s.ApplyBeta(ctx, user.ID, "Exercise senior interviews and report errors")
	if err != nil {
		t.Fatal(err)
	}
	if err = s.ReviewBetaApplication(ctx, a.ID, "approved", owner.ID); !errors.Is(err, ErrNotFound) {
		t.Fatal("unverified beta approval", err)
	}
	if _, err = s.Pool.Exec(ctx, `UPDATE users SET email_verified=true WHERE id=$1`, user.ID); err != nil {
		t.Fatal(err)
	}
	// An invalid reviewer fails the second write. The transaction must roll back
	// its earlier tester insertion instead of creating partially approved access.
	if err = s.ReviewBetaApplication(ctx, a.ID, "approved", NewID()); err == nil {
		t.Fatal("invalid reviewer accepted")
	}
	if entitled, e := s.IsTester(ctx, user.ID); e != nil || entitled {
		t.Fatal("failed approval leaked unlimited access", e)
	}
	a, err = s.BetaApplication(ctx, user.ID)
	if err != nil || a.Status != "pending" {
		t.Fatal("failed transaction changed application", err)
	}
	var wg sync.WaitGroup
	errs := make(chan error, 4)
	for range 4 {
		wg.Add(1)
		go func() { defer wg.Done(); errs <- s.ReviewBetaApplication(ctx, a.ID, "approved", owner.ID) }()
	}
	wg.Wait()
	close(errs)
	for e := range errs {
		if e != nil {
			t.Fatal(e)
		}
	}
	if entitled, e := s.IsTester(ctx, user.ID); e != nil || !entitled {
		t.Fatal("approval missing entitlement", e)
	}
	after, e := s.ApplyBeta(ctx, user.ID, "Trying to reset my own approval state")
	if e != nil || after.Status != "approved" || after.Motivation != a.Motivation {
		t.Fatal("applicant mutated reviewed application", e)
	}
	if err = s.ReviewBetaApplication(ctx, a.ID, "rejected", owner.ID); err != nil {
		t.Fatal(err)
	}
	if entitled, e := s.IsTester(ctx, user.ID); e != nil || entitled {
		t.Fatal("revocation retained access", e)
	}
	requested, e := s.SaveTemplateRequest(ctx, TemplateRequest{UserID: user.ID, Profession: "Nurse", Goal: "Hospital interview", Level: "Senior", Description: "Practice emergency handovers"})
	if e != nil {
		t.Fatal(e)
	}
	if err = s.ReviewTemplateRequest(ctx, requested.ID, "planned", owner.ID); err != nil {
		t.Fatal(err)
	}
	input := SharedInterviewResult{UserID: user.ID, ClientSessionID: "same-local-session", Source: "local", ConsentVersion: "2026-10-04", Payload: json.RawMessage(`{"status":"complete","turn_count":2}`)}
	first, e := s.SaveSharedInterviewResult(ctx, input)
	if e != nil {
		t.Fatal(e)
	}
	input.Payload = json.RawMessage(`{"status":"complete","turn_count":4}`)
	second, e := s.SaveSharedInterviewResult(ctx, input)
	if e != nil || second != first {
		t.Fatal("upload retry duplicated result", e)
	}
	raw, e := s.ExportAccount(ctx, user.ID)
	if e != nil {
		t.Fatal(e)
	}
	var exported map[string]json.RawMessage
	if e = json.Unmarshal(raw, &exported); e != nil {
		t.Fatal(e)
	}
	for _, key := range []string{"beta_applications", "template_requests", "shared_interview_results"} {
		var rows []map[string]any
		if e = json.Unmarshal(exported[key], &rows); e != nil || len(rows) != 1 {
			t.Fatal("community export", key, e)
		}
		if _, leak := rows[0]["reviewed_by"]; leak {
			t.Fatal("export leaked review actor")
		}
	}
	if err = s.DeleteSharedInterviewResults(ctx, owner.ID); err != nil {
		t.Fatal(err)
	}
	rows, e := s.ListSharedInterviewResults(ctx)
	if e != nil || len(rows) != 1 {
		t.Fatal("withdrawal crossed owner boundary", e)
	}
	if err = s.DeleteSharedInterviewResults(ctx, user.ID); err != nil {
		t.Fatal(err)
	}
	rows, e = s.ListSharedInterviewResults(ctx)
	if e != nil || len(rows) != 0 {
		t.Fatal("withdrawal retained shared results", e)
	}
	if _, e = s.SaveSharedInterviewResult(ctx, input); e != nil {
		t.Fatal(e)
	}
	if err = s.DeleteUser(ctx, user.ID); err != nil {
		t.Fatal(err)
	}
	for _, table := range []string{"beta_applications", "template_requests", "shared_interview_results"} {
		var count int
		if err = s.Pool.QueryRow(ctx, `SELECT count(*) FROM `+table+` WHERE user_id=$1`, user.ID).Scan(&count); err != nil || count != 0 {
			t.Fatal("account cascade", table, err)
		}
	}
}
