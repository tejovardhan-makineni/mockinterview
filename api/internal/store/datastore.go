package store

import (
	"context"
	"encoding/json"
)

// Datastore is the complete persistence contract the application wires into its
// handlers. *Store (Postgres) is the production implementation; memstore.Mem is
// the in-memory test implementation. Handlers depend on the narrower,
// consumer-defined interfaces in each feature package — this union exists so the
// composition root (cmd/mockinterview) can hold one value and pass it to all of
// them, and so both implementations are checked against a single contract.
//
// It lists ONLY the methods the running application consumes. *Store exposes a
// few more (canvas snapshots, per-phase updates) that are latent capabilities
// not yet wired into a handler; keeping them off this contract keeps it honest.
type Datastore interface {
	AccountStore
	PolicyStore
	SessionRuntime
	InterviewFeedbackStore
	// users
	CreateUser(ctx context.Context, email, passwordHash string) (User, error)
	UserByEmail(ctx context.Context, email string) (User, error)
	UserByID(ctx context.Context, id string) (User, error)
	GetSettings(ctx context.Context, userID string) (json.RawMessage, error)
	SaveSettings(ctx context.Context, userID string, settings json.RawMessage) error
	DeleteUser(ctx context.Context, userID string) error
	// config
	GetConfig(ctx context.Context, userID string) (InterviewConfig, error)
	SaveConfig(ctx context.Context, userID string, c InterviewConfig) error
	// resumes
	// feedback
	SaveFeedback(ctx context.Context, userID, kind, message string, rating int, contextJSON json.RawMessage) (string, error)
	ListFeedback(ctx context.Context, limit int) ([]Feedback, error)
	UpdateFeedbackStatus(context.Context, string, string) error
	// resume
	SaveResume(ctx context.Context, userID, filename, parsedText string, parsedJSON json.RawMessage) (Resume, error)
	LatestResume(ctx context.Context, userID string) (Resume, error)
	DeleteResumes(ctx context.Context, userID string) error
	SaveResumeReview(ctx context.Context, userID, resumeID, provider, model string, result json.RawMessage) (string, error)
	// sessions
	CreateSession(ctx context.Context, userID, questionID, modality, track, packID, roundID string, cfg json.RawMessage) (Session, error)
	CountSessionsToday(ctx context.Context, userID string) (int, error)
	ListUserSessions(ctx context.Context, userID string, limit int) ([]SessionSummary, error)
	SessionsForPack(ctx context.Context, userID, packID string) ([]SessionSummary, error)
	GetSession(ctx context.Context, id string) (Session, error)
	UpdateSessionStatus(ctx context.Context, id, status string) error
	AddTurn(ctx context.Context, sessionID, role, text string, tsMs int64, meta json.RawMessage) error
	Transcript(ctx context.Context, sessionID string) ([]Turn, error)
	AddWorkspaceSnapshot(ctx context.Context, sessionID string, tsMs int64, kind, content string) error
	LatestWorkspace(ctx context.Context, sessionID string) (string, error)
	// behavior
	AddBehaviorSample(ctx context.Context, sessionID string, tsMs int64, gaze, headPose, expression, posture, lighting, vad, framing json.RawMessage) error
	AddEvent(ctx context.Context, sessionID string, tsMs int64, kind string, data json.RawMessage) error
	BehavioralSummary(ctx context.Context, sessionID string) (json.RawMessage, error)
	// reports
	SaveScores(ctx context.Context, sessionID string, rows []ScoreRow) error
	SaveReport(ctx context.Context, sessionID string, overall float64, radar, timeline, behavioral json.RawMessage, coachingMD string, scored bool, note string) error
	GetReport(ctx context.Context, sessionID string) (Report, []ScoreRow, error)
}

// Compile-time proof the production store implements the full contract.
var _ Datastore = (*Store)(nil)
