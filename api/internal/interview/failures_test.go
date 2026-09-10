package interview

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"testing"

	"github.com/tejo/mockinterview-api/internal/corpus"
	"github.com/tejo/mockinterview-api/internal/llm"
	"github.com/tejo/mockinterview-api/internal/scoring"
	"github.com/tejo/mockinterview-api/internal/store"
)

type failureModel struct {
	response string
	err      error
	calls    int
}

func (m *failureModel) Generate(context.Context, llm.GenerateRequest) (string, error) {
	m.calls++
	return m.response, m.err
}
func (*failureModel) Stubbed() bool  { return false }
func (*failureModel) Info() llm.Info { return llm.Info{Provider: "test"} }

type failureRepo struct {
	Repo
	session     store.Session
	getError    error
	savedError  string
	failAttempt int
}

func (r *failureRepo) GetSession(context.Context, string) (store.Session, error) {
	return r.session, r.getError
}
func (r *failureRepo) FailScoring(_ context.Context, _ string, attempt int, message string) error {
	r.savedError, r.failAttempt = message, attempt
	return nil
}

func TestScoringFailureDiagnosticsRemainPrivateAndPreserveRetryPolicy(t *testing.T) {
	const secret = "private-answer-provider-body-key-marker"
	q := corpus.Question{ID: "q", Rubric: []corpus.RubricDim{{Key: "scope", Weight: 1}}}
	question, err := json.Marshal(q)
	if err != nil {
		t.Fatal(err)
	}
	tests := []struct {
		name, response, workspace, category, message string
		providerError, storeError                    error
		calls                                        int
	}{
		{name: "provider", providerError: errors.New(secret), category: "provider_request", calls: 1,
			message: "The feedback provider could not complete the request. Your interview is saved; check your provider settings and retry feedback."},
		{name: "malformed", response: secret, category: "assessment_invalid", calls: 1,
			message: "The feedback response could not be verified against your saved interview. Retry feedback."},
		{name: "unsupported quote", response: `{"scores":[{"dimension":"scope","score":3,"assessed":true,"evidence_refs":[{"source_id":"answer","quote":"invented quote"}]}]}`, category: "assessment_invalid", calls: 1,
			message: "The feedback response could not be verified against your saved interview. Retry feedback."},
		{name: "untrusted dimension cannot request retry", response: `{"scores":[{"dimension":"503 timeout ` + secret + `","score":3}]}`, category: "assessment_invalid", calls: 1,
			message: "The feedback response could not be verified against your saved interview. Retry feedback."},
		{name: "evidence limit", workspace: strings.Repeat(secret, 30000), category: "evidence_limit", calls: 0,
			message: "Your saved interview exceeds the supported feedback size. Your transcript and workspace remain available."},
		{name: "timeout", providerError: fmt.Errorf("%s: %w", secret, context.DeadlineExceeded), category: "timeout", calls: 2,
			message: "Feedback took too long to complete. Your interview is saved; retry feedback."},
		{name: "operation", storeError: errors.New(secret), category: "operation", calls: 0,
			message: "Feedback could not be completed. Your interview is saved; retry feedback."},
		{name: "existing transient provider retry", providerError: errors.New("503 " + secret), category: "provider_request", calls: 2,
			message: "The feedback provider could not complete the request. Your interview is saved; check your provider settings and retry feedback."},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			model := &failureModel{response: tt.response, err: tt.providerError}
			repo := &failureRepo{session: store.Session{ID: "synthetic-session", Funding: "platform", QuestionSnapshot: question}, getError: tt.storeError}
			service := New(repo, nil, scoring.New(model, "test"), nil, 0)
			input := &store.ScoringInput{Question: question, Turns: []store.Turn{{ID: "answer", Role: "candidate", Text: strings.Repeat(secret, 3)}}, Workspace: tt.workspace}
			var logs bytes.Buffer
			previous := slog.Default()
			slog.SetDefault(slog.New(slog.NewJSONHandler(&logs, nil)))
			t.Cleanup(func() { slog.SetDefault(previous) })
			service.process(context.Background(), store.ScoringJob{SessionID: "synthetic-session", Attempts: 2, Input: input})
			if repo.savedError != tt.message || repo.failAttempt != 2 || model.calls != tt.calls {
				t.Fatalf("unexpected failure handling: message=%q attempt=%d calls=%d", repo.savedError, repo.failAttempt, model.calls)
			}
			var logged map[string]any
			if err := json.Unmarshal(logs.Bytes(), &logged); err != nil {
				t.Fatal(err)
			}
			if logged["msg"] != "scoring attempt failed" || logged["category"] != tt.category || logged["attempt"] != float64(2) {
				t.Fatalf("unexpected diagnostic: %v", logged)
			}
			for _, output := range []string{logs.String(), repo.savedError, processingMessage("feedback_failed")} {
				if strings.Contains(output, secret) || strings.Contains(output, "invented quote") {
					t.Fatal("private error or assessment content escaped")
				}
			}
		})
	}
}
