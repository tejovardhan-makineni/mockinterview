// Package profile serves the user's interviewer configuration (voice, face,
// personality, intensity) and the user profile. The catalogs of voices, faces,
// and personalities live in internal/persona — this package only validates
// against them and persists the user's choices.
package profile

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/tejo/mockinterview-api/internal/auth"
	"github.com/tejo/mockinterview-api/internal/httpx"
	"github.com/tejo/mockinterview-api/internal/persona"
	"github.com/tejo/mockinterview-api/internal/store"
	"github.com/tejo/mockinterview-api/internal/tts"
)

// Repo is the persistence this package needs. *store.Store satisfies it; tests
// supply a fake. Declaring the interface here (consumer side) keeps profile
// decoupled from the concrete data layer.
type Repo interface {
	GetConfig(ctx context.Context, userID string) (store.InterviewConfig, error)
	SaveConfig(ctx context.Context, userID string, c store.InterviewConfig) error
	GetSettings(ctx context.Context, userID string) (json.RawMessage, error)
	SaveSettings(ctx context.Context, userID string, settings json.RawMessage) error
	DeleteUser(ctx context.Context, userID string) error
}

type Service struct {
	store     Repo
	geminiKey string
	ttsModel  string
}

func New(st Repo, geminiKey, ttsModel string) *Service {
	return &Service{store: st, geminiKey: geminiKey, ttsModel: ttsModel}
}

// PreviewVoice returns a short WAV sample of the actual Gemini voice so users
// hear the real interviewer voice when choosing. Falls back (503) if TTS is off.
func (s *Service) PreviewVoice(w http.ResponseWriter, r *http.Request) {
	name := persona.GeminiVoiceName(r.URL.Query().Get("voice"))
	text := "Hi, I'm your interviewer. Let's start — tell me a bit about yourself and a project you're proud of."
	wav, err := tts.Synthesize(r.Context(), s.geminiKey, s.ttsModel, name, text)
	if err != nil {
		httpx.WriteProblem(w, http.StatusServiceUnavailable, "voice preview unavailable")
		return
	}
	w.Header().Set("Content-Type", "audio/wav")
	w.Header().Set("Cache-Control", "public, max-age=86400")
	_, _ = w.Write(wav)
}

func (s *Service) ListVoices(w http.ResponseWriter, _ *http.Request) {
	httpx.WriteJSON(w, http.StatusOK, persona.Voices)
}
func (s *Service) ListFaces(w http.ResponseWriter, _ *http.Request) {
	httpx.WriteJSON(w, http.StatusOK, persona.Faces)
}
func (s *Service) ListPersonalities(w http.ResponseWriter, _ *http.Request) {
	httpx.WriteJSON(w, http.StatusOK, persona.Personalities)
}

func (s *Service) Get(w http.ResponseWriter, r *http.Request) {
	c, _ := s.store.GetConfig(r.Context(), auth.UserID(r.Context()))
	httpx.WriteJSON(w, http.StatusOK, c)
}

// GetProfile returns the user's profile (DOB, gender, occupation, domain, status…).
func (s *Service) GetProfile(w http.ResponseWriter, r *http.Request) {
	raw, _ := s.store.GetSettings(r.Context(), auth.UserID(r.Context()))
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write(raw)
}

// SaveProfile stores the profile JSON as-is (free-form, validated client-side).
func (s *Service) SaveProfile(w http.ResponseWriter, r *http.Request) {
	var body map[string]any
	if !httpx.DecodeJSON(w, r, &body) {
		return
	}
	raw, _ := json.Marshal(body)
	if err := s.store.SaveSettings(r.Context(), auth.UserID(r.Context()), raw); err != nil {
		httpx.WriteProblem(w, http.StatusInternalServerError, "save failed")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, body)
}

// DeleteAccount permanently deletes the user and (via ON DELETE CASCADE) all of
// their data: resumes, sessions, transcripts, behavior, scores, reports.
func (s *Service) DeleteAccount(w http.ResponseWriter, r *http.Request) {
	if err := s.store.DeleteUser(r.Context(), auth.UserID(r.Context())); err != nil {
		httpx.WriteProblem(w, http.StatusInternalServerError, "delete failed")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// Save validates an interviewer configuration against the persona catalogs and
// persists it.
func (s *Service) Save(w http.ResponseWriter, r *http.Request) {
	var c store.InterviewConfig
	if !httpx.DecodeJSON(w, r, &c) {
		return
	}
	if !persona.ValidVoice(c.VoiceID) || !persona.ValidFace(c.FaceID) ||
		!persona.ValidPersonality(c.Personality) || c.Intensity < 1 || c.Intensity > 5 {
		httpx.WriteProblem(w, http.StatusBadRequest, "invalid config: check voice, face, personality, and intensity (1-5)")
		return
	}
	if err := s.store.SaveConfig(r.Context(), auth.UserID(r.Context()), c); err != nil {
		httpx.WriteProblem(w, http.StatusInternalServerError, "save failed")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, c)
}
