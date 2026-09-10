package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"testing"
	"time"
)

func surveyAnswers() map[string]string {
	a := map[string]string{}
	for _, id := range InterviewFeedbackQuestionIDs {
		a[id] = "4"
	}
	a["report_actionability"] = "report_unavailable"
	return a
}
func TestPostgresSurveyOwnershipLifecycleAtomicGateAndExport(t *testing.T) {
	s := postgresRuntime(t)
	ctx := context.Background()
	u, _ := s.CreateUser(ctx, "survey-owner@example.test", "unused")
	other, _ := s.CreateUser(ctx, "survey-other@example.test", "unused")
	r := reserveFor(u.ID, "survey-identity", "byok")
	r.Unlimited = true
	r.Session.FeedbackVersion = InterviewFeedbackVersion
	r.Session.QuestionSnapshot = json.RawMessage(`{"title":"Frozen title","domain":"coding","reference_answer":"PRIVATE_REFERENCE"}`)
	a, e := s.ReserveSession(ctx, r)
	if e != nil {
		t.Fatal(e)
	}
	if pending, e := s.PendingInterviewFeedback(ctx, u.ID); e != nil || len(pending) != 0 {
		t.Fatal("unused reservation required feedback", pending, e)
	}
	f := InterviewFeedback{SessionID: a.ID, UserID: u.ID, Version: InterviewFeedbackVersion, Answers: surveyAnswers()}
	if _, e = s.PutInterviewFeedback(ctx, f); !errors.Is(e, ErrInterviewFeedbackInvalid) {
		t.Fatal("unused submission accepted", e)
	}
	if _, e = s.AcquireLive(ctx, a.ID, "lease"); e != nil {
		t.Fatal(e)
	}
	if _, e = s.ActivateLive(ctx, a.ID, "lease"); e != nil {
		t.Fatal(e)
	}
	if e = s.ReleaseLive(ctx, a.ID, "lease"); e != nil {
		t.Fatal(e)
	}
	if e = s.UpdateSessionStatus(ctx, a.ID, "feedback_failed"); e != nil {
		t.Fatal(e)
	}
	pending, e := s.PendingInterviewFeedback(ctx, u.ID)
	if e != nil || len(pending) != 1 || pending[0].FeedbackVersion != InterviewFeedbackVersion {
		t.Fatal("failed started attempt omitted", pending, e)
	}
	// Every concurrent reservation rechecks under the existing identity/user lock,
	// including local unlimited and personal-key attempts.
	var wg sync.WaitGroup
	errs := make(chan error, 12)
	for i := 0; i < 12; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); _, e := s.ReserveSession(ctx, r); errs <- e }()
	}
	wg.Wait()
	close(errs)
	for e := range errs {
		if !errors.Is(e, ErrInterviewFeedbackRequired) {
			t.Fatalf("parallel gate %v", e)
		}
	}
	foreign := f
	foreign.UserID = other.ID
	if _, e = s.PutInterviewFeedback(ctx, foreign); !errors.Is(e, ErrNotFound) {
		t.Fatal("owner isolation", e)
	}
	if _, e = s.GetInterviewFeedback(ctx, other.ID, a.ID); !errors.Is(e, ErrNotFound) {
		t.Fatal("read isolation", e)
	}
	first, e := s.PutInterviewFeedback(ctx, f)
	if e != nil {
		t.Fatal(e)
	}
	again, e := s.PutInterviewFeedback(ctx, f)
	if e != nil || !first.SubmittedAt.Equal(again.SubmittedAt) || !first.UpdatedAt.Equal(again.UpdatedAt) {
		t.Fatal("duplicate changed timestamps", e)
	}
	f.Comment = "Edited feedback"
	edited, e := s.PutInterviewFeedback(ctx, f)
	if e != nil || !edited.SubmittedAt.Equal(first.SubmittedAt) || !edited.UpdatedAt.After(first.UpdatedAt) {
		t.Fatal("edit timestamps", e)
	}
	var submitWG sync.WaitGroup
	for i := 0; i < 12; i++ {
		submitWG.Add(1)
		go func() {
			defer submitWG.Done()
			if _, err := s.PutInterviewFeedback(ctx, f); err != nil {
				t.Error(err)
			}
		}()
	}
	submitWG.Wait()
	var responseCount int
	if err := s.Pool.QueryRow(ctx, `SELECT count(*) FROM interview_feedback WHERE session_id=$1`, a.ID).Scan(&responseCount); err != nil || responseCount != 1 {
		t.Fatal("concurrent upserts created duplicate response", err)
	}
	var exported struct {
		Feedback []InterviewFeedback `json:"interview_feedback"`
	}
	raw, e := s.ExportAccount(ctx, u.ID)
	if e != nil || json.Unmarshal(raw, &exported) != nil || len(exported.Feedback) != 1 {
		t.Fatal("export missing response", e)
	}
	if pending, e = s.PendingInterviewFeedback(ctx, u.ID); e != nil || len(pending) != 0 {
		t.Fatal("saved feedback still pending")
	}
	if _, e = s.ReserveSession(ctx, r); e != nil {
		t.Fatal("response did not unlock local reservation", e)
	}
	if e = s.DeleteSession(ctx, a.ID); e != nil {
		t.Fatal(e)
	}
	var n int
	if e = s.Pool.QueryRow(ctx, `SELECT count(*) FROM interview_feedback WHERE session_id=$1`, a.ID).Scan(&n); e != nil || n != 0 {
		t.Fatal("session cascade", e)
	}
}
func TestPostgresSurveyFullWindowDenominatorsAndLegacyExemption(t *testing.T) {
	s := postgresRuntime(t)
	ctx := context.Background()
	u, _ := s.CreateUser(ctx, "survey-window@example.test", "unused")
	now := time.Now().UTC()
	from := now.Add(-30 * 24 * time.Hour)
	// More than the legacy admin-list limit. No real interview/provider is used.
	for i := 0; i < 205; i++ {
		id := NewID()
		_, e := s.Pool.Exec(ctx, `INSERT INTO sessions(id,user_id,question_id,status,started_at,feedback_version,question_snapshot) VALUES($1,$2,'test', $3,$4,$5,'{"title":"Frozen","domain":"coding"}')`, id, u.ID, []string{"complete", "feedback_failed", "abandoned", "expired", "scoring"}[i%5], now.Add(-time.Hour), InterviewFeedbackVersion)
		if e != nil {
			t.Fatal(e)
		}
		if i%2 == 0 {
			_, e = s.PutInterviewFeedback(ctx, InterviewFeedback{SessionID: id, UserID: u.ID, Version: InterviewFeedbackVersion, Answers: surveyAnswers()})
			if e != nil {
				t.Fatal(e)
			}
		}
	}
	for i, rec := range []struct {
		status, version string
		started         *time.Time
	}{{"complete", "", &now}, {"reserved", InterviewFeedbackVersion, nil}, {"expired", InterviewFeedbackVersion, nil}, {"active", InterviewFeedbackVersion, &now}, {"complete", InterviewFeedbackVersion, &from}} {
		started := rec.started
		if i == 4 {
			v := from.Add(-time.Second)
			started = &v
		}
		_, e := s.Pool.Exec(ctx, `INSERT INTO sessions(id,user_id,question_id,status,started_at,feedback_version) VALUES($1,$2,'excluded',$3,$4,$5)`, NewID(), u.ID, rec.status, started, rec.version)
		if e != nil {
			t.Fatal(e)
		}
	}
	rows, e := s.InterviewFeedbackWindow(ctx, from, now)
	if e != nil || len(rows) != 205 {
		t.Fatalf("window count=%d err=%v", len(rows), e)
	}
	responses := 0
	for _, r := range rows {
		if r.Response != nil {
			responses++
		}
		if len(r.Session.QuestionSnapshot) == 0 {
			t.Fatal("lost frozen metadata")
		}
	}
	if responses != 103 {
		t.Fatalf("responses=%d", responses)
	}
	if e = s.DeleteUser(ctx, u.ID); e != nil {
		t.Fatal(e)
	}
	rows, e = s.InterviewFeedbackWindow(ctx, from, now)
	if e != nil || len(rows) != 0 {
		t.Fatal("account cascade", e)
	}
}
func TestSurveyValidationRejectsMissingUnknownAndWrongValues(t *testing.T) {
	f := InterviewFeedback{Version: InterviewFeedbackVersion, Answers: surveyAnswers()}
	if e := ValidateInterviewFeedback(f); e != nil {
		t.Fatal(e)
	}
	for _, change := range []func(*InterviewFeedback){func(f *InterviewFeedback) { f.Version = "old" }, func(f *InterviewFeedback) { delete(f.Answers, "challenge_fit") }, func(f *InterviewFeedback) { f.Answers["extra"] = "4" }, func(f *InterviewFeedback) { f.Answers["usability_ease"] = "report_unavailable" }, func(f *InterviewFeedback) { f.Answers["challenge_fit"] = "10" }} {
		v := f
		v.Answers = surveyAnswers()
		change(&v)
		if !errors.Is(ValidateInterviewFeedback(v), ErrInterviewFeedbackInvalid) {
			t.Fatal("invalid accepted", fmt.Sprint(v.Answers))
		}
	}
}

