package live

import (
	"encoding/json"
	"reflect"
	"testing"

	"github.com/tejo/mockinterview-api/internal/corpus"
)

func TestMMILiveProjectionKeepsConditionalFactsAndUnknownMaterial(t *testing.T) {
	cat, err := corpus.Load("../../data/corpus")
	if err != nil {
		t.Fatal(err)
	}
	q, ok := cat.Get("mmi-ethical-dilemma")
	if !ok {
		t.Fatal("missing ethical dilemma")
	}
	original := append(json.RawMessage(nil), q.Reference...)
	decode := func(reference json.RawMessage) map[string]any {
		t.Helper()
		var material map[string]any
		if err := json.Unmarshal(reference, &material); err != nil {
			t.Fatal(err)
		}
		return material
	}
	before := decode(original)
	if len(before["follow_ups"].([]any)) != 5 {
		t.Fatal("review the authored follow-up bank when its scope changes")
	}
	projected := liveQuestion(q)
	if string(q.Reference) != string(original) {
		t.Fatal("live projection modified the reference used for scoring")
	}
	after := decode(projected.Reference)
	delete(before, "follow_ups")
	if !reflect.DeepEqual(before, after) {
		t.Fatal("projection lost conditional probes, facts, model points or another reference field")
	}

	// Older or future snapshots can put a unique fact in an unfamiliar entry.
	// Remove only the reviewed question strings, never the field indiscriminately.
	unknown := []any{
		"A new conditional variant contains a unique scenario fact.",
		map[string]any{"trigger": "new condition", "fact": "future structured observation"},
	}
	expanded := decode(original)
	expanded["future_material"] = map[string]any{"disclosure": "only when requested"}
	expanded["follow_ups"] = append(expanded["follow_ups"].([]any), unknown...)
	q.Reference, err = json.Marshal(expanded)
	if err != nil {
		t.Fatal(err)
	}
	newProjection := decode(liveQuestion(q).Reference)
	expanded["follow_ups"] = unknown
	if !reflect.DeepEqual(expanded, newProjection) {
		t.Fatal("unrecognized entries or future reference fields were discarded")
	}

	q.ID = "another-station"
	if string(liveQuestion(q).Reference) != string(q.Reference) {
		t.Fatal("scenario-specific review was applied to an unreviewed scenario")
	}
}
