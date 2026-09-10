package feedback

import (
	"bytes"
	"encoding/json"
	"errors"
	"github.com/go-chi/chi/v5"
	"github.com/tejo/mockinterview-api/internal/auth"
	"github.com/tejo/mockinterview-api/internal/httpx"
	"github.com/tejo/mockinterview-api/internal/store"
	"io"
	"net/http"
	"strings"
	"unicode/utf8"
)

type surveyEnvelope struct {
	SessionStatus   string                   `json:"session_status"`
	FeedbackVersion string                   `json:"feedback_version"`
	Required        bool                     `json:"required"`
	Eligible        bool                     `json:"eligible"`
	ReportAvailable bool                     `json:"report_available"`
	Questionnaire   Questionnaire            `json:"questionnaire"`
	Response        *store.InterviewFeedback `json:"response"`
}

func (s *Service) ownedSurvey(w http.ResponseWriter, r *http.Request) (store.Session, bool) {
	a, e := s.store.GetSession(r.Context(), chi.URLParam(r, "id"))
	if e != nil || a.UserID != auth.UserID(r.Context()) {
		httpx.WriteProblem(w, 404, "Interview not found")
		return a, false
	}
	return a, true
}
func (s *Service) writeSurvey(w http.ResponseWriter, r *http.Request, a store.Session) {
	f, e := s.store.GetInterviewFeedback(r.Context(), a.UserID, a.ID)
	if e != nil {
		httpx.WriteProblem(w, 503, "Could not load interview feedback")
		return
	}
	_, _, e = s.store.GetReport(r.Context(), a.ID)
	available := e == nil
	if e != nil && !errors.Is(e, store.ErrNotFound) {
		httpx.WriteProblem(w, 503, "Could not check interview report availability")
		return
	}
	if f != nil {
		f.SessionID = ""
	}
	eligible := store.InterviewFeedbackEligible(a)
	httpx.WriteJSON(w, 200, surveyEnvelope{SessionStatus: a.Status, FeedbackVersion: a.FeedbackVersion, Required: eligible && f == nil, Eligible: eligible, ReportAvailable: available, Questionnaire: questionnaire(a), Response: f})
}
func (s *Service) GetInterview(w http.ResponseWriter, r *http.Request) {
	a, ok := s.ownedSurvey(w, r)
	if ok {
		s.writeSurvey(w, r, a)
	}
}
func (s *Service) PutInterview(w http.ResponseWriter, r *http.Request) {
	a, ok := s.ownedSurvey(w, r)
	if !ok {
		return
	}
	if !store.InterviewFeedbackEligible(a) {
		httpx.WriteProblem(w, 409, "Feedback is available after a started interview ends")
		return
	}
	var req struct {
		Version         string            `json:"version"`
		Answers         map[string]string `json:"answers"`
		Comment         string            `json:"comment"`
		ShareTranscript bool              `json:"share_transcript"`
		Comparison      json.RawMessage   `json:"comparison"`
	}
	if !httpx.DecodeJSON(w, r, &req) {
		return
	}
	if req.Version != a.FeedbackVersion {
		httpx.WriteJSON(w, 409, map[string]string{"code": "interview_feedback_version_required", "detail": "Reload the current interview feedback form before submitting."})
		return
	}
	if !utf8.ValidString(req.Comment) || utf8.RuneCountInString(req.Comment) > 2000 {
		httpx.WriteProblem(w, 400, "Optional comment must be at most 2000 characters")
		return
	}
	f := store.InterviewFeedback{SessionID: a.ID, UserID: a.UserID, Version: req.Version, Answers: req.Answers, Comment: redact(strings.TrimSpace(req.Comment)), ShareTranscript: req.ShareTranscript}
	f.ComparisonSet = len(req.Comparison) > 0
	if f.ComparisonSet && string(req.Comparison) != "null" {
		decoder := json.NewDecoder(bytes.NewReader(req.Comparison))
		decoder.DisallowUnknownFields()
		var comparison store.ToolComparison
		if !utf8.Valid(req.Comparison) || decoder.Decode(&comparison) != nil || decoder.Decode(new(any)) != io.EOF || store.ValidateToolComparison(&comparison) != nil {
			httpx.WriteProblem(w, 400, "Optional tool comparison must use valid text and the listed options, with tool names at most 300 characters and details at most 1000 characters")
			return
		}
		comparison.ToolNames = redact(strings.TrimSpace(comparison.ToolNames))
		comparison.Details = redact(strings.TrimSpace(comparison.Details))
		if store.ValidateToolComparison(&comparison) != nil {
			httpx.WriteProblem(w, 400, "Optional tool comparison exceeds the allowed text limits after credential redaction")
			return
		}
		f.Comparison = &comparison
	}
	if e := store.ValidateInterviewFeedback(f); e != nil {
		httpx.WriteProblem(w, 400, "Answer each of the six questions using one of its listed options")
		return
	}
	if _, e := s.store.PutInterviewFeedback(r.Context(), f); e != nil {
		if errors.Is(e, store.ErrInterviewFeedbackInvalid) {
			httpx.WriteProblem(w, 409, "Reload the interview feedback form")
		} else {
			httpx.WriteProblem(w, 503, "Could not save interview feedback")
		}
		return
	}
	s.writeSurvey(w, r, a)
}
func (s *Service) RequiredInterviews(w http.ResponseWriter, r *http.Request) {
	sessions, e := s.store.PendingInterviewFeedback(r.Context(), auth.UserID(r.Context()))
	if e != nil {
		httpx.WriteProblem(w, 503, "Could not load required interview feedback")
		return
	}
	type item struct {
		SessionID     string `json:"session_id"`
		QuestionTitle string `json:"question_title"`
		Status        string `json:"status"`
		Version       string `json:"version"`
		CreatedAt     string `json:"created_at"`
	}
	items := []item{}
	for _, a := range sessions {
		items = append(items, item{a.ID, surveyMetadata(a).Title, a.Status, a.FeedbackVersion, a.CreatedAt.UTC().Format("2006-01-02T15:04:05.999999999Z")})
	}
	httpx.WriteJSON(w, 200, map[string]any{"items": items, "total": len(items)})
}
