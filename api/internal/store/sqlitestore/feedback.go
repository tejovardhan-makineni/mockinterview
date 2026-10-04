package sqlitestore

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"github.com/tejo/mockinterview-api/internal/store"
	"reflect"
	"sort"
	"time"
)

func (s *Store) PendingInterviewFeedback(ctx context.Context, uid string) (out []store.Session, err error) {
	out = []store.Session{}
	err = s.write(ctx, func(tx *sql.Tx) error {
		tester, e := isTester(ctx, tx, uid)
		if e != nil || tester {
			return e
		}
		docs, e := readSessions(ctx, tx, `WHERE user_id=? AND NOT EXISTS(SELECT 1 FROM interview_feedback f WHERE f.session_id=sessions.id) ORDER BY created_at,id`, uid)
		if e != nil {
			return e
		}
		for _, d := range docs {
			if store.InterviewFeedbackEligible(d.Session) {
				out = append(out, d.Session)
			}
		}
		return nil
	})
	return
}
func (s *Store) GetInterviewFeedback(ctx context.Context, uid, id string) (f *store.InterviewFeedback, err error) {
	err = s.write(ctx, func(tx *sql.Tx) error {
		a, e := readSession(ctx, tx, id)
		if e != nil {
			return e
		}
		if a.Session.UserID != uid {
			return store.ErrNotFound
		}
		value, e := readJSON[store.InterviewFeedback](ctx, tx, `SELECT data FROM interview_feedback WHERE session_id=?`, id)
		if errors.Is(e, store.ErrNotFound) {
			return nil
		}
		if e != nil {
			return e
		}
		value.UserID = uid
		f = &value
		return nil
	})
	return
}
func (s *Store) PutInterviewFeedback(ctx context.Context, f store.InterviewFeedback) (out store.InterviewFeedback, err error) {
	err = s.write(ctx, func(tx *sql.Tx) error {
		a, e := readSession(ctx, tx, f.SessionID)
		if e != nil {
			return e
		}
		if a.Session.UserID != f.UserID {
			return store.ErrNotFound
		}
		if !store.InterviewFeedbackEligible(a.Session) || a.Session.FeedbackVersion != f.Version {
			return store.ErrInterviewFeedbackInvalid
		}
		old, e := readJSON[store.InterviewFeedback](ctx, tx, `SELECT data FROM interview_feedback WHERE session_id=?`, f.SessionID)
		if e != nil && !errors.Is(e, store.ErrNotFound) {
			return e
		}
		exists := e == nil
		if !f.ComparisonSet {
			f.Comparison = old.Comparison
		}
		if e = store.ValidateInterviewFeedback(f); e != nil {
			return e
		}
		f.ComparisonSet = false
		now := time.Now().UTC()
		f.SubmittedAt = now
		f.UpdatedAt = now
		if exists {
			f.SubmittedAt = old.SubmittedAt
			f.UpdatedAt = old.UpdatedAt
			if f.Comment != old.Comment || f.ShareTranscript != old.ShareTranscript || !reflect.DeepEqual(f.Answers, old.Answers) || !reflect.DeepEqual(f.Comparison, old.Comparison) {
				f.UpdatedAt = now
			}
		}
		out = f
		return execJSON(ctx, tx, `INSERT INTO interview_feedback(session_id,user_id,data) VALUES(?,?,?) ON CONFLICT(session_id) DO UPDATE SET data=excluded.data`, f, f.SessionID, f.UserID)
	})
	return
}

// Feedback readers mirror the hosted privacy boundary: public frozen metadata
// only, with no answers, résumé, quota identity or question scoring rubric.
func feedbackMetadata(a store.Session) store.Session {
	var cfg struct {
		TargetLevel string `json:"target_level"`
	}
	_ = json.Unmarshal(a.Config, &cfg)
	config, _ := json.Marshal(cfg)
	var question struct {
		Title    string `json:"title"`
		Domain   string `json:"domain"`
		FormatID string `json:"format_id"`
	}
	_ = json.Unmarshal(a.QuestionSnapshot, &question)
	snapshot, _ := json.Marshal(question)
	return store.Session{ID: a.ID, QuestionID: a.QuestionID, Status: a.Status, Mode: a.Mode, Provider: a.Provider, Config: config, QuestionSnapshot: snapshot}
}
func (s *Store) InterviewFeedbackWindow(ctx context.Context, from, to time.Time) (out []store.InterviewFeedbackRow, err error) {
	out = []store.InterviewFeedbackRow{}
	err = s.write(ctx, func(tx *sql.Tx) error {
		docs, e := readSessions(ctx, tx, `ORDER BY created_at,id`)
		if e != nil {
			return e
		}
		for _, d := range docs {
			a := d.Session
			if !store.InterviewFeedbackEligible(a) || a.StartedAt.Before(from) || !a.StartedAt.Before(to) {
				continue
			}
			r := store.InterviewFeedbackRow{Session: feedbackMetadata(a)}
			f, e := readJSON[store.InterviewFeedback](ctx, tx, `SELECT data FROM interview_feedback WHERE session_id=?`, a.ID)
			if e != nil && !errors.Is(e, store.ErrNotFound) {
				return e
			}
			if e == nil {
				f.Comment = ""
				f.SessionID = ""
				f.UserID = ""
				f.ShareTranscript = false
				if f.Comparison != nil {
					f.Comparison.ToolNames = ""
					f.Comparison.Details = ""
				}
				r.Response = &f
			}
			out = append(out, r)
		}
		return nil
	})
	return
}
func (s *Store) InterviewFeedbackComments(ctx context.Context, limit int, before *store.FeedbackCursor) (out []store.InterviewFeedbackRow, more bool, err error) {
	if limit < 1 || limit > 100 {
		return nil, false, store.ErrInterviewFeedbackInvalid
	}
	out = []store.InterviewFeedbackRow{}
	err = s.write(ctx, func(tx *sql.Tx) error {
		responses, e := listJSON[store.InterviewFeedback](ctx, tx, `SELECT data FROM interview_feedback`)
		if e != nil {
			return e
		}
		for _, f := range responses {
			if f.Comment == "" && f.Comparison == nil {
				continue
			}
			if before != nil && (f.UpdatedAt.After(before.UpdatedAt) || f.UpdatedAt.Equal(before.UpdatedAt) && f.SessionID >= before.SessionID) {
				continue
			}
			d, e := readSession(ctx, tx, f.SessionID)
			if e != nil {
				return e
			}
			f.Answers = nil
			f.UserID = ""
			out = append(out, store.InterviewFeedbackRow{Session: feedbackMetadata(d.Session), Response: &f})
		}
		return nil
	})
	if err != nil {
		return
	}
	sort.Slice(out, func(i, j int) bool {
		a, b := out[i].Response, out[j].Response
		if a.UpdatedAt.Equal(b.UpdatedAt) {
			return a.SessionID > b.SessionID
		}
		return a.UpdatedAt.After(b.UpdatedAt)
	})
	more = len(out) > limit
	if more {
		out = out[:limit]
	}
	return
}
