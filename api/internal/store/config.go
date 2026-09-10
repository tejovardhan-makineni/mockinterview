package store

import (
	"context"
	"errors"
	"github.com/jackc/pgx/v5"

	"github.com/tejo/mockinterview-api/internal/persona"
)

type InterviewConfig struct {
	VoiceID     string `json:"voice_id"`
	FaceID      string `json:"face_id"`
	Personality string `json:"personality"`
	Intensity   int    `json:"intensity"`
	// Language is the interview language (the interviewer speaks/writes in it). It
	// rides along in the per-session config JSON (read by the live relay); it is
	// NOT a column on interview_configs, so the saved user default doesn't persist
	// it — the client sets it per interview from the app-wide language selection.
	Language string `json:"language,omitempty"`
}

// DefaultConfig derives the new-user defaults from the persona catalogs (their
// first entry) rather than hardcoding ids, so reordering/renaming a catalog can
// never leave the default pointing at a stale id.
func DefaultConfig() InterviewConfig {
	return InterviewConfig{
		VoiceID:     persona.DefaultVoiceID(),
		FaceID:      persona.DefaultFaceID(),
		Personality: persona.DefaultPersonalityID(),
		Intensity:   3,
	}
}

func (s *Store) GetConfig(ctx context.Context, userID string) (InterviewConfig, error) {
	c := DefaultConfig()
	err := s.Pool.QueryRow(ctx,
		`SELECT voice_id, face_id, personality, intensity FROM interview_configs WHERE user_id=$1`, userID).
		Scan(&c.VoiceID, &c.FaceID, &c.Personality, &c.Intensity)
	if errors.Is(err, pgx.ErrNoRows) {
		// No row yet → return defaults (not an error).
		return DefaultConfig(), nil
	}
	if err != nil {
		return InterviewConfig{}, err
	}
	c.VoiceID = persona.NormalizeVoiceID(c.VoiceID)
	c.FaceID = persona.NormalizeFaceID(c.FaceID)
	c.Personality = persona.NormalizePersonalityID(c.Personality)
	return c, nil
}

func (s *Store) SaveConfig(ctx context.Context, userID string, c InterviewConfig) error {
	_, err := s.Pool.Exec(ctx,
		`INSERT INTO interview_configs (user_id, voice_id, face_id, personality, intensity, updated_at)
		 VALUES ($1,$2,$3,$4,$5, now())
		 ON CONFLICT (user_id) DO UPDATE SET
		   voice_id=EXCLUDED.voice_id, face_id=EXCLUDED.face_id,
		   personality=EXCLUDED.personality, intensity=EXCLUDED.intensity, updated_at=now()`,
		userID, c.VoiceID, c.FaceID, c.Personality, c.Intensity)
	return err
}
