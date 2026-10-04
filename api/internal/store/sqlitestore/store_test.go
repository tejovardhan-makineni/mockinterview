package sqlitestore

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"github.com/tejo/mockinterview-api/internal/store"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"
)

var testContext = context.Background()

func openTest(t *testing.T, path string) *Store {
	t.Helper()
	s, e := Open(testContext, path)
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { _ = s.Close() })
	return s
}
func testUser(t *testing.T, s *Store) store.User {
	t.Helper()
	u, e := s.CreateUserWithPolicies(testContext, "local@example.test", "hashed-password", "terms-v1", "privacy-v1")
	if e != nil {
		t.Fatal(e)
	}
	return u
}
func must(t *testing.T, e error) {
	t.Helper()
	if e != nil {
		t.Fatal(e)
	}
}
func reserveTest(t *testing.T, s *Store, uid string) store.Session {
	t.Helper()
	a, e := s.ReserveSession(testContext, store.Reservation{Unlimited: true, Identity: "local-identity", Session: store.Session{UserID: uid, QuestionID: "custom-questions", Modality: "written", Track: "custom", DurationMinutes: 30, Funding: "personal", Provider: "gemini", Model: "test-model", Mode: "text", Config: json.RawMessage(`{"target_level":"senior"}`), QuestionSnapshot: json.RawMessage(`{"title":"My custom practice","private_rubric":"persist this"}`), FeedbackVersion: store.InterviewFeedbackVersion}, Credential: []byte("opaque-encrypted-credential"), CredentialExpires: time.Now().Add(time.Hour)})
	must(t, e)
	return a
}
func TestInterviewSurvivesRestartAndScoringCommitsAtomically(t *testing.T) {
	ctx := testContext
	path := filepath.Join(t.TempDir(), "data", "interviews.sqlite")
	s := openTest(t, path)
	u := testUser(t, s)
	must(t, s.SaveSettings(ctx, u.ID, json.RawMessage(`{"share_analytics":true,"share_results":false,"occupation":"teacher"}`)))
	r, e := s.SaveResume(ctx, u.ID, "resume.txt", "Original résumé text", json.RawMessage(`{"skills":["teaching"]}`))
	must(t, e)
	_, e = s.SaveResumeReview(ctx, u.ID, r.ID, "gemini", "model", json.RawMessage(`{"summary":"Review"}`))
	must(t, e)
	cfg := store.DefaultConfig()
	cfg.Intensity = 5
	must(t, s.SaveConfig(ctx, u.ID, cfg))
	a := reserveTest(t, s, u.ID)
	_, e = s.AcquireLive(ctx, a.ID, "first-owner")
	must(t, e)
	a, e = s.ActivateLive(ctx, a.ID, "first-owner")
	must(t, e)
	must(t, s.AddTurn(ctx, a.ID, "user", "My persisted response", 0, json.RawMessage(`{"event_id":"turn-1","lease_owner":"first-owner"}`)))
	if e = s.AddTurn(ctx, a.ID, "user", "duplicate", 0, json.RawMessage(`{"event_id":"turn-1"}`)); !errors.Is(e, store.ErrDuplicateEvent) {
		t.Fatalf("duplicate: %v", e)
	}
	workspace, e := s.SaveArtifact(ctx, a.ID, store.Workspace{Kind: "written", Content: "Lesson outline", Data: json.RawMessage(`{"notes":"persisted"}`)})
	must(t, e)
	if workspace.Revision != 1 {
		t.Fatal(workspace)
	}
	must(t, s.AddCanvasSnapshot(ctx, a.ID, 1, json.RawMessage(`[{"id":"shape"}]`), ""))
	must(t, s.AddBehaviorSample(ctx, a.ID, 60000, json.RawMessage(`{"on_screen":0.8}`), nil, nil, json.RawMessage(`{"score":3}`), nil, json.RawMessage(`{"speaking":1}`), nil))
	must(t, s.AddEvent(ctx, a.ID, 500, "interview_error", json.RawMessage(`{"stage":"reconnect"}`)))
	must(t, s.BeginFinish(ctx, a.ID))
	must(t, s.ReleaseLive(ctx, a.ID, "first-owner"))
	job, e := s.ClaimScoring(ctx)
	must(t, e)
	if job.SessionID != a.ID || job.Attempts != 1 {
		t.Fatal(job)
	}
	input := store.ScoringInput{Question: a.QuestionSnapshot, Config: a.Config, Turns: []store.Turn{{Role: "user", Text: "My persisted response"}}, Workspace: "Lesson outline", Behavioral: json.RawMessage(`{"samples":1}`)}
	must(t, s.SetScoringInput(ctx, a.ID, job.Attempts, input))
	// A crashed worker's frozen input is kept, while its lease eventually expires.
	must(t, s.write(ctx, func(tx *sql.Tx) error {
		j, e := readJob(ctx, tx, a.ID)
		if e != nil {
			return e
		}
		j.LeaseUntil = time.Now().Add(-time.Second)
		return saveJob(ctx, tx, j)
	}))
	must(t, s.Close())
	s = openTest(t, path)
	got, e := s.GetSession(ctx, a.ID)
	must(t, e)
	if got.UserID != u.ID || string(got.QuestionSnapshot) != string(a.QuestionSnapshot) || got.UsageIdentity != "local-identity" {
		t.Fatalf("private session fields lost: %+v", got)
	}
	rr, e := s.LatestResume(ctx, u.ID)
	must(t, e)
	if rr.ParsedText != "Original résumé text" || rr.ID != r.ID {
		t.Fatal(rr)
	}
	settings, e := s.GetSettings(ctx, u.ID)
	must(t, e)
	if !strings.Contains(string(settings), `"share_analytics":true`) {
		t.Fatal(string(settings))
	}
	savedConfig, e := s.GetConfig(ctx, u.ID)
	must(t, e)
	if savedConfig.Intensity != 5 {
		t.Fatal(savedConfig)
	}
	turns, e := s.Transcript(ctx, a.ID)
	must(t, e)
	if len(turns) != 1 || turns[0].Text != "My persisted response" || turns[0].Sequence <= 0 {
		t.Fatal(turns)
	}
	w, e := s.GetArtifact(ctx, a.ID)
	must(t, e)
	if w.Content != "Lesson outline" || w.Revision != 1 || string(w.Data) != `{"notes":"persisted"}` {
		t.Fatal(w)
	}
	canvas, e := s.LatestCanvasElements(ctx, a.ID)
	must(t, e)
	if string(canvas) != `[{"id":"shape"}]` {
		t.Fatal(string(canvas))
	}
	recovered, e := s.ClaimScoring(ctx)
	must(t, e)
	if recovered.Attempts != 2 || recovered.Input == nil || recovered.Input.Workspace != "Lesson outline" || string(recovered.Input.Question) != string(a.QuestionSnapshot) {
		t.Fatal(recovered)
	}
	report := store.Report{Overall: 3.5, Scored: true, CoachingMD: "Next steps", Radar: json.RawMessage(`[]`), Timeline: json.RawMessage(`[]`), Behavioral: json.RawMessage(`{"samples":1}`)}
	scores := []store.ScoreRow{{Dimension: "communication", Score: 3.5, Weight: 1, Assessed: true, Evidence: "Clear explanation"}}
	if e = s.CompleteScoring(ctx, a.ID, 1, report, scores); !errors.Is(e, store.ErrSessionConflict) {
		t.Fatalf("stale worker accepted: %v", e)
	}
	_, e = s.db.Exec(`CREATE TRIGGER interrupt_report BEFORE INSERT ON reports BEGIN SELECT RAISE(ABORT,'injected disk failure'); END`)
	must(t, e)
	if e = s.CompleteScoring(ctx, a.ID, 2, report, scores); e == nil {
		t.Fatal("expected transaction failure")
	}
	var count int
	must(t, s.db.QueryRow(`SELECT count(*) FROM scores WHERE session_id=?`, a.ID).Scan(&count))
	if count != 0 {
		t.Fatal("score rows escaped failed transaction")
	}
	got, e = s.GetSession(ctx, a.ID)
	must(t, e)
	if got.Status != "scoring" {
		t.Fatal(got.Status)
	}
	_, e = s.SessionCredential(ctx, a.ID)
	must(t, e)
	_, e = s.db.Exec(`DROP TRIGGER interrupt_report`)
	must(t, e)
	must(t, s.CompleteScoring(ctx, a.ID, 2, report, scores))
	if _, e = s.SessionCredential(ctx, a.ID); !errors.Is(e, store.ErrCredentialExpired) {
		t.Fatalf("credential not erased: %v", e)
	}
	must(t, s.Close())
	s = openTest(t, path)
	gotReport, gotScores, e := s.GetReport(ctx, a.ID)
	must(t, e)
	if gotReport.CoachingMD != "Next steps" || len(gotScores) != 1 || gotScores[0].Evidence != "Clear explanation" {
		t.Fatalf("%+v %+v", gotReport, gotScores)
	}
	history, e := s.ListUserSessions(ctx, u.ID, 20)
	must(t, e)
	if len(history) != 1 || history[0].QuestionTitle != "My custom practice" || history[0].Overall == nil || *history[0].Overall != 3.5 {
		t.Fatal(history)
	}
	metrics, e := s.SessionMetrics(ctx, a.ID)
	must(t, e)
	if metrics.ErrorCount != 1 || metrics.TurnCount != 1 {
		t.Fatal(metrics)
	}
	behavior, e := s.BehavioralSummary(ctx, a.ID)
	must(t, e)
	if !strings.Contains(string(behavior), `"eye_contact_pct":80`) {
		t.Fatal(string(behavior))
	}
}
func TestConcurrentAdmissionAndWorkspaceRevisionAcrossConnections(t *testing.T) {
	path := filepath.Join(t.TempDir(), "local.sqlite")
	a := openTest(t, path)
	u := testUser(t, a)
	b := openTest(t, path)
	var wg sync.WaitGroup
	results := make(chan error, 12)
	ids := make(chan string, 12)
	for i := 0; i < 12; i++ {
		wg.Go(func() {
			s := a
			if i%2 != 0 {
				s = b
			}
			session, e := s.ReserveSession(testContext, store.Reservation{Unlimited: true, Identity: "same-identity", Session: store.Session{UserID: u.ID, DurationMinutes: 30, Funding: "personal"}})
			if e == nil {
				ids <- session.ID
			}
			results <- e
		})
	}
	wg.Wait()
	close(results)
	close(ids)
	success := 0
	for e := range results {
		if e == nil {
			success++
		} else if !errors.Is(e, store.ErrSessionConflict) {
			t.Fatal(e)
		}
	}
	if success != 1 {
		t.Fatalf("%d reservations succeeded", success)
	}
	id := <-ids
	results = make(chan error, 12)
	for i := 0; i < 12; i++ {
		wg.Go(func() {
			s := a
			if i%2 != 0 {
				s = b
			}
			_, e := s.SaveArtifact(testContext, id, store.Workspace{Kind: "code", Content: "one revision", Revision: 1})
			results <- e
		})
	}
	wg.Wait()
	close(results)
	success = 0
	for e := range results {
		if e == nil {
			success++
		} else if !errors.Is(e, store.ErrSessionConflict) {
			t.Fatal(e)
		}
	}
	if success != 1 {
		t.Fatalf("%d revisions succeeded", success)
	}
}
func TestAbruptProcessExitRecovery(t *testing.T) {
	// Child exits without db.Close(), leaving WAL recovery to a fresh process.
	if path := os.Getenv("MOCKINTERVIEW_TEST_SQLITE_CRASH_PATH"); path != "" {
		s, e := Open(testContext, path)
		if e != nil {
			os.Exit(10)
		}
		u, e := s.CreateUser(testContext, "crash@example.test", "hash")
		if e != nil {
			os.Exit(11)
		}
		a, e := s.CreateSession(testContext, u.ID, "q", "written", "general", "", "", nil)
		if e != nil {
			os.Exit(12)
		}
		if e = s.AddTurn(testContext, a.ID, "user", "committed before shutdown", 0, nil); e != nil {
			os.Exit(13)
		}
		os.Exit(0)
	}
	path := filepath.Join(t.TempDir(), "interviews.sqlite")
	cmd := exec.Command(os.Args[0], "-test.run=^TestAbruptProcessExitRecovery$")
	cmd.Env = append(os.Environ(), "MOCKINTERVIEW_TEST_SQLITE_CRASH_PATH="+path)
	if output, e := cmd.CombinedOutput(); e != nil {
		t.Fatalf("%v: %s", e, output)
	}
	s := openTest(t, path)
	u, e := s.UserByEmail(testContext, "crash@example.test")
	must(t, e)
	history, e := s.ListUserSessions(testContext, u.ID, 1)
	must(t, e)
	if len(history) != 1 {
		t.Fatal(history)
	}
	turns, e := s.Transcript(testContext, history[0].ID)
	must(t, e)
	if len(turns) != 1 || turns[0].Text != "committed before shutdown" {
		t.Fatal(turns)
	}
}
func TestAuthFeedbackConsentAndCascadePersistence(t *testing.T) {
	ctx := testContext
	path := filepath.Join(t.TempDir(), "local.sqlite")
	s := openTest(t, path)
	u := testUser(t, s)
	must(t, s.SaveAuthAction(ctx, u.ID, "verify", "hashed-action", time.Now().Add(time.Hour)))
	if e := s.SaveAuthAction(ctx, u.ID, "verify", "second-action", time.Now().Add(time.Hour)); !errors.Is(e, store.ErrActionThrottled) {
		t.Fatal(e)
	}
	if _, e := s.ConsumeAuthAction(ctx, "hashed-action", "reset", "different"); !errors.Is(e, store.ErrNotFound) {
		t.Fatal(e)
	}
	uid, e := s.ConsumeAuthAction(ctx, "hashed-action", "verify", "")
	must(t, e)
	if uid != u.ID {
		t.Fatal(uid)
	}
	if _, e = s.ConsumeAuthAction(ctx, "hashed-action", "verify", ""); !errors.Is(e, store.ErrNotFound) {
		t.Fatal(e)
	}
	a := reserveTest(t, s, u.ID)
	_, e = s.AcquireLive(ctx, a.ID, "owner")
	must(t, e)
	_, e = s.ActivateLive(ctx, a.ID, "owner")
	must(t, e)
	must(t, s.ReleaseLive(ctx, a.ID, "owner"))
	must(t, s.UpdateSessionStatus(ctx, a.ID, "abandoned"))
	pending, e := s.PendingInterviewFeedback(ctx, u.ID)
	must(t, e)
	if len(pending) != 1 {
		t.Fatal(pending)
	}
	answers := map[string]string{}
	for _, key := range store.InterviewFeedbackQuestionIDs {
		answers[key] = "4"
	}
	survey := store.InterviewFeedback{SessionID: a.ID, UserID: u.ID, Version: store.InterviewFeedbackVersion, Answers: answers, Comment: "Useful practice", ShareTranscript: true, ComparisonSet: true, Comparison: &store.ToolComparison{Version: store.ToolComparisonVersion, PriorUse: "yes", ToolNames: "Other interviewer", Preference: "about_same", Details: "Private details"}}
	first, e := s.PutInterviewFeedback(ctx, survey)
	must(t, e)
	survey.ComparisonSet = false
	survey.Comparison = nil
	second, e := s.PutInterviewFeedback(ctx, survey)
	must(t, e)
	if second.Comparison == nil || !second.UpdatedAt.Equal(first.UpdatedAt) {
		t.Fatal(second)
	}
	feedbackID, e := s.SaveFeedback(ctx, u.ID, "bug", "Private feedback", 4, json.RawMessage(`{"page":"report"}`))
	must(t, e)
	must(t, s.UpdateFeedbackStatus(ctx, feedbackID, "reviewed"))
	beta, e := s.ApplyBeta(ctx, u.ID, "I can test desktop")
	must(t, e)
	must(t, s.ReviewBetaApplication(ctx, beta.ID, "approved", "operator"))
	request, e := s.SaveTemplateRequest(ctx, store.TemplateRequest{UserID: u.ID, Profession: "Nursing", Goal: "Practice clinical judgment", Level: "senior", Description: "More cases"})
	must(t, e)
	must(t, s.ReviewTemplateRequest(ctx, request.ID, "planned", "operator"))
	upload := store.SharedInterviewResult{UserID: u.ID, Source: "desktop", ClientSessionID: a.ID, ConsentVersion: "analytics-v1", Payload: json.RawMessage(`{"error_count":1}`)}
	uploadID, e := s.SaveSharedInterviewResult(ctx, upload)
	must(t, e)
	sameID, e := s.SaveSharedInterviewResult(ctx, upload)
	must(t, e)
	if uploadID != sameID {
		t.Fatal("sharing retry duplicated result")
	}
	must(t, s.Close())
	s = openTest(t, path)
	verified, e := s.UserByID(ctx, u.ID)
	must(t, e)
	if !verified.EmailVerified || verified.TermsVersion != "terms-v1" || verified.AdultConfirmedAt == nil {
		t.Fatal(verified)
	}
	saved, e := s.GetInterviewFeedback(ctx, u.ID, a.ID)
	must(t, e)
	if saved == nil || !saved.ShareTranscript || saved.Comment != "Useful practice" || saved.Comparison == nil {
		t.Fatal(saved)
	}
	window, e := s.InterviewFeedbackWindow(ctx, time.Now().Add(-time.Hour), time.Now().Add(time.Hour))
	must(t, e)
	if len(window) != 1 || window[0].Response.Comment != "" || window[0].Response.Comparison.ToolNames != "" || strings.Contains(string(window[0].Session.QuestionSnapshot), "private_rubric") {
		t.Fatal(window)
	}
	comments, more, e := s.InterviewFeedbackComments(ctx, 1, nil)
	must(t, e)
	if more || len(comments) != 1 || comments[0].Response.Comment != "Useful practice" {
		t.Fatal(comments, more)
	}
	testers, e := s.ListTesters(ctx)
	must(t, e)
	if len(testers) != 1 {
		t.Fatal(testers)
	}
	feedback, e := s.ListFeedback(ctx, 10)
	must(t, e)
	if len(feedback) != 1 || feedback[0].Status != "reviewed" {
		t.Fatal(feedback)
	}
	requests, e := s.ListTemplateRequests(ctx)
	must(t, e)
	if len(requests) != 1 || requests[0].Status != "planned" {
		t.Fatal(requests)
	}
	shared, e := s.ListSharedInterviewResults(ctx)
	must(t, e)
	if len(shared) != 1 || shared[0].ConsentVersion != "analytics-v1" {
		t.Fatal(shared)
	}
	exported, e := s.ExportAccount(ctx, u.ID)
	must(t, e)
	for _, secret := range []string{"hashed-password", "hashed-action", "opaque-encrypted-credential", "local-identity", "private_rubric"} {
		if strings.Contains(string(exported), secret) {
			t.Fatalf("export leaked %s", secret)
		}
	}
	if !strings.Contains(string(exported), "Useful practice") || !strings.Contains(string(exported), "Private feedback") {
		t.Fatal("export missing feedback")
	}
	must(t, s.DeleteSharedInterviewResults(ctx, u.ID))
	shared, e = s.ListSharedInterviewResults(ctx)
	must(t, e)
	if len(shared) != 0 {
		t.Fatal(shared)
	}
	must(t, s.DeleteUser(ctx, u.ID))
	if _, e = s.GetSession(ctx, a.ID); !errors.Is(e, store.ErrNotFound) {
		t.Fatal(e)
	}
	for _, table := range []string{"users", "auth_actions", "sessions", "session_credentials", "interview_feedback", "feedback", "beta_applications", "template_requests", "tester_emails"} {
		var n int
		must(t, s.db.QueryRow(`SELECT count(*) FROM `+table).Scan(&n))
		if n != 0 {
			t.Fatalf("%s retained %d rows", table, n)
		}
	}
}
func TestSchemaPermissionsCancellationAndMigrationRollback(t *testing.T) {
	path := filepath.Join(t.TempDir(), "profile", "history.sqlite")
	s := openTest(t, path)
	_ = testUser(t, s)
	if runtime.GOOS != "windows" {
		for _, name := range []string{filepath.Dir(path), path, path + "-wal", path + "-shm"} {
			info, e := os.Stat(name)
			must(t, e)
			if info.Mode().Perm()&0077 != 0 {
				t.Fatalf("insecure permissions %s: %v", name, info.Mode())
			}
		}
	}
	ctx, cancel := context.WithCancel(testContext)
	cancel()
	if _, e := s.CreateUser(ctx, "cancelled@example.test", "hash"); !errors.Is(e, context.Canceled) {
		t.Fatal(e)
	}
	_, e := s.db.Exec(`INSERT INTO schema_migrations(version,applied_at) VALUES(99,0)`)
	must(t, e)
	must(t, s.Close())
	if broken, e := Open(testContext, path); e == nil {
		broken.Close()
		t.Fatal("newer schema opened by old app")
	}
	db, e := sql.Open("sqlite", path)
	must(t, e)
	defer db.Close()
	var count int
	must(t, db.QueryRow(`SELECT count(*) FROM users`).Scan(&count))
	if count != 1 {
		t.Fatal("failed migration erased existing data")
	}
	if s, e := Open(testContext, ":memory:"); e == nil {
		s.Close()
		t.Fatal("in-memory desktop database allowed")
	}
}

