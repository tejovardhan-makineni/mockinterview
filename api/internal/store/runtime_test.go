package store

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
	"net/url"
	"os"
	"strings"
	"sync"
	"testing"
	"time"
)

func postgresRuntime(t *testing.T) *Store {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL is required for real PostgreSQL checks")
	}
	ctx := context.Background()
	admin, e := pgx.Connect(ctx, dsn)
	if e != nil {
		t.Fatal(e)
	}
	schema := "runtime_" + strings.ReplaceAll(NewID(), "-", "")
	if _, e = admin.Exec(ctx, `CREATE SCHEMA `+schema); e != nil {
		t.Fatal(e)
	}
	u, e := url.Parse(dsn)
	if e != nil {
		t.Fatal(e)
	}
	q := u.Query()
	q.Set("search_path", schema)
	u.RawQuery = q.Encode()
	s, e := Open(ctx, u.String(), 8)
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { s.Close(); _, _ = admin.Exec(ctx, `DROP SCHEMA `+schema+` CASCADE`); _ = admin.Close(ctx) })
	return s
}
func reserveFor(uid, identity, funding string) Reservation {
	return Reservation{Session: Session{UserID: uid, QuestionID: "test-question", Modality: "conversational", Track: "professional", DurationMinutes: 15, Funding: funding, Mode: "text", Config: json.RawMessage(`{}`)}, Identity: identity}
}
func TestPostgresAtomicAttemptsAndDurableFinish(t *testing.T) {
	s := postgresRuntime(t)
	ctx := context.Background()
	u, e := s.CreateUser(ctx, "candidate@example.com", "unused")
	if e != nil {
		t.Fatal(e)
	}
	alias, e := s.CreateUser(ctx, "alias@example.com", "unused")
	if e != nil {
		t.Fatal(e)
	}
	var wg sync.WaitGroup
	wins := make(chan Session, 20)
	errs := make(chan error, 20)
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			uid := u.ID
			if i%2 == 1 {
				uid = alias.ID
			}
			a, e := s.ReserveSession(ctx, reserveFor(uid, "same-verified-identity", "platform"))
			if e == nil {
				wins <- a
			} else if !errors.Is(e, ErrSessionConflict) {
				errs <- e
			}
		}(i)
	}
	wg.Wait()
	close(wins)
	close(errs)
	for e := range errs {
		t.Error(e)
	}
	if len(wins) != 1 {
		t.Fatalf("parallel reservations=%d; want 1", len(wins))
	}
	a := <-wins
	if _, e = s.AcquireLive(ctx, a.ID, "owner"); e != nil {
		t.Fatal(e)
	}
	if _, e = s.AcquireLive(ctx, a.ID, "second"); !errors.Is(e, ErrSessionConflict) {
		t.Fatalf("second live lease=%v", e)
	}
	a, e = s.ActivateLive(ctx, a.ID, "owner")
	if e != nil {
		t.Fatal(e)
	}
	if a.StartedAt == nil || a.DeadlineAt == nil {
		t.Fatal("missing canonical clock")
	}
	started := *a.StartedAt
	meta := json.RawMessage(`{"event_id":"candidate-1","lease_owner":"owner"}`)
	if e = s.AddTurn(ctx, a.ID, "candidate", "first answer", 9000, meta); e != nil {
		t.Fatal(e)
	}
	if e = s.AddTurn(ctx, a.ID, "candidate", "first answer", 0, meta); !errors.Is(e, ErrDuplicateEvent) {
		t.Fatalf("duplicate=%v", e)
	}
	w, e := s.SaveArtifact(ctx, a.ID, Workspace{Kind: "code", Content: "initial", Revision: 1, Data: json.RawMessage(`{"language":"go"}`)})
	if e != nil || w.Revision != 1 {
		t.Fatalf("save: %+v %v", w, e)
	}
	if _, e = s.SaveArtifact(ctx, a.ID, w); !errors.Is(e, ErrSessionConflict) {
		t.Fatalf("stale save=%v", e)
	}
	w.Content = "final"
	w.Revision = 2
	if _, e = s.SaveArtifact(ctx, a.ID, w); e != nil {
		t.Fatal(e)
	}
	if e = s.ReleaseLive(ctx, a.ID, "owner"); e != nil {
		t.Fatal(e)
	}
	if _, e = s.AcquireLive(ctx, a.ID, "resumed"); e != nil {
		t.Fatal(e)
	}
	a, e = s.ActivateLive(ctx, a.ID, "resumed")
	if e != nil || !a.StartedAt.Equal(started) {
		t.Fatalf("reconnect changed clock: %+v %v", a, e)
	}
	if e = s.BeginFinish(ctx, a.ID); e != nil {
		t.Fatal(e)
	}
	if _, e = s.ClaimScoring(ctx); !errors.Is(e, ErrNotFound) {
		t.Fatalf("claimed before final drain: %v", e)
	}
	if e = s.AddTurn(ctx, a.ID, "candidate", "last answer", 1, json.RawMessage(`{"lease_owner":"resumed"}`)); e != nil {
		t.Fatal(e)
	}
	if e = s.ReleaseLive(ctx, a.ID, "resumed"); e != nil {
		t.Fatal(e)
	}
	job, e := s.ClaimScoring(ctx)
	if e != nil || job.SessionID != a.ID {
		t.Fatalf("claim=%+v %v", job, e)
	}
	if _, e = s.ClaimScoring(ctx); !errors.Is(e, ErrNotFound) {
		t.Fatalf("duplicate job=%v", e)
	}
	turns, e := s.Transcript(ctx, a.ID)
	if e != nil || len(turns) != 2 || turns[0].Text != "first answer" || turns[1].Text != "last answer" || turns[1].Sequence <= turns[0].Sequence {
		t.Fatalf("order=%+v %v", turns, e)
	}
	artifact, e := s.GetArtifact(ctx, a.ID)
	if e != nil || artifact.Content != "final" || artifact.Revision != 2 {
		t.Fatalf("artifact=%+v %v", artifact, e)
	}
	bad := Report{Radar: json.RawMessage(`{`), Timeline: json.RawMessage(`[]`), Behavioral: json.RawMessage(`{}`)}
	if e = s.CompleteScoring(ctx, a.ID, job.Attempts, bad, []ScoreRow{{Dimension: "signal", Score: 3, Assessed: true}}); e == nil {
		t.Fatal("invalid report unexpectedly committed")
	}
	a, _ = s.GetSession(ctx, a.ID)
	if a.Status != "scoring" {
		t.Fatalf("failed transaction changed status=%s", a.Status)
	}
	good := Report{Radar: json.RawMessage(`{}`), Timeline: json.RawMessage(`[]`), Behavioral: json.RawMessage(`{}`), Scored: true, Overall: 3}
	if e = s.CompleteScoring(ctx, a.ID, job.Attempts, good, []ScoreRow{{Dimension: "signal", Score: 3, Assessed: true}}); e != nil {
		t.Fatal(e)
	}
	if _, e = s.AcquireLive(ctx, a.ID, "third"); !errors.Is(e, ErrSessionConflict) {
		t.Fatalf("reopened complete: %v", e)
	}
	if e = s.DeleteSession(ctx, a.ID); e != nil {
		t.Fatal(e)
	}
	usage, e := s.Usage(ctx, u.ID, "same-verified-identity", false)
	if e != nil || usage.NextStartAt == nil || usage.NextFundedAt == nil || usage.FundedAvailable {
		t.Fatalf("deletion reset quota=%+v %v", usage, e)
	}
	if _, e = s.ReserveSession(ctx, reserveFor(u.ID, "same-verified-identity", "byok")); !errors.Is(e, ErrQuota) {
		t.Fatalf("funding switch bypass=%v", e)
	}
	// After 25h BYOK is eligible while platform remains on the 7d window.
	if _, e = s.Pool.Exec(ctx, `UPDATE interview_usage SET activated_at=now()-interval '25 hours'`); e != nil {
		t.Fatal(e)
	}
	if _, e = s.ReserveSession(ctx, reserveFor(u.ID, "same-verified-identity", "platform")); !errors.Is(e, ErrQuota) {
		t.Fatalf("weekly bypass=%v", e)
	}
	if _, e = s.ReserveSession(ctx, reserveFor(u.ID, "same-verified-identity", "byok")); e != nil {
		t.Fatalf("BYOK after daily reset=%v", e)
	}
}
func TestPostgresPreReadyRefundCredentialsAndGlobalCap(t *testing.T) {
	s := postgresRuntime(t)
	ctx := context.Background()
	u, e := s.CreateUser(ctx, "one@example.com", "unused")
	if e != nil {
		t.Fatal(e)
	}
	v, e := s.CreateUser(ctx, "two@example.com", "unused")
	if e != nil {
		t.Fatal(e)
	}
	r := reserveFor(u.ID, "one", "platform")
	r.GlobalDailyLimit = 1
	r.Credential = []byte("ciphertext")
	r.CredentialExpires = time.Now().Add(time.Minute)
	a, e := s.ReserveSession(ctx, r)
	if e != nil {
		t.Fatal(e)
	}
	other := reserveFor(v.ID, "two", "platform")
	other.GlobalDailyLimit = 1
	if _, e = s.ReserveSession(ctx, other); !errors.Is(e, ErrQuota) {
		t.Fatalf("global reserved cap=%v", e)
	}
	if _, e = s.AcquireLive(ctx, a.ID, "setup"); e != nil {
		t.Fatal(e)
	}
	if e = s.ReleaseLive(ctx, a.ID, "setup"); e != nil {
		t.Fatal(e)
	}
	usage, _ := s.Usage(ctx, u.ID, "one", false)
	if !usage.FundedAvailable || usage.ActiveSessionID != "" {
		t.Fatalf("failed setup consumed allowance=%+v", usage)
	}
	a, e = s.ReserveSession(ctx, other)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = s.AcquireLive(ctx, a.ID, "ready"); e != nil {
		t.Fatal(e)
	}
	if _, e = s.ActivateLive(ctx, a.ID, "ready"); e != nil {
		t.Fatal(e)
	}
	if _, e = s.ReserveSession(ctx, r); !errors.Is(e, ErrQuota) {
		t.Fatalf("global activated cap=%v", e)
	}
	if e = s.SetSessionCredential(ctx, a.ID, []byte("expired"), time.Now().Add(-time.Minute)); e != nil {
		t.Fatal(e)
	}
	if _, e = s.SessionCredential(ctx, a.ID); !errors.Is(e, ErrCredentialExpired) {
		t.Fatalf("expired credential returned=%v", e)
	}
}

