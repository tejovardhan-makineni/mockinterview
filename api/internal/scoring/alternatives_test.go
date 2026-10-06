package scoring

import (
	"context"
	"strings"
	"testing"

	"github.com/tejo/mockinterview-api/internal/corpus"
	"github.com/tejo/mockinterview-api/internal/store"
)

func TestTechnicalRubricsAcceptEquivalentSolutionsWithoutWaivingTaskBounds(t *testing.T) {
	cat, err := corpus.Load("../../data/corpus")
	if err != nil {
		t.Fatal(err)
	}
	var coding, patterns int
	for _, summary := range cat.List("", "", "") {
		q, _ := cat.Get(summary.ID)
		for _, dim := range q.Rubric {
			if q.Domain == "coding" && dim.Key == "approach" {
				coding++
				if !strings.Contains(dim.Description, "accept equivalent alternatives") {
					t.Errorf("%s makes its reference algorithm mandatory", q.ID)
				}
			}
			if q.Domain == "low_level_design" && dim.Key == "design_patterns" {
				patterns++
				permitsAlternatives := strings.Contains(dim.Description, "example") || strings.Contains(dim.Description, "acceptable") || strings.Contains(dim.Description, "equally valid")
				if dim.Label != "Abstraction choices" || !permitsAlternatives {
					t.Errorf("%s assesses pattern names instead of justified design choices", q.ID)
				}
			}
		}
	}
	if coding == 0 || patterns == 0 {
		t.Fatal("technical corpus fixtures were not evaluated")
	}
	lru, _ := cat.Get("lru-cache")
	if !strings.Contains(lru.PublicBrief(), "O(1) average time") || !strings.Contains(lru.Prompt, "O(1) average time") {
		t.Fatal("accepting alternatives removed the LRU operation bound")
	}
	twoSum, _ := cat.Get("two-sum-variants")
	if !strings.Contains(string(twoSum.Reference), "sorting (value, original-index) pairs is a valid Two Sum approach") || strings.Contains(string(twoSum.Reference), "destroys original indices, so it fits") {
		t.Fatal("reference incorrectly rejects sorting with preserved indices")
	}
}

func TestScorerUsesActualAlternativeSolutionAndKeepsExplicitPerformanceRequirements(t *testing.T) {
	cat, err := corpus.Load("../../data/corpus")
	if err != nil {
		t.Fatal(err)
	}
	q, _ := cat.Get("two-sum-variants")
	model := &captureModel{response: `{"scores":[{"dimension":"approach","score":3,"assessed":true,"evidence_refs":[{"source_id":"answer","quote":"sort pairs of values and original indices"}]}]}`}
	turns := []store.Turn{{ID: "answer", Role: "candidate", Text: "I sort pairs of values and original indices, then move two pointers toward each other. I return the original indices and never match the same position. This costs O(n log n) time and O(n) extra space."}}
	result, err := New(model, "test-model").Evaluate(context.Background(), q, turns, "")
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{
		"reference algorithms, designs and named patterns are examples, not mandatory answers",
		"Interpret solution-specific rubric prose as the underlying competency",
		"This does not waive an explicit requirement such as O(1) average LRU operations",
		"Discuss efficiency gaps\nseparately from functional correctness",
	} {
		if !strings.Contains(model.request.System, want) {
			t.Errorf("missing alternative-solution assessment contract %q", want)
		}
	}
	if !result.Scored || result.Overall != 3 || !strings.Contains(result.Scores[0].Evidence, "sort pairs") {
		t.Fatalf("candidate evidence for an alternative was replaced by reference text: %+v", result)
	}
}
