package store

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
)

func TestPostgresDeleteResumesIncludesDetachedReviewsAndPreservesHistory(t *testing.T) {
	s := postgresRuntime(t)
	ctx := context.Background()
	owner, err := s.CreateUser(ctx, "resume-owner@example.test", "unused")
	if err != nil {
		t.Fatal(err)
	}
	other, err := s.CreateUser(ctx, "other-owner@example.test", "unused")
	if err != nil {
		t.Fatal(err)
	}
	addResumeAndReview := func(uid, filename string) Resume {
		t.Helper()
		r, err := s.SaveResume(ctx, uid, filename, "Synthetic private resume", nil)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := s.SaveResumeReview(ctx, uid, r.ID, "stub", "stub", json.RawMessage(`{"summary":"Private standalone review"}`)); err != nil {
			t.Fatal(err)
		}
		return r
	}
	addResumeAndReview(owner.ID, "replaced.txt")
	addResumeAndReview(owner.ID, "latest.txt")
	otherResume := addResumeAndReview(other.ID, "other.txt")
	// Real replacement leaves the old review detached by ON DELETE SET NULL.
	var detached int
	if err := s.Pool.QueryRow(ctx, `SELECT count(*) FROM resume_reviews WHERE user_id=$1 AND resume_id IS NULL`, owner.ID).Scan(&detached); err != nil || detached != 1 {
		t.Fatalf("detached review fixture: count=%d err=%v", detached, err)
	}
	// Cover legacy/multiple uploads, even though normal upload keeps the latest.
	if _, err := s.Pool.Exec(ctx, `INSERT INTO resumes(id,user_id,filename) VALUES($1,$2,'legacy.txt')`, NewID(), owner.ID); err != nil {
		t.Fatal(err)
	}
	const interviewContext = `{"resume_text":"Context deliberately kept with the interview"}`
	session, err := s.CreateSession(ctx, owner.ID, "test-question", "conversational", "professional", "", "", json.RawMessage(interviewContext))
	if err != nil {
		t.Fatal(err)
	}
	if err := s.AddTurn(ctx, session.ID, "candidate", "Synthetic saved interview answer", 0, nil); err != nil {
		t.Fatal(err)
	}
	if err := s.SaveReport(ctx, session.ID, 3, json.RawMessage(`{}`), json.RawMessage(`[]`), json.RawMessage(`{}`), "Existing interview feedback", true, ""); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		if err := s.DeleteResumes(ctx, owner.ID); err != nil {
			t.Fatalf("delete attempt %d: %v", i+1, err)
		}
	}
	if _, err := s.LatestResume(ctx, owner.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("deleted resume still available: %v", err)
	}
	for _, table := range []string{"resumes", "resume_reviews"} {
		var ownerCount, otherCount int
		if err := s.Pool.QueryRow(ctx, `SELECT count(*) FILTER (WHERE user_id=$1),count(*) FILTER (WHERE user_id=$2) FROM `+table, owner.ID, other.ID).Scan(&ownerCount, &otherCount); err != nil {
			t.Fatal(err)
		}
		if ownerCount != 0 || otherCount != 1 {
			t.Fatalf("%s: deleted owner=%d other owner=%d", table, ownerCount, otherCount)
		}
	}
	if r, err := s.LatestResume(ctx, other.ID); err != nil || r.ID != otherResume.ID {
		t.Fatalf("other owner's latest resume changed: %v", err)
	}
	preserved, err := s.GetSession(ctx, session.ID)
	var cfg map[string]string
	if err != nil || json.Unmarshal(preserved.Config, &cfg) != nil || cfg["resume_text"] != "Context deliberately kept with the interview" {
		t.Fatalf("interview context changed: %v", err)
	}
	if turns, err := s.Transcript(ctx, session.ID); err != nil || len(turns) != 1 || turns[0].Text != "Synthetic saved interview answer" {
		t.Fatalf("interview transcript changed: %v", err)
	}
	if report, _, err := s.GetReport(ctx, session.ID); err != nil || report.CoachingMD != "Existing interview feedback" {
		t.Fatalf("interview report changed: %v", err)
	}
}
