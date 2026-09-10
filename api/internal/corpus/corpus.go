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
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"math"
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
	"ux_design": true, "sales": true, "marketing": true, "human_resources": true, "education": true,
}

type RubricDim struct {
	Key         string            `json:"key"`
	Label       string            `json:"label"`
	Description string            `json:"description"`
	Weight      float64           `json:"weight"`
	Anchors     map[string]string `json:"anchors,omitempty"`
}

type Question struct {
	SchemaVersion    int             `json:"schema_version,omitempty"`
	Revision         int             `json:"revision,omitempty"`
	FormatID         string          `json:"format_id,omitempty"`
	ReviewStatus     string          `json:"review_status,omitempty"`
	Provenance       *Provenance     `json:"provenance,omitempty"`
	Minutes          int             `json:"minutes,omitempty"`
	LearningDrills   []Drill         `json:"learning_drills,omitempty"`
	Settings         SessionSettings `json:"-"`
	FormatDefinition *Format         `json:"format_definition,omitempty"`
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
	SchemaVersion int      `json:"schema_version"`
	Revision      int      `json:"revision"`
	FormatID      string   `json:"format_id"`
	ReviewStatus  string   `json:"review_status"`
	Minutes       int      `json:"minutes"`
	ID            string   `json:"id"`
	Title         string   `json:"title"`
	Track         string   `json:"track"`
	Domain        string   `json:"domain"`
	Areas         []string `json:"areas"`
	Modality      string   `json:"modality"`
	Difficulty    string   `json:"difficulty"`
	Tags          []string `json:"tags"`
	Prompt        string   `json:"prompt"`
	Blurb         string   `json:"blurb"`
}

func (q Question) Summary() Summary {
	q = Normalize(q)
	return Summary{
		SchemaVersion: q.SchemaVersion, Revision: q.Revision, FormatID: q.FormatID, ReviewStatus: q.ReviewStatus, Minutes: q.Minutes,
		ID: q.ID, Title: q.Title, Track: q.Track, Domain: q.Domain, Areas: q.Areas, Modality: q.Modality,
		Difficulty: q.Difficulty, Tags: q.Tags, Prompt: q.Prompt, Blurb: q.Blurb,
	}
}

var idRe = regexp.MustCompile(`^[a-z0-9]+(-[a-z0-9]+)*$`)
var dimensionRe = regexp.MustCompile(`^[a-z][a-z0-9_]*$`)

// Validate checks a single question for the required, well-formed fields.
func Validate(q Question) error {
	if q.SchemaVersion == 1 && (q.Revision < 1 || q.FormatID == "" || q.ReviewStatus == "" || q.Minutes < 3) {
		return fmt.Errorf("%s: v1 requires revision, format_id, review_status and minutes >= 3", q.ID)
	}
	if q.SchemaVersion < 0 || q.SchemaVersion > 1 {
		return fmt.Errorf("%s: unsupported schema_version", q.ID)
	}
	if q.Revision < 0 {
		return fmt.Errorf("%s: revision must be positive", q.ID)
	}
	if q.FormatID != "" && !idRe.MatchString(q.FormatID) {
		return fmt.Errorf("%s: format_id must be kebab-case", q.ID)
	}
	if q.Minutes < 0 || q.Minutes > 90 {
		return fmt.Errorf("%s: minutes must be 1..90", q.ID)
	}
	if q.ReviewStatus != "" && q.ReviewStatus != "preview" && q.ReviewStatus != "reviewed" {
		return fmt.Errorf("%s: review_status must be preview|reviewed", q.ID)
	}
	if q.ReviewStatus == "reviewed" && (q.Provenance == nil || q.Provenance.Reviewer == "" || q.Provenance.ReviewedAt == "") {
		return fmt.Errorf("%s: reviewed content requires reviewer and date", q.ID)
	}
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
	seenAreas := map[string]bool{}
	for _, a := range q.Areas {
		if seenAreas[a] {
			return fmt.Errorf("%s: duplicate area %q", q.ID, a)
		}
		seenAreas[a] = true
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
	keys := map[string]bool{}
	for _, d := range q.Rubric {
		if !dimensionRe.MatchString(d.Key) || d.Weight <= 0 || math.IsNaN(d.Weight) || math.IsInf(d.Weight, 0) || d.Weight > 5 || strings.TrimSpace(d.Label) == "" || strings.TrimSpace(d.Description) == "" {
			return fmt.Errorf("%s: rubric dim needs snake_case key, label, description and weight in (0,5]", q.ID)
		}
		if keys[d.Key] {
			return fmt.Errorf("%s: duplicate rubric dimension %q", q.ID, d.Key)
		}
		keys[d.Key] = true
		for k, v := range d.Anchors {
			if (k != "0" && k != "1" && k != "2" && k != "3" && k != "4") || strings.TrimSpace(v) == "" {
				return fmt.Errorf("%s: invalid rubric anchor", q.ID)
			}
		}
	}
	var reference map[string]json.RawMessage
	if len(q.Reference) == 0 || json.Unmarshal(q.Reference, &reference) != nil || reference == nil {
		return fmt.Errorf("%s: reference must be a nonempty JSON object", q.ID)
	}
	if len(reference) == 0 || strings.TrimSpace(q.InterviewerNotes) == "" || strings.TrimSpace(q.Blurb) == "" {
		return fmt.Errorf("%s: reference, interviewer_notes and blurb are required", q.ID)
	}
	if q.SchemaVersion == 1 && (q.Provenance == nil || q.Provenance.License == "" || q.Provenance.Authorship == "") {
		return fmt.Errorf("%s: versioned content needs license and authorship provenance", q.ID)
	}
	if err := validateReference(q, reference); err != nil {
		return err
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
	formats, err := loadFormats(filepath.Join(filepath.Dir(dir), "formats"))
	if err != nil {
		return nil, err
	}
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
		decoder := json.NewDecoder(bytes.NewReader(b))
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&q); err != nil {
			errs = append(errs, fmt.Sprintf("%s: %v", e.Name(), err))
			continue
		}
		if err := decoder.Decode(new(any)); err != io.EOF {
			errs = append(errs, fmt.Sprintf("%s: expected one JSON object", e.Name()))
			continue
		}
		if strings.TrimSuffix(e.Name(), ".json") != q.ID {
			errs = append(errs, fmt.Sprintf("%s: filename must match id", e.Name()))
			continue
		}
		if q.FormatDefinition != nil {
			errs = append(errs, fmt.Sprintf("%s: source must reference format_id, not embed format_definition", e.Name()))
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
		q = Normalize(q)
		if f, ok := formats[q.FormatID]; ok {
			if !containsString(f.Workspaces, q.Modality) {
				errs = append(errs, fmt.Sprintf("%s: format does not support workspace %s", q.ID, q.Modality))
				continue
			}
			copy := f
			q.FormatDefinition = &copy
		} else if q.SchemaVersion == 1 {
			errs = append(errs, fmt.Sprintf("%s: format_id %q has no definition in sibling formats directory", q.ID, q.FormatID))
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

// Fingerprint is recorded with an attempt so content edits cannot be confused
// with the content used for an earlier assessment. Runtime settings are separate.
func Fingerprint(q Question) string {
	b, _ := json.Marshal(q)
	return fmt.Sprintf("%x", sha256.Sum256(b))
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