func TestPostgresSurveyTransitionSnapshotAndUnstartedActivation(t *testing.T) {
	s := postgresRuntime(t)
	ctx := context.Background()
	u, _ := s.CreateUser(ctx, "survey-transition@example.test", "unused")
	r := reserveFor(u.ID, "survey-transition", "platform")
	r.Unlimited = true
	r.Session.FeedbackVersion = InterviewFeedbackVersion
	a, e := s.ReserveSession(ctx, r)
	if e != nil {
		t.Fatal(e)
	}
	_, e = s.Pool.Exec(ctx, `UPDATE sessions SET started_at=now(),deadline_at=now()+interval '5 minutes',status='ending' WHERE id=$1`, a.ID)
	if e != nil {
		t.Fatal(e)
	}
	// Exercise worker-style status changes while admission observes the old or new
	// state: every statement must see either the live attempt or its pending form.
	done := make(chan error, 1)
	go func() {
		for i := 0; i < 150; i++ {
			state := "ending"
			if i%2 == 0 {
				state = "scoring"
			}
			if _, err := s.Pool.Exec(ctx, `UPDATE sessions SET status=$2 WHERE id=$1`, a.ID, state); err != nil {
				done <- err
				return
			}
		}
		done <- nil
	}()
	for i := 0; i < 150; i++ {
		usage, err := readUsage(ctx, s.Pool, u.ID, r.Identity, true)
		if err != nil || usage.ActiveSessionID == "" && !usage.PendingFeedback {
			t.Fatal("incoherent active/pending snapshot", usage, err)
		}
	}
	if e = <-done; e != nil {
		t.Fatal(e)
	}
	// A delayed worker can close a timed-out prior attempt after another unused
	// reservation exists. Activation must recheck; resuming started work must not.
	_, e = s.Pool.Exec(ctx, `UPDATE sessions SET status='ending',deadline_at=now()-interval '1 minute' WHERE id=$1`, a.ID)
	if e != nil {
		t.Fatal(e)
	}
	for _, state := range []string{"ending", "active", "interrupted"} {
		_ = s.UpdateSessionStatus(ctx, a.ID, state)
		if _, err := s.ReserveSession(ctx, r); !errors.Is(err, ErrSessionConflict) {
			t.Fatalf("timed-out %s did not block reservation: %v", state, err)
		}
	}
	// Synthetic reservation represents an already existing attempt from an old
	// deployment. New code must not activate it through an outstanding form.
	nextID := NewID()
	if _, err := s.Pool.Exec(ctx, `INSERT INTO sessions(id,user_id,question_id,status,reserved_until,feedback_version,quota_exempt,duration_minutes) VALUES($1,$2,'test','reserved',now()+interval '10 minutes',$3,true,15)`, nextID, u.ID, InterviewFeedbackVersion); err != nil {
		t.Fatal(err)
	}
	next, e := s.GetSession(ctx, nextID)
	if e != nil {
		t.Fatal(e)
	}
	_ = s.UpdateSessionStatus(ctx, a.ID, "feedback_failed")
	if _, e = s.AcquireLive(ctx, next.ID, "new"); e != nil {
		t.Fatal(e)
	}
	if _, e = s.ActivateLive(ctx, next.ID, "new"); !errors.Is(e, ErrInterviewFeedbackRequired) {
		t.Fatal("unstarted reservation bypassed feedback", e)
	}
	if _, e = s.PutInterviewFeedback(ctx, InterviewFeedback{SessionID: a.ID, UserID: u.ID, Version: InterviewFeedbackVersion, Answers: surveyAnswers()}); e != nil {
		t.Fatal(e)
	}
	if _, e = s.ActivateLive(ctx, next.ID, "new"); e != nil {
		t.Fatal(e)
	}
	if _, e = s.Pool.Exec(ctx, `DELETE FROM interview_feedback WHERE session_id=$1`, a.ID); e != nil {
		t.Fatal(e)
	}
	if e = s.ReleaseLive(ctx, next.ID, "new"); e != nil {
		t.Fatal(e)
	}
	if _, e = s.AcquireLive(ctx, next.ID, "resume"); e != nil {
		t.Fatal(e)
	}
	if _, e = s.ActivateLive(ctx, next.ID, "resume"); e != nil {
		t.Fatal("pending survey blocked started reconnect", e)
	}
}