func TestPostgresScoringLeaseRecoveryAndExportPrivacy(t *testing.T) {
	s := postgresRuntime(t)
	ctx := context.Background()
	u, e := s.CreateUser(ctx, "mine@example.com", "private-password-hash")
	if e != nil {
		t.Fatal(e)
	}
	v, e := s.CreateUser(ctx, "someone-else@example.com", "unrelated-hash")
	if e != nil {
		t.Fatal(e)
	}
	r := reserveFor(u.ID, "private-quota-identity", "byok")
	r.Credential = []byte("private-encrypted-key")
	r.CredentialExpires = time.Now().Add(time.Hour)
	r.Session.QuestionSnapshot = json.RawMessage(`{"reference_answer":"private-reference-answer"}`)
	r.Session.LiveModel = "frozen-live-model"
	a, e := s.ReserveSession(ctx, r)
	if e != nil {
		t.Fatal(e)
	}
	other, e := s.ReserveSession(ctx, reserveFor(v.ID, "other-identity", "platform"))
	if e != nil {
		t.Fatal(e)
	}
	if e = s.AddTurn(ctx, other.ID, "candidate", "other-private-answer", 0, nil); e != nil {
		t.Fatal(e)
	}
	if _, e = s.AcquireLive(ctx, a.ID, "private-lease-owner"); e != nil {
		t.Fatal(e)
	}
	if _, e = s.ActivateLive(ctx, a.ID, "private-lease-owner"); e != nil {
		t.Fatal(e)
	}
	if e = s.AddTurn(ctx, a.ID, "candidate", "my-answer", 0, json.RawMessage(`{"lease_owner":"private-lease-owner","event_id":"mine-1"}`)); e != nil {
		t.Fatal(e)
	}
	fid, e := s.SaveFeedback(ctx, u.ID, "product", "my feedback", 5, json.RawMessage(`{"target":"product_experience"}`))
	if e != nil {
		t.Fatal(e)
	}
	if e = s.UpdateFeedbackStatus(ctx, fid, "reviewed"); e != nil {
		t.Fatal(e)
	}
	exported, e := s.ExportAccount(ctx, u.ID)
	if e != nil {
		t.Fatal(e)
	}
	for _, secret := range []string{"private-password-hash", "private-encrypted-key", "private-reference-answer", "private-quota-identity", "private-lease-owner", "other-private-answer", "someone-else@example.com", "quota_exempt", "global_daily_limit", "question_snapshot"} {
		if strings.Contains(string(exported), secret) {
			t.Errorf("export disclosed %s", secret)
		}
	}
	for _, own := range []string{"my-answer", "my feedback", "reviewed", "frozen-live-model"} {
		if !strings.Contains(string(exported), own) {
			t.Errorf("export missing %s", own)
		}
	}
	if e = s.ReleaseLive(ctx, a.ID, "private-lease-owner"); e != nil {
		t.Fatal(e)
	}
	if _, e = s.Pool.Exec(ctx, `UPDATE sessions SET deadline_at=now()-interval '1 second' WHERE id=$1`, a.ID); e != nil {
		t.Fatal(e)
	}
	job, e := s.ClaimScoring(ctx)
	if e != nil {
		t.Fatal(e)
	}
	in := ScoringInput{Question: json.RawMessage(`{"id":"frozen"}`), Turns: []Turn{{Text: "frozen-answer"}}}
	if e = s.SetScoringInput(ctx, a.ID, job.Attempts, in); e != nil {
		t.Fatal(e)
	}
	if _, e = s.Pool.Exec(ctx, `UPDATE scoring_jobs SET lease_until=now()-interval '1 second' WHERE session_id=$1`, a.ID); e != nil {
		t.Fatal(e)
	}
	next, e := s.ClaimScoring(ctx)
	if e != nil || next.Attempts != job.Attempts+1 || next.Input == nil || next.Input.Turns[0].Text != "frozen-answer" {
		t.Fatalf("retry lost frozen input: %+v %v", next, e)
	}
	if e = s.FailScoring(ctx, a.ID, job.Attempts, "obsolete"); !errors.Is(e, ErrSessionConflict) {
		t.Fatalf("stale worker failure=%v", e)
	}
	report := Report{Radar: json.RawMessage(`{}`), Timeline: json.RawMessage(`[]`), Behavioral: json.RawMessage(`{}`)}
	if e = s.CompleteScoring(ctx, a.ID, job.Attempts, report, nil); !errors.Is(e, ErrSessionConflict) {
		t.Fatalf("stale worker commit=%v", e)
	}
	if e = s.CompleteScoring(ctx, a.ID, next.Attempts, report, nil); e != nil {
		t.Fatal(e)
	}
	if _, e = s.SessionCredential(ctx, a.ID); !errors.Is(e, ErrCredentialExpired) {
		t.Fatalf("completion retained key=%v", e)
	}
	if e = s.DeleteUser(ctx, u.ID); e != nil {
		t.Fatal(e)
	}
	var feedbackCount, usageCount int
	if e = s.Pool.QueryRow(ctx, `SELECT count(*) FROM feedback WHERE id=$1`, fid).Scan(&feedbackCount); e != nil {
		t.Fatal(e)
	}
	if e = s.Pool.QueryRow(ctx, `SELECT count(*) FROM interview_usage WHERE session_id=$1`, a.ID).Scan(&usageCount); e != nil {
		t.Fatal(e)
	}
	if feedbackCount != 0 || usageCount != 1 {
		t.Fatalf("account deletion feedback=%d usage=%d", feedbackCount, usageCount)
	}
}

