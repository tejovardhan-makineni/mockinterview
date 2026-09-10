package feedback

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"github.com/tejo/mockinterview-api/internal/auth"
	"github.com/tejo/mockinterview-api/internal/httpx"
	"github.com/tejo/mockinterview-api/internal/store"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"time"
)

var surveyCursorID = regexp.MustCompile(`^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$`)

type commentItem struct {
	SessionID       string                `json:"session_id"`
	Version         string                `json:"version"`
	QuestionTitle   string                `json:"question_title"`
	SubjectKey      string                `json:"subject_key"`
	SubjectLabel    string                `json:"subject_label"`
	Mode            string                `json:"mode"`
	Provider        string                `json:"provider"`
	Status          string                `json:"status"`
	Comment         string                `json:"comment"`
	ShareTranscript bool                  `json:"share_transcript"`
	Comparison      *store.ToolComparison `json:"comparison"`
	SubmittedAt     time.Time             `json:"submitted_at"`
	UpdatedAt       time.Time             `json:"updated_at"`
}

func (s *Service) InterviewComments(w http.ResponseWriter, r *http.Request) {
	u, e := s.store.UserByID(r.Context(), auth.UserID(r.Context()))
	if e != nil || u.Role != "admin" {
		httpx.WriteProblem(w, 403, "admins only")
		return
	}
	limit := 25
	if value := r.URL.Query().Get("limit"); value != "" {
		limit, e = strconv.Atoi(value)
		if e != nil || limit < 1 || limit > 100 {
			httpx.WriteProblem(w, 400, "limit must be an integer from 1 to 100")
			return
		}
	}
	var before *store.FeedbackCursor
	if token := r.URL.Query().Get("before"); token != "" {
		raw, e := base64.RawURLEncoding.DecodeString(token)
		if e != nil || len(raw) > 256 {
			httpx.WriteProblem(w, 400, "Invalid feedback cursor")
			return
		}
		d := json.NewDecoder(bytes.NewReader(raw))
		d.DisallowUnknownFields()
		var c store.FeedbackCursor
		if d.Decode(&c) != nil || d.Decode(new(any)) != io.EOF || c.UpdatedAt.IsZero() || !surveyCursorID.MatchString(c.SessionID) {
			httpx.WriteProblem(w, 400, "Invalid feedback cursor")
			return
		}
		before = &c
	}
	rows, more, e := s.store.InterviewFeedbackComments(r.Context(), limit, before)
	if e != nil {
		httpx.WriteProblem(w, 503, "Could not load interview comments")
		return
	}
	items := []commentItem{}
	var next *string
	for _, row := range rows {
		f := row.Response
		a := row.Session
		sub := surveySubject(a)
		items = append(items, commentItem{a.ID, f.Version, surveyMetadata(a).Title, sub.key, sub.label, a.Mode, a.Provider, a.Status, f.Comment, f.ShareTranscript, f.Comparison, f.SubmittedAt, f.UpdatedAt})
	}
	if more && len(rows) > 0 {
		last := rows[len(rows)-1]
		raw, _ := json.Marshal(store.FeedbackCursor{UpdatedAt: last.Response.UpdatedAt, SessionID: last.Session.ID})
		token := base64.RawURLEncoding.EncodeToString(raw)
		next = &token
	}
	httpx.WriteJSON(w, 200, map[string]any{"items": items, "next_cursor": next})
}