func TestPostgresSurveyCommentPaginationExcludesPrivateDataAndEmptyComments(t *testing.T) {
	s := postgresRuntime(t)
	ctx := context.Background()
	u, _ := s.CreateUser(ctx, "comments@example.test", "unused")
	at := time.Now().UTC().Add(-time.Hour)
	ids := []string{}
	for i := 0; i < 4; i++ {
		id := NewID()
		ids = append(ids, id)
		_, e := s.Pool.Exec(ctx, `INSERT INTO sessions(id,user_id,question_id,status,started_at,feedback_version,question_snapshot) VALUES($1,$2,'test','complete',$3,$4,'{"title":"Public title","domain":"coding","reference_answer":"PRIVATE_REFERENCE"}')`, id, u.ID, at, InterviewFeedbackVersion)
		if e != nil {
			t.Fatal(e)
		}
		comment := ""
		if i < 3 {
			comment = fmt.Sprintf("Useful suggestion%d", i)
		}
		if _, e = s.PutInterviewFeedback(ctx, InterviewFeedback{SessionID: id, UserID: u.ID, Version: InterviewFeedbackVersion, Answers: surveyAnswers(), Comment: comment}); e != nil {
			t.Fatal(e)
		}
	}
	_, e := s.Pool.Exec(ctx, `UPDATE interview_feedback SET updated_at=$1 WHERE user_id=$2`, at, u.ID)
	if e != nil {
		t.Fatal(e)
	}
	first, more, e := s.InterviewFeedbackComments(ctx, 2, nil)
	if e != nil || !more || len(first) != 2 {
		t.Fatal("first page", len(first), more, e)
	}
	last := first[1]
	second, more, e := s.InterviewFeedbackComments(ctx, 2, &FeedbackCursor{UpdatedAt: last.Response.UpdatedAt, SessionID: last.Session.ID})
	if e != nil || more || len(second) != 1 {
		t.Fatal("second page", len(second), more, e)
	}
	seen := map[string]bool{}
	for _, r := range append(first, second...) {
		if seen[r.Session.ID] || r.Response.Comment == "" {
			t.Fatal("duplicate/empty comment")
		}
		seen[r.Session.ID] = true
		if string(r.Session.QuestionSnapshot) == "" || r.Response.UserID != "" || r.Response.Answers != nil {
			t.Fatal("query did not minimize data")
		}
		var c map[string]any
		_ = json.Unmarshal(r.Session.QuestionSnapshot, &c)
		if c["reference_answer"] != nil {
			t.Fatal("private reference read by comments query")
		}
	}
	if e = s.DeleteUser(ctx, u.ID); e != nil {
		t.Fatal(e)
	}
	rows, more, e := s.InterviewFeedbackComments(ctx, 25, nil)
	if e != nil || more || len(rows) != 0 {
		t.Fatal("deleted account comments retained")
	}
}
