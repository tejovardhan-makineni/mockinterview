package resume

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/tejo/mockinterview-api/internal/llm"
	"github.com/tejo/mockinterview-api/internal/store"
)

const privateMarker = "private-resume-provider-response-api-key-marker"

type failingResumeModel struct{ llm.Client }

func (*failingResumeModel) Generate(context.Context, llm.GenerateRequest) (string, error) {
	return "", errors.New(privateMarker)
}

type privateResumeRepo struct{ Repo }

func (privateResumeRepo) LatestResume(context.Context, string) (store.Resume, error) {
	return store.Resume{ID: "synthetic-resume", ParsedText: privateMarker}, nil
}

func TestResumeProviderFailuresDoNotLogPrivateContent(t *testing.T) {
	service := New(privateResumeRepo{}, &failingResumeModel{}, "test")
	for _, tc := range []struct {
		path    string
		handler http.HandlerFunc
	}{
		{"/resume", service.Upload},
		{"/resume/review", service.Review},
		{"/resume/match", service.Match},
	} {
		t.Run(tc.path, func(t *testing.T) {
			var body bytes.Buffer
			contentType := "application/json"
			if tc.path == "/resume" {
				form := multipart.NewWriter(&body)
				file, err := form.CreateFormFile("file", "synthetic-resume.txt")
				if err != nil {
					t.Fatal(err)
				}
				if _, err := file.Write([]byte(privateMarker)); err != nil {
					t.Fatal(err)
				}
				if err := form.Close(); err != nil {
					t.Fatal(err)
				}
				contentType = form.FormDataContentType()
			} else {
				body.WriteString(`{"job_description":"` + privateMarker + `"}`)
			}
			var logs bytes.Buffer
			previous := slog.Default()
			slog.SetDefault(slog.New(slog.NewJSONHandler(&logs, nil)))
			t.Cleanup(func() { slog.SetDefault(previous) })
			req := httptest.NewRequest("POST", tc.path, &body)
			req.Header.Set("Content-Type", contentType)
			response := httptest.NewRecorder()
			tc.handler(response, req)
			if response.Code != 502 {
				t.Fatalf("provider failure status=%d", response.Code)
			}
			var entry map[string]any
			if err := json.Unmarshal(logs.Bytes(), &entry); err != nil {
				t.Fatal(err)
			}
			if entry["category"] != "provider_request" || entry["route"] != tc.path || entry["err"] != nil || entry["user"] != nil {
				t.Fatalf("unexpected diagnostic fields: %v", entry)
			}
			if strings.Contains(logs.String(), privateMarker) || strings.Contains(response.Body.String(), privateMarker) {
				t.Fatal("provider or resume content escaped through diagnostics")
			}
		})
	}
}
