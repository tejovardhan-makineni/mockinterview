package store

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
)

const InterviewFeedbackVersion = "post-interview-v1"
const ToolComparisonVersion = "tool-comparison-v1"

type ToolComparison struct {
	Version    string `json:"version"`
	PriorUse   string `json:"prior_use"`
	ToolNames  string `json:"tool_names"`
	Preference string `json:"preference"`
	Details    string `json:"details"`
}

func ValidateToolComparison(c *ToolComparison) error {
	if c == nil {
		return nil
	}
	if c.Version != ToolComparisonVersion || strings.ContainsRune(c.ToolNames, 0) || strings.ContainsRune(c.Details, 0) || !utf8.ValidString(c.ToolNames) || !utf8.ValidString(c.Details) || utf8.RuneCountInString(c.ToolNames) > 300 || utf8.RuneCountInString(c.Details) > 1000 {
		return ErrInterviewFeedbackInvalid
	}
	switch c.PriorUse {
	case "yes", "no", "prefer_not_to_say":
	default:
		return ErrInterviewFeedbackInvalid
	}
	switch c.Preference {
	case "", "mockinterview_better", "about_same", "other_tools_better", "unable_to_judge":
	default:
		return ErrInterviewFeedbackInvalid
	}
	if c.PriorUse != "yes" && (c.ToolNames != "" || c.Preference != "" || c.Details != "") {
		return ErrInterviewFeedbackInvalid
	}
	return nil
}

var ErrInterviewFeedbackRequired = errors.New("interview feedback required")
var ErrInterviewFeedbackInvalid = errors.New("invalid interview feedback")

var InterviewFeedbackQuestionIDs = []string{"usability_ease", "interviewer_realism", "subject_probe_quality", "challenge_fit", "report_actionability", "disruption_severity"}

