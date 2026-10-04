package store

import (
	"context"
	"encoding/json"
	"testing"
)

func TestPostgresFeedbackCaptureAndReview(t *testing.T) {
	s := postgresRuntime(t)
	ctx := context.Background()
	user, err := s.CreateUser(ctx, "feedback-capture@example.test", "unused")
	if err != nil {
		t.Fatal(err)
	}
	wantContext := map[string]any{
		"include_diagnostics": true, "share_transcript": false,
		"page": "/history", "browser": "Synthetic browser", "viewport": "1280x800",
		"language": "en-US", "timezone": "America/Los_Angeles", "online": "online",
		"tags": []string{"source:header"},
	}
	raw, err := json.Marshal(wantContext)
	if err != nil {
		t.Fatal(err)
	}
	id, err := s.SaveFeedback(ctx, user.ID, "product", "The history filters need improvement 語😀", 3, raw)
	if err != nil || id == "" {
		t.Fatal("feedback was not saved", err)
	}
	assertReadback := func(status string) {
		t.Helper()
		items, err := s.ListFeedback(ctx, 20)
		if err != nil || len(items) != 1 {
			t.Fatal("saved feedback was not available to review", err)
		}
		item := items[0]
		if item.ID != id || item.UserID != user.ID || item.Email != user.Email || item.Kind != "product" || item.Rating != 3 || item.Message != "The history filters need improvement 語😀" || item.Status != status || item.CreatedAt == "" {
			t.Fatalf("feedback fields were not preserved: %+v", item)
		}
		var captured map[string]json.RawMessage
		if err := json.Unmarshal(item.Context, &captured); err != nil || len(captured) != len(wantContext) {
			t.Fatal("diagnostic context was not preserved", err, string(item.Context))
		}
		for key, value := range wantContext {
			want, _ := json.Marshal(value)
			if string(captured[key]) != string(want) {
				t.Fatalf("context %s=%s, want %s", key, captured[key], want)
			}
		}
	}
	assertReadback("new")
	if err := s.UpdateFeedbackStatus(ctx, id, "reviewed"); err != nil {
		t.Fatal(err)
	}
	assertReadback("reviewed")
}
