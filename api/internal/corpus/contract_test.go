package corpus

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestContractRejectsUnknownFieldsAndMismatchedFilename(t *testing.T) {
	b, err := os.ReadFile("../../data/corpus/url-shortener.json")
	if err != nil {
		t.Fatal(err)
	}
	var raw map[string]any
	_ = json.Unmarshal(b, &raw)
	raw["interviewer_note_typo"] = "quiet"
	b, _ = json.Marshal(raw)
	dir := t.TempDir()
	_ = os.WriteFile(filepath.Join(dir, "url-shortener.json"), b, 0600)
	if _, err = Load(dir); err == nil {
		t.Fatal("unknown field accepted")
	}
	delete(raw, "interviewer_note_typo")
	raw["id"] = "mismatch"
	b, _ = json.Marshal(raw)
	_ = os.WriteFile(filepath.Join(dir, "url-shortener.json"), b, 0600)
	if _, err = Load(dir); err == nil {
		t.Fatal("mismatched filename accepted")
	}
}

func TestDuplicateRubricAndEmptyReferenceRejected(t *testing.T) {
	c, err := Load("../../data/corpus")
	if err != nil {
		t.Fatal(err)
	}
	q, _ := c.Get("url-shortener")
	q.Rubric = append(q.Rubric, q.Rubric[0])
	if Validate(q) == nil {
		t.Fatal("duplicate rubric accepted")
	}
	q, _ = c.Get("url-shortener")
	q.Reference = json.RawMessage(`{}`)
	if Validate(q) == nil {
		t.Fatal("empty reference accepted")
	}
}

func TestSafeSummaryAndStableFingerprint(t *testing.T) {
	c, err := Load("../../data/corpus")
	if err != nil {
		t.Fatal(err)
	}
	q, _ := c.Get("url-shortener")
	before := Fingerprint(q)
	configured := ApplySessionConfig(q, json.RawMessage(`{"target_level":"entry","practice_mode":"coaching"}`))
	if Fingerprint(configured) != before {
		t.Fatal("runtime config changed content fingerprint")
	}
	b, _ := json.Marshal(q.Summary())
	var m map[string]any
	_ = json.Unmarshal(b, &m)
	for _, key := range []string{"reference", "rubric", "interviewer_notes"} {
		if _, exists := m[key]; exists {
			t.Fatal("private field leaked", key)
		}
	}
	if q.Summary().ReviewStatus != "preview" {
		t.Fatal("invented practitioner review")
	}
}
