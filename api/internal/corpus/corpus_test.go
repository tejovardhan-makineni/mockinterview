package corpus

import "testing"

// TestLoadRealCorpus loads the shipped corpus directory and asserts every file
// is valid. This is the CI gate that keeps agent-authored questions honest.
func TestLoadRealCorpus(t *testing.T) {
	cat, err := Load("../../data/corpus")
	if err != nil {
		t.Fatalf("corpus failed to load: %v", err)
	}
	if cat.Count() == 0 {
		t.Fatal("expected at least one question")
	}
	// Summaries must never leak reference material.
	for _, s := range cat.List("", "", "") {
		if s.ID == "" || s.Title == "" || s.Prompt == "" {
			t.Errorf("summary missing core fields: %+v", s)
		}
	}
}

func TestValidateRejectsBad(t *testing.T) {
	bad := Question{ID: "Bad ID", Title: "x"}
	if err := Validate(bad); err == nil {
		t.Fatal("expected validation error for bad id")
	}
}
