// Package profile serves the user's interviewer configuration (voice, face,
// personality, intensity) and the user profile. The catalogs of voices, faces,
// and personalities live in internal/persona — this package only validates
// against them and persists the user's choices.
package profile

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"sync"

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

	// previewCache memoises synthesized WAVs keyed by the full delivery combo
	// (voice+face+personality+intensity) so a given interviewer preview is sent
	// to Gemini at most once per warm instance — repeat plays are instant. The
	// combo space is small and bounded; we cap entries to keep memory flat.
	mu           sync.Mutex
	previewCache map[string][]byte
	previewOrder []string
}

const previewCacheMax = 96

func New(st Repo, geminiKey, ttsModel string) *Service {
	return &Service{store: st, geminiKey: geminiKey, ttsModel: ttsModel, previewCache: map[string][]byte{}}
}

func (s *Service) cachedPreview(key string) ([]byte, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	w, ok := s.previewCache[key]
	return w, ok
}

func (s *Service) storePreview(key string, wav []byte) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, exists := s.previewCache[key]; !exists {
		if len(s.previewOrder) >= previewCacheMax {
			oldest := s.previewOrder[0]
			s.previewOrder = s.previewOrder[1:]
			delete(s.previewCache, oldest)
		}
		s.previewOrder = append(s.previewOrder, key)
	}
	s.previewCache[key] = wav
}

// PreviewVoice returns a short WAV of the actual Gemini interviewer speaking a
// line whose WORDS and DELIVERY reflect the full config — voice (timbre), face
// (the person), personality (temperament) and intensity (pressure). Results are
// cached per-combo so previews are instant after the first synthesis. Falls back
// (503) if TTS is off (no key).
func (s *Service) PreviewVoice(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	voice := persona.NormalizeVoiceID(q.Get("voice"))
	face := persona.NormalizeFaceID(q.Get("face"))
	personality := persona.NormalizePersonalityID(q.Get("personality"))
	intensity := clampIntensity(q.Get("intensity"))

	key := voice + "|" + face + "|" + personality + "|" + strconv.Itoa(intensity)
	if wav, ok := s.cachedPreview(key); ok {
		writeWAV(w, wav)
		return
	}

	d := persona.PreviewDelivery(voice, face, personality, intensity)
	wav, err := tts.Synthesize(r.Context(), s.geminiKey, s.ttsModel, persona.GeminiVoiceName(voice), d.TTSPrompt())
	if err != nil {
		httpx.WriteProblem(w, http.StatusServiceUnavailable, "voice preview unavailable")
		return
	}
	s.storePreview(key, wav)
	writeWAV(w, wav)
}

func writeWAV(w http.ResponseWriter, wav []byte) {
	w.Header().Set("Content-Type", "audio/wav")
	w.Header().Set("Cache-Control", "public, max-age=86400")
	_, _ = w.Write(wav)
}

func clampIntensity(s string) int {
	n, err := strconv.Atoi(s)
	if err != nil || n < 1 {
		return 3
	}
	if n > 5 {
		return 5
	}
	return n
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