func TestLegacyMigrationPreservesReportsAndTranscriptOrder(t *testing.T) {
	s := postgresRuntime(t)
	ctx := context.Background()
	u, e := s.CreateUser(ctx, "legacy@example.com", "unused")
	if e != nil {
		t.Fatal(e)
	}
	a, e := s.CreateSession(ctx, u.ID, "legacy-question", "conversational", "legacy", "", "", json.RawMessage(`{}`))
	if e != nil {
		t.Fatal(e)
	}
	if e = s.UpdateSessionStatus(ctx, a.ID, "complete"); e != nil {
		t.Fatal(e)
	}
	if e = s.SaveReport(ctx, a.ID, 3, json.RawMessage(`{"strengths":["legacy-strength"]}`), json.RawMessage(`[]`), json.RawMessage(`{}`), "legacy-coaching", true, ""); e != nil {
		t.Fatal(e)
	}
	for _, entry := range []struct{ text, when string }{{"third", "1 hour"}, {"first", "3 hours"}, {"second", "2 hours"}} {
		if _, e = s.Pool.Exec(ctx, `INSERT INTO transcript_turns(id,session_id,role,text,ts_ms,meta,created_at) VALUES($1,$2,'candidate',$3,0,'{}',now()-$4::interval)`, NewID(), a.ID, entry.text, entry.when); e != nil {
			t.Fatal(e)
		}
	}
	stale, e := s.CreateSession(ctx, u.ID, "legacy-question", "conversational", "legacy", "", "", json.RawMessage(`{}`))
	if e != nil {
		t.Fatal(e)
	}
	if _, e = s.Pool.Exec(ctx, `UPDATE sessions SET status='active',started_at=now()-interval '2 hours' WHERE id=$1`, stale.ID); e != nil {
		t.Fatal(e)
	}
	// Reproduce the legacy state immediately before the new sequence is installed.
	if _, e = s.Pool.Exec(ctx, `ALTER TABLE transcript_turns DROP COLUMN sequence CASCADE; DELETE FROM schema_migrations WHERE version='0007_sessions.sql'`); e != nil {
		t.Fatal(e)
	}
	if e = s.migrate(ctx); e != nil {
		t.Fatal(e)
	}
	turns, e := s.Transcript(ctx, a.ID)
	if e != nil || len(turns) != 3 || turns[0].Text != "first" || turns[1].Text != "second" || turns[2].Text != "third" {
		t.Fatalf("legacy order=%+v %v", turns, e)
	}
	rep, _, e := s.GetReport(ctx, a.ID)
	if e != nil || !rep.Scored || rep.Overall != 3 || rep.CoachingMD != "legacy-coaching" {
		t.Fatalf("legacy report changed: %+v %v", rep, e)
	}
	completed, e := s.GetSession(ctx, a.ID)
	if e != nil || completed.Status != "complete" {
		t.Fatalf("legacy complete=%+v %v", completed, e)
	}
	expired, e := s.GetSession(ctx, stale.ID)
	if e != nil || expired.Status != "expired" || expired.DeadlineAt == nil {
		t.Fatalf("legacy stale=%+v %v", expired, e)
	}
	if _, e = s.ClaimScoring(ctx); !errors.Is(e, ErrNotFound) {
		t.Fatalf("historical attempt was automatically charged/scored: %v", e)
	}
}

