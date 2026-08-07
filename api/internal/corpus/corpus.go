// Package corpus loads and serves the interview question bank. Questions cover
// multiple tracks (engineering, professional) and modalities (system_design,
// coding, written, conversational). The rubric is carried per-question so
// scoring is corpus-driven, not hardcoded.
//
// The full Question (including Reference "ideal answer" material and Rubric) is
// available server-side to the director + scorer. Clients only ever see the
// trimmed Summary — the reference answers never leave the server.
package corpus

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

// Modalities and tracks.
var validModalities = map[string]bool{
	"system_design": true, "coding": true, "written": true, "conversational": true,
}
var validDifficulty = map[string]bool{
	"junior": true, "mid": true, "senior": true, "staff": true, "entry": true,
}

// validAreas are the professions a question can belong to. Areas are SHARED: one
// question may list several (e.g. a behavioral interview is valid for every
// area; an ml_system_design interview counts for engineering AND data_science).
// The client derives the Area->Domain catalog navigation from these.
var validAreas = map[string]bool{
	// Engineering is split by discipline so each has its own Area->Domain track:
	// software (the original corpus), plus mechanical, electrical, and civil.
	"software_engineering": true, "mechanical_engineering": true,
	"electrical_engineering": true, "civil_engineering": true,
	"data_science": true, "medicine": true, "nursing": true,
	"law": true, "consulting": true, "product_management": true, "finance": true,
}

type RubricDim struct {
	Key         string  `json:"key"`
	Label       string  `json:"label"`
	Description string  `json:"description"`
	Weight      float64 `json:"weight"`
}

type Question struct {
	ID               string          `json:"id"`
	Title            string          `json:"title"`
	Track            string          `json:"track"`  // engineering | professional
	Domain           string          `json:"domain"` // system_design, coding, clinical_reasoning, ... (the sub-topic)
	Areas            []string        `json:"areas"`  // professions this interview is valid for (shared): engineering, medicine, ...
	Modality         string          `json:"modality"`
	Difficulty       string          `json:"difficulty"`
	Tags             []string        `json:"tags"`
	Prompt           string          `json:"prompt"`
	Blurb            string          `json:"blurb"`
	Rubric           []RubricDim     `json:"rubric"`
	Reference        json.RawMessage `json:"reference"`         // modality-specific ideal-answer material (server-only)
	InterviewerNotes string          `json:"interviewer_notes"` // guidance for the director
}

// Summary is the client-safe projection (no reference, no rubric internals).
type Summary struct {
	ID         string   `json:"id"`
	Title      string   `json:"title"`
	Track      string   `json:"track"`
	Domain     string   `json:"domain"`
	Areas      []string `json:"areas"`
	Modality   string   `json:"modality"`
	Difficulty string   `json:"difficulty"`
	Tags       []string `json:"tags"`
	Prompt     string   `json:"prompt"`
	Blurb      string   `json:"blurb"`
}

func (q Question) Summary() Summary {
	return Summary{
		ID: q.ID, Title: q.Title, Track: q.Track, Domain: q.Domain, Areas: q.Areas, Modality: q.Modality,
		Difficulty: q.Difficulty, Tags: q.Tags, Prompt: q.Prompt, Blurb: q.Blurb,
	}
}

var idRe = regexp.MustCompile(`^[a-z0-9]+(-[a-z0-9]+)*$`)

// Validate checks a single question for the required, well-formed fields.
func Validate(q Question) error {
	if !idRe.MatchString(q.ID) {
		return fmt.Errorf("id %q must be kebab-case", q.ID)
	}
	if strings.TrimSpace(q.Title) == "" {
		return fmt.Errorf("%s: title required", q.ID)
	}
	if q.Track != "engineering" && q.Track != "professional" {
		return fmt.Errorf("%s: track must be engineering|professional", q.ID)
	}
	if !validModalities[q.Modality] {
		return fmt.Errorf("%s: invalid modality %q", q.ID, q.Modality)
	}
	if strings.TrimSpace(q.Domain) == "" {
		return fmt.Errorf("%s: domain required", q.ID)
	}
	if len(q.Areas) == 0 {
		return fmt.Errorf("%s: at least one area required", q.ID)
	}
	for _, a := range q.Areas {
		if !validAreas[a] {
			return fmt.Errorf("%s: unknown area %q", q.ID, a)
		}
	}
	if !validDifficulty[q.Difficulty] {
		return fmt.Errorf("%s: invalid difficulty %q", q.ID, q.Difficulty)
	}
	if strings.TrimSpace(q.Prompt) == "" {
		return fmt.Errorf("%s: prompt required", q.ID)
	}
	if len(q.Rubric) == 0 {
		return fmt.Errorf("%s: rubric must have at least one dimension", q.ID)
	}
	for _, d := range q.Rubric {
		if strings.TrimSpace(d.Key) == "" || d.Weight <= 0 {
			return fmt.Errorf("%s: rubric dim needs key + positive weight", q.ID)
		}
	}
	if len(q.Reference) > 0 && !json.Valid(q.Reference) {
		return fmt.Errorf("%s: reference is not valid JSON", q.ID)
	}
	return nil
}

// Catalog is an in-memory, validated index of all questions.
type Catalog struct {
	byID  map[string]Question
	order []string
}

// Load reads every *.json file under dir, validates it, and indexes it.
func Load(dir string) (*Catalog, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, fmt.Errorf("read corpus dir %s: %w", dir, err)
	}
	c := &Catalog{byID: map[string]Question{}}
	var errs []string
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".json") {
			continue
		}
		b, err := os.ReadFile(filepath.Join(dir, e.Name()))
		if err != nil {
			errs = append(errs, fmt.Sprintf("%s: %v", e.Name(), err))
			continue
		}
		var q Question
		if err := json.Unmarshal(b, &q); err != nil {
			errs = append(errs, fmt.Sprintf("%s: %v", e.Name(), err))
			continue
		}
		if err := Validate(q); err != nil {
			errs = append(errs, fmt.Sprintf("%s: %v", e.Name(), err))
			continue
		}
		if _, dup := c.byID[q.ID]; dup {
			errs = append(errs, fmt.Sprintf("%s: duplicate id %s", e.Name(), q.ID))
			continue
		}
		c.byID[q.ID] = q
		c.order = append(c.order, q.ID)
	}
	if len(errs) > 0 {
		return nil, fmt.Errorf("corpus load errors:\n  %s", strings.Join(errs, "\n  "))
	}
	sort.Strings(c.order)
	return c, nil
}

func (c *Catalog) Count() int { return len(c.order) }

func (c *Catalog) Get(id string) (Question, bool) {
	q, ok := c.byID[id]
	return q, ok
}

// List returns client-safe summaries, optionally filtered by modality/track/domain.
func (c *Catalog) List(modality, track, domain string) []Summary {
	out := make([]Summary, 0, len(c.order))
	for _, id := range c.order {
		q := c.byID[id]
		if modality != "" && q.Modality != modality {
			continue
		}
		if track != "" && q.Track != track {
			continue
		}
		if domain != "" && q.Domain != domain {
			continue
		}
		out = append(out, q.Summary())
	}
	return out
}