func TestResumeReplacementRetainsReviewsUntilExplicitDeletion(t *testing.T) {
	ctx := testContext
	path := filepath.Join(t.TempDir(), "local.sqlite")
	s := openTest(t, path)
	u := testUser(t, s)
	original, e := s.SaveResume(ctx, u.ID, "old.txt", "Previous résumé", json.RawMessage(`{}`))
	must(t, e)
	oldReview, e := s.SaveResumeReview(ctx, u.ID, original.ID, "gemini", "model", json.RawMessage(`{"summary":"Previous review"}`))
	must(t, e)
	replacement, e := s.SaveResume(ctx, u.ID, "new.txt", "Current résumé", json.RawMessage(`{}`))
	must(t, e)
	_, e = s.SaveResumeReview(ctx, u.ID, replacement.ID, "gemini", "model", json.RawMessage(`{"summary":"Current review"}`))
	must(t, e)
	_, e = s.SaveResumeReview(ctx, u.ID, "", "gemini", "model", json.RawMessage(`{"summary":"Standalone review"}`))
	must(t, e)
	must(t, s.Close())
	s = openTest(t, path)
	var detached sql.NullString
	must(t, s.db.QueryRow(`SELECT resume_id FROM resume_reviews WHERE id=?`, oldReview).Scan(&detached))
	if detached.Valid {
		t.Fatal("prior review must be detached from deleted upload")
	}
	exported, e := s.ExportAccount(ctx, u.ID)
	must(t, e)
	for _, content := range []string{"Previous review", "Current review", "Standalone review", "Current résumé"} {
		if !strings.Contains(string(exported), content) {
			t.Fatalf("export lost %s", content)
		}
	}
	must(t, s.DeleteResumes(ctx, u.ID))
	if _, e = s.LatestResume(ctx, u.ID); !errors.Is(e, store.ErrNotFound) {
		t.Fatal(e)
	}
	var count int
	must(t, s.db.QueryRow(`SELECT count(*) FROM resume_reviews WHERE user_id=?`, u.ID).Scan(&count))
	if count != 0 {
		t.Fatalf("delete retained %d reviews", count)
	}
}