func TestTimedEndAcceptsFinalWorkspaceBeforeFrozenScoring(t *testing.T) {
	s := postgresRuntime(t)
	ctx := context.Background()
	u, e := s.CreateUser(ctx, "timed@example.com", "unused")
	if e != nil {
		t.Fatal(e)
	}
	a, e := s.ReserveSession(ctx, reserveFor(u.ID, "timed", "platform"))
	if e != nil {
		t.Fatal(e)
	}
	if e = s.BeginTimedFinish(ctx, a.ID); e != nil {
		t.Fatal(e)
	}
	if _, e = s.ClaimScoring(ctx); !errors.Is(e, ErrNotFound) {
		t.Fatalf("claimed before final flush grace=%v", e)
	}
	if _, e = s.SaveArtifact(ctx, a.ID, Workspace{Kind: "written", Content: "last edit", Revision: 1}); e != nil {
		t.Fatalf("final save rejected=%v", e)
	}
	if _, e = s.Pool.Exec(ctx, `UPDATE scoring_jobs SET not_before=now()-interval '1 second' WHERE session_id=$1`, a.ID); e != nil {
		t.Fatal(e)
	}
	if _, e = s.ClaimScoring(ctx); e != nil {
		t.Fatal(e)
	}
	if _, e = s.SaveArtifact(ctx, a.ID, Workspace{Kind: "written", Content: "too late", Revision: 2}); !errors.Is(e, ErrSessionConflict) {
		t.Fatalf("frozen scoring accepted later edit=%v", e)
	}
	w, e := s.GetArtifact(ctx, a.ID)
	if e != nil || w.Content != "last edit" {
		t.Fatalf("final work=%+v %v", w, e)
	}
}
