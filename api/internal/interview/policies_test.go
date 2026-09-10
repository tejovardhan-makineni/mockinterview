package interview

import (
	"context"
	"encoding/json"
	"errors"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/tejo/mockinterview-api/internal/auth"
	"github.com/tejo/mockinterview-api/internal/corpus"
	"github.com/tejo/mockinterview-api/internal/scoring"
	"github.com/tejo/mockinterview-api/internal/store"
)

type policyScoreRepo struct {
	*failureRepo
	user store.User
}

func (r *policyScoreRepo) UserByID(context.Context, string) (store.User, error) { return r.user, nil }

func TestQueuedScoringRejectsUnacknowledgedLegacyButHonorsPriorDocumentVersions(t *testing.T) {
	question, err := json.Marshal(corpus.Question{ID: "q", Rubric: []corpus.RubricDim{{Key: "scope", Weight: 1}}})
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	for _, tc := range []struct {
		name   string
		user   store.User
		hosted bool
		calls  int
	}{
		{name: "legacy without assertion", hosted: true, user: store.User{EmailVerified: true}},
		{name: "unverified with assertion", hosted: true, user: store.User{AdultConfirmedAt: &now, PoliciesAcceptedAt: &now, TermsVersion: auth.TermsVersion, PrivacyVersion: auth.PrivacyVersion}},
		{name: "acknowledged before document update", hosted: true, user: store.User{EmailVerified: true, AdultConfirmedAt: &now, PoliciesAcceptedAt: &now, TermsVersion: "prior-published-terms", PrivacyVersion: "prior-published-privacy"}, calls: 1},
		{name: "current acknowledgment", hosted: true, user: store.User{EmailVerified: true, AdultConfirmedAt: &now, PoliciesAcceptedAt: &now, TermsVersion: auth.TermsVersion, PrivacyVersion: auth.PrivacyVersion}, calls: 1},
		{name: "local demo remains available", hosted: false, calls: 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			model := &failureModel{err: errors.New("synthetic provider boundary reached")}
			repo := &policyScoreRepo{failureRepo: &failureRepo{session: store.Session{ID: "test", UserID: "test-user", QuestionSnapshot: question}}, user: tc.user}
			service := New(repo, nil, scoring.New(model, "test"), nil, 0)
			service.SetOptions(Options{Hosted: tc.hosted})
			input := &store.ScoringInput{Question: question, Turns: []store.Turn{{ID: "answer", Role: "candidate", Text: "A synthetic example with an explicit decision and result."}}}
			if err := service.scoreJob(context.Background(), store.ScoringJob{SessionID: "test", Attempts: 1, Input: input}); err == nil {
				t.Fatal("synthetic failing model unexpectedly succeeded")
			}
			if model.calls != tc.calls {
				t.Fatalf("provider calls=%d want=%d", model.calls, tc.calls)
			}
		})
	}
}

func TestRetiredBehaviorCollectionDoesNotReadBodyOrTouchStore(t *testing.T) {
	service := &Service{}
	request := httptest.NewRequest("POST", "/sessions/test/behavior", nil)
	request.Body = unreadBehaviorBody{t}
	out := httptest.NewRecorder()
	service.Ingest(out, request)
	if out.Code != 410 {
		t.Fatalf("retired behavior status=%d", out.Code)
	}
}

type unreadBehaviorBody struct{ t *testing.T }

func (r unreadBehaviorBody) Read([]byte) (int, error) {
	r.t.Fatal("retired collection read private request body")
	return 0, errors.New("unexpected read")
}
func (unreadBehaviorBody) Close() error { return nil }
