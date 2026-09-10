package corpus

import (
	"encoding/json"
	"testing"
)

func TestVersionedFormatSnapshotAndValidation(t *testing.T) {
	c, err := Load("../../data/corpus")
	if err != nil {
		t.Fatal(err)
	}
	q, ok := c.Get("incident-triage-checkout")
	if !ok || q.FormatDefinition == nil {
		t.Fatal("format not resolved")
	}
	f := *q.FormatDefinition
	before := Fingerprint(q)
	f.Revision++
	q.FormatDefinition = &f
	if Fingerprint(q) == before {
		t.Fatal("format revision missing from snapshot fingerprint")
	}
	f.Stages = append([]FormatStage(nil), f.Stages...)
	f.Stages[0].Share = .5
	if ValidateFormat(f) == nil {
		t.Fatal("invalid stage budget accepted")
	}
	q.FormatID = ""
	if Validate(q) == nil {
		t.Fatal("v1 required format accepted empty")
	}
}

func TestFactRevealContract(t *testing.T) {
	c, err := Load("../../data/corpus")
	if err != nil {
		t.Fatal(err)
	}
	q, _ := c.Get("incident-triage-checkout")
	var ref map[string]any
	_ = json.Unmarshal(q.Reference, &ref)
	ref["facts"] = []map[string]any{{"value": "partial fact", "reveal_when": "asked"}}
	q.Reference, _ = json.Marshal(ref)
	if Validate(q) == nil {
		t.Fatal("fact without stable id accepted")
	}
}
