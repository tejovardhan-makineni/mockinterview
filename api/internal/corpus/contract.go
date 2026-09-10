package corpus

import (
	"encoding/json"
	"fmt"
	"strings"
)

type Provenance struct {
	Authorship string   `json:"authorship"`
	License    string   `json:"license"`
	Sources    []string `json:"sources,omitempty"`
	Reviewer   string   `json:"reviewer,omitempty"`
	ReviewedAt string   `json:"reviewed_at,omitempty"`
}

type Drill struct {
	ID        string   `json:"id"`
	Title     string   `json:"title"`
	Prompt    string   `json:"prompt"`
	Minutes   int      `json:"minutes"`
	Checklist []string `json:"checklist"`
}

// SessionSettings come from validated session config, never from candidate text.
type SessionSettings struct {
	TargetLevel  string `json:"target_level"`
	Challenge    string `json:"challenge"`
	PracticeMode string `json:"practice_mode"`
	FaceID       string `json:"face_id"`
	Minutes      int    `json:"minutes"`
}

func ApplySessionConfig(q Question, config json.RawMessage) Question {
	var s SessionSettings
	_ = json.Unmarshal(config, &s)
	if !validDifficulty[s.TargetLevel] {
		s.TargetLevel = q.Difficulty
	}
	if s.Challenge != "foundation" && s.Challenge != "stretch" {
		s.Challenge = "standard"
	}
	if s.PracticeMode != "coaching" {
		s.PracticeMode = "simulation"
	}
	q.Settings = s
	return q
}

// Normalize adapts the legacy corpus without inventing provenance or review.
func Normalize(q Question) Question {
	if q.Revision == 0 {
		q.Revision = 1
	}
	if q.FormatID == "" {
		q.FormatID = strings.ReplaceAll(q.Domain, "_", "-")
	}
	if q.ReviewStatus == "" {
		q.ReviewStatus = "preview"
	}
	if q.Minutes == 0 {
		q.Minutes = 30
		if q.Domain == "medical_residency" {
			q.Minutes = 8
		}
	}
	return q
}

func validateReference(q Question, ref map[string]json.RawMessage) error {
	// Existing modalities have different structures; prevent empty, typo-only
	// reference objects while allowing domain-specific extensions.
	required := []string{"scenario", "model_points", "probes"}
	if q.Modality == "coding" {
		required = []string{"constraints", "examples", "test_cases", "approaches"}
	}
	if q.Modality == "system_design" {
		required = []string{"functional_requirements", "deep_dives", "followup_bank"}
	}
	for _, key := range required {
		if len(ref[key]) == 0 || string(ref[key]) == "null" {
			return fmt.Errorf("%s: reference.%s required for %s", q.ID, key, q.Modality)
		}
	}
	for _, key := range []string{"probes", "followup_bank", "facts"} {
		raw, ok := ref[key]
		if !ok {
			continue
		}
		var rows []map[string]any
		if json.Unmarshal(raw, &rows) != nil {
			return fmt.Errorf("%s: reference.%s must be object array", q.ID, key)
		}
		for _, row := range rows {
			if key == "facts" {
				id, _ := row["id"].(string)
				reveal, _ := row["reveal_when"].(string)
				if !idRe.MatchString(id) || row["value"] == nil || strings.TrimSpace(reveal) == "" {
					return fmt.Errorf("%s: facts need id, value, reveal_when", q.ID)
				}
			} else {
				question, _ := row["question"].(string)
				trigger, _ := row["trigger"].(string)
				if strings.TrimSpace(question) == "" || strings.TrimSpace(trigger) == "" {
					return fmt.Errorf("%s: %s needs trigger and question", q.ID, key)
				}
			}
		}
	}
	ids := map[string]bool{}
	for _, d := range q.LearningDrills {
		if !idRe.MatchString(d.ID) || ids[d.ID] || d.Minutes < 1 || d.Minutes > 20 || strings.TrimSpace(d.Title) == "" || strings.TrimSpace(d.Prompt) == "" || len(d.Checklist) == 0 {
			return fmt.Errorf("%s: invalid learning drill", q.ID)
		}
		ids[d.ID] = true
	}
	return nil
}