func TestInterruptedDeadlineRecoveryAndTelemetryRetention(t *testing.T) {
	ctx := testContext
	s := openTest(t, filepath.Join(t.TempDir(), "local.sqlite"))
	u := testUser(t, s)
	a := reserveTest(t, s, u.ID)
	_, e := s.AcquireLive(ctx, a.ID, "owner")
	must(t, e)
	_, e = s.ActivateLive(ctx, a.ID, "owner")
	must(t, e)
	must(t, s.ReleaseLive(ctx, a.ID, "owner"))
	must(t, s.AddTurn(ctx, a.ID, "user", "Keep this practice history", 0, nil))
	must(t, s.AddBehaviorSample(ctx, a.ID, 1000, nil, nil, nil, nil, nil, nil, nil))
	must(t, s.AddEvent(ctx, a.ID, 1000, "interview_error", json.RawMessage(`{"stage":"connection"}`)))
	// Simulate returning after the device was asleep beyond the interview deadline.
	must(t, s.changeSession(ctx, a.ID, func(d *sessionDocument) error {
		start := time.Now().Add(-3 * time.Minute)
		deadline := start.Add(time.Minute)
		d.Session.StartedAt = &start
		d.Session.DeadlineAt = &deadline
		return nil
	}))
	job, e := s.ClaimScoring(ctx)
	must(t, e)
	if job.SessionID != a.ID || job.Attempts != 1 {
		t.Fatal(job)
	}
	recovered, e := s.GetSession(ctx, a.ID)
	must(t, e)
	if recovered.Status != "scoring" {
		t.Fatal(recovered.Status)
	}
	metrics, e := s.SessionMetrics(ctx, a.ID)
	must(t, e)
	if metrics.DurationSeconds != 60 || metrics.ErrorCount != 1 {
		t.Fatal(metrics)
	}
	old := time.Now().Add(-31 * 24 * time.Hour).UnixMilli()
	_, e = s.db.Exec(`UPDATE behavior_samples SET created_at=?`, old)
	must(t, e)
	_, e = s.db.Exec(`UPDATE events SET created_at=?`, old)
	must(t, e)
	must(t, s.maintain(ctx))
	summary, e := s.BehavioralSummary(ctx, a.ID)
	must(t, e)
	if string(summary) != "{}" {
		t.Fatal(string(summary))
	}
	metrics, e = s.SessionMetrics(ctx, a.ID)
	must(t, e)
	if metrics.ErrorCount != 1 || metrics.TurnCount != 1 {
		t.Fatal("retention erased operational counts or saved transcript", metrics)
	}
}

func TestFailedInitialMigrationPreservesExistingFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "existing.sqlite")
	db, e := sql.Open("sqlite", path)
	must(t, e)
	_, e = db.Exec(`CREATE TABLE users(marker TEXT); INSERT INTO users(marker) VALUES('preserve-existing-content')`)
	must(t, e)
	must(t, db.Close())
	if s, e := Open(testContext, path); e == nil {
		s.Close()
		t.Fatal("incompatible existing database unexpectedly migrated")
	}
	db, e = sql.Open("sqlite", path)
	must(t, e)
	defer db.Close()
	var marker string
	must(t, db.QueryRow(`SELECT marker FROM users`).Scan(&marker))
	if marker != "preserve-existing-content" {
		t.Fatal(marker)
	}
	var migrations int
	must(t, db.QueryRow(`SELECT count(*) FROM sqlite_master WHERE name='schema_migrations'`).Scan(&migrations))
	if migrations != 0 {
		t.Fatal("failed migration left a partial migration ledger")
	}
}