type InterviewFeedback struct {
	SessionID       string            `json:"session_id,omitempty"`
	UserID          string            `json:"-"`
	Version         string            `json:"version"`
	Answers         map[string]string `json:"answers"`
	Comment         string            `json:"comment"`
	ShareTranscript bool              `json:"share_transcript"`
	Comparison      *ToolComparison   `json:"comparison"`
	// ComparisonSet is write-only presence: omission preserves, explicit nil clears.
	ComparisonSet bool      `json:"-"`
	SubmittedAt   time.Time `json:"submitted_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

type InterviewFeedbackRow struct {
	Session  Session
	Response *InterviewFeedback
}

type InterviewFeedbackStore interface {
	InterviewFeedbackComments(context.Context, int, *FeedbackCursor) ([]InterviewFeedbackRow, bool, error)
	PendingInterviewFeedback(context.Context, string) ([]Session, error)
	GetInterviewFeedback(context.Context, string, string) (*InterviewFeedback, error)
	PutInterviewFeedback(context.Context, InterviewFeedback) (InterviewFeedback, error)
	InterviewFeedbackWindow(context.Context, time.Time, time.Time) ([]InterviewFeedbackRow, error)
}

func InterviewFeedbackEligible(s Session) bool {
	if s.FeedbackVersion == "" || s.StartedAt == nil {
		return false
	}
	switch s.Status {
	case "scoring", "feedback_failed", "complete", "abandoned", "expired":
		return true
	}
	return false
}

func ValidateInterviewFeedback(f InterviewFeedback) error {
	if err := ValidateToolComparison(f.Comparison); err != nil {
		return err
	}
	if f.Version != InterviewFeedbackVersion || len(f.Answers) != len(InterviewFeedbackQuestionIDs) || !utf8.ValidString(f.Comment) || utf8.RuneCountInString(f.Comment) > 2000 {
		return ErrInterviewFeedbackInvalid
	}
	for _, id := range InterviewFeedbackQuestionIDs {
		v := f.Answers[id]
		if v >= "1" && v <= "5" && len(v) == 1 || v == "unable_to_judge" {
			continue
		}
		if id == "report_actionability" && (v == "report_not_read" || v == "report_unavailable") {
			continue
		}
		return ErrInterviewFeedbackInvalid
	}
	return nil
}

const feedbackEligibleSQL = `feedback_version<>'' AND started_at IS NOT NULL AND status IN ('scoring','feedback_failed','complete','abandoned','expired')`

func (s *Store) PendingInterviewFeedback(ctx context.Context, uid string) ([]Session, error) {
	rows, err := s.Pool.Query(ctx, sessionSelect+` WHERE user_id=$1 AND NOT `+testerEligibleSQL+` AND `+feedbackEligibleSQL+` AND NOT EXISTS(SELECT 1 FROM interview_feedback f WHERE f.session_id=sessions.id) ORDER BY created_at,id`, uid)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Session{}
	for rows.Next() {
		a, e := scanSession(rows)
		if e != nil {
			return nil, e
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

func scanInterviewFeedback(row pgx.Row) (InterviewFeedback, error) {
	var f InterviewFeedback
	err := row.Scan(&f.SessionID, &f.UserID, &f.Version, &f.Answers, &f.Comment, &f.ShareTranscript, &f.SubmittedAt, &f.UpdatedAt, &f.Comparison)
	return f, err
}

const interviewFeedbackSelect = `SELECT session_id,user_id,version,answers,comment,share_transcript,submitted_at,updated_at,comparison FROM interview_feedback`

func (s *Store) GetInterviewFeedback(ctx context.Context, uid, id string) (*InterviewFeedback, error) {
	var owner string
	if err := s.Pool.QueryRow(ctx, `SELECT user_id FROM sessions WHERE id=$1 AND user_id=$2`, id, uid).Scan(&owner); errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	} else if err != nil {
		return nil, err
	}
	f, e := scanInterviewFeedback(s.Pool.QueryRow(ctx, interviewFeedbackSelect+` WHERE session_id=$1 AND user_id=$2`, id, uid))
	if errors.Is(e, pgx.ErrNoRows) {
		return nil, nil
	}
	if e != nil {
		return nil, e
	}
	return &f, nil
}

func (s *Store) PutInterviewFeedback(ctx context.Context, f InterviewFeedback) (InterviewFeedback, error) {
	if !f.ComparisonSet {
		f.Comparison = nil
	}
	if e := ValidateInterviewFeedback(f); e != nil {
		return InterviewFeedback{}, e
	}
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return InterviewFeedback{}, e
	}
	defer tx.Rollback(ctx)
	a, e := scanSession(tx.QueryRow(ctx, sessionSelect+` WHERE id=$1 AND user_id=$2 FOR UPDATE`, f.SessionID, f.UserID))
	if e != nil {
		return InterviewFeedback{}, e
	}
	if !InterviewFeedbackEligible(a) || a.FeedbackVersion != f.Version {
		return InterviewFeedback{}, ErrInterviewFeedbackInvalid
	}
	answers, _ := json.Marshal(f.Answers)
	var comparison any
	if f.Comparison != nil {
		comparison, _ = json.Marshal(f.Comparison)
	}
	f, e = scanInterviewFeedback(tx.QueryRow(ctx, `INSERT INTO interview_feedback(session_id,user_id,version,answers,comment,share_transcript,comparison) VALUES($1,$2,$3,$4,$5,$6,CASE WHEN $8 THEN $7::jsonb ELSE NULL END)
 ON CONFLICT(session_id) DO UPDATE SET answers=EXCLUDED.answers,comment=EXCLUDED.comment,share_transcript=EXCLUDED.share_transcript,
 comparison=CASE WHEN $8 THEN EXCLUDED.comparison ELSE interview_feedback.comparison END,
 updated_at=CASE WHEN (interview_feedback.answers,interview_feedback.comment,interview_feedback.share_transcript,interview_feedback.comparison) IS DISTINCT FROM (EXCLUDED.answers,EXCLUDED.comment,EXCLUDED.share_transcript,CASE WHEN $8 THEN EXCLUDED.comparison ELSE interview_feedback.comparison END) THEN now() ELSE interview_feedback.updated_at END
 RETURNING session_id,user_id,version,answers,comment,share_transcript,submitted_at,updated_at,comparison`, f.SessionID, f.UserID, f.Version, answers, f.Comment, f.ShareTranscript, comparison, f.ComparisonSet))
	if e != nil {
		return InterviewFeedback{}, e
	}
	if e = tx.Commit(ctx); e != nil {
		return InterviewFeedback{}, e
	}
	return f, nil
}

// Reads every eligible started session in the fixed window, including missing
// responses. No recent-feedback limit or transcript/private reference is used.
func (s *Store) InterviewFeedbackWindow(ctx context.Context, from, to time.Time) ([]InterviewFeedbackRow, error) {
	rows, err := s.Pool.Query(ctx, `SELECT s.question_id,s.mode,s.provider,
 jsonb_build_object('target_level',s.config->>'target_level'),
 jsonb_build_object('title',s.question_snapshot->>'title','domain',s.question_snapshot->>'domain','format_id',s.question_snapshot->>'format_id'),
 CASE WHEN f.session_id IS NULL THEN NULL ELSE jsonb_build_object('version',f.version,'answers',f.answers,'comparison',CASE WHEN f.comparison IS NULL THEN NULL ELSE jsonb_build_object('version',f.comparison->>'version','prior_use',f.comparison->>'prior_use','preference',f.comparison->>'preference') END) END
 FROM sessions s LEFT JOIN interview_feedback f ON f.session_id=s.id
 WHERE s.started_at>=$1 AND s.started_at<$2 AND `+feedbackEligibleSQL+` ORDER BY s.started_at,s.id`, from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []InterviewFeedbackRow{}
	for rows.Next() {
		var row InterviewFeedbackRow
		var raw json.RawMessage
		if err = rows.Scan(&row.Session.QuestionID, &row.Session.Mode, &row.Session.Provider, &row.Session.Config, &row.Session.QuestionSnapshot, &raw); err != nil {
			return nil, err
		}
		if len(raw) > 0 && string(raw) != "null" {
			if err = json.Unmarshal(raw, &row.Response); err != nil {
				return nil, err
			}
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

// Survey comments expose a bounded qualitative-feedback page. The internal row
// contains only the same public frozen metadata as the aggregate reader.
type FeedbackCursor struct {
	UpdatedAt time.Time `json:"at"`
	SessionID string    `json:"id"`
}

func (s *Store) InterviewFeedbackComments(ctx context.Context, limit int, before *FeedbackCursor) ([]InterviewFeedbackRow, bool, error) {
	if limit < 1 || limit > 100 {
		return nil, false, ErrInterviewFeedbackInvalid
	}
	var at, id any
	if before != nil {
		at = before.UpdatedAt
		id = before.SessionID
	}
	rows, e := s.Pool.Query(ctx, `SELECT s.id,s.question_id,s.mode,s.provider,s.status,
 jsonb_build_object('title',s.question_snapshot->>'title','domain',s.question_snapshot->>'domain','format_id',s.question_snapshot->>'format_id'),
 f.version,f.comment,f.share_transcript,f.submitted_at,f.updated_at,f.comparison
 FROM interview_feedback f JOIN sessions s ON s.id=f.session_id
 WHERE (f.comment<>'' OR f.comparison IS NOT NULL) AND ($2::timestamptz IS NULL OR (f.updated_at,f.session_id)<($2,$3::uuid))
 ORDER BY f.updated_at DESC,f.session_id DESC LIMIT $1`, limit+1, at, id)
	if e != nil {
		return nil, false, e
	}
	defer rows.Close()
	out := []InterviewFeedbackRow{}
	for rows.Next() {
		r := InterviewFeedbackRow{Response: &InterviewFeedback{}}
		if e = rows.Scan(&r.Session.ID, &r.Session.QuestionID, &r.Session.Mode, &r.Session.Provider, &r.Session.Status, &r.Session.QuestionSnapshot, &r.Response.Version, &r.Response.Comment, &r.Response.ShareTranscript, &r.Response.SubmittedAt, &r.Response.UpdatedAt, &r.Response.Comparison); e != nil {
			return nil, false, e
		}
		out = append(out, r)
	}
	if e = rows.Err(); e != nil {
		return nil, false, e
	}
	more := len(out) > limit
	if more {
		out = out[:limit]
	}
	return out, more, nil
}
