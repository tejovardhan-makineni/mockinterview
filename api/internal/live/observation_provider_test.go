package live

// Opt-in semantic evaluation uses only synthetic artifacts and conversations.
// A successful API call is not proof of interview quality: inspect the saved
// utterances and factual evidence against each case's review criterion.

import (
	"context"
	"encoding/json"
	"os"
	"slices"
	"testing"
	"time"

	"github.com/tejo/mockinterview-api/internal/corpus"
	"github.com/tejo/mockinterview-api/internal/llm"
)

func TestObservationProviderEvaluation(t *testing.T) {
	if os.Getenv("RUN_OBSERVATION_PROVIDER_EVAL") != "1" {
		t.Skip("opt-in synthetic provider evaluation")
	}
	key, output := os.Getenv("GEMINI_API_KEY"), os.Getenv("OBSERVATION_EVAL_OUTPUT")
	if key == "" || output == "" {
		t.Fatal("GEMINI_API_KEY and OBSERVATION_EVAL_OUTPUT are required")
	}
	model := os.Getenv("GEMINI_MODEL_REASON")
	if model == "" {
		model = "gemini-3.8-flash"
	}
	client, err := llm.NewGemini(context.Background(), key, model)
	if err != nil {
		t.Fatal("provider setup unavailable")
	}
	cat, err := corpus.Load("../../data/corpus")
	if err != nil {
		t.Fatal(err)
	}
	type evaluation struct {
		ID       string              `json:"id"`
		Question string              `json:"question"`
		Review   string              `json:"review"`
		Input    ObservationInput    `json:"input"`
		Allowed  []string            `json:"allowed_actions"`
		Decision ObservationDecision `json:"decision"`
		Error    string              `json:"error,omitempty"`
	}
	bug := "def two_sum(nums, target):\n    seen = {}\n    for i, n in enumerate(nums):\n        seen[n] = i\n        if target - n in seen:\n            return [seen[target - n], i]"
	correct := "def two_sum(nums, target):\n    seen = {}\n    for i, n in enumerate(nums):\n        if target - n in seen:\n            return [seen[target - n], i]\n        seen[n] = i"
	cases := []evaluation{
		{ID: "working-through-bug", Question: "two-sum-variants", Review: "Stay silent while implementation is unfinished; private notes may notice possible same-index reuse, without diagnosing it aloud.", Allowed: []string{"wait"}, Input: ObservationInput{CandidateWorking: true, QuietSeconds: 3, Workspace: bug, History: []llm.Message{{Role: "model", Text: "Find the two indices whose values sum to target."}, {Role: "user", Text: "Give me a minute, I am still implementing and will test it next."}}}},
		{ID: "completed-bug-trace", Question: "two-sum-variants", Review: "Ask one concrete legal input trace exposing same-index reuse without naming the error, expected result or fix. Do not say code was executed.", Allowed: []string{"probe"}, Input: ObservationInput{QuietSeconds: 12, Workspace: bug, History: []llm.Message{{Role: "model", Text: "Find the two indices whose values sum to target."}, {Role: "user", Text: "That is my complete implementation. I think it is correct; it uses linear time and space."}}}},
		{ID: "correction-supersedes-notes", Question: "two-sum-variants", Review: "Credit reordered lookup; do not repeat stale same-index bug probe or insist on a different algorithm. New follow-up must seek genuinely new evidence.", Allowed: []string{"wait", "probe", "advance", "wrap"}, Input: ObservationInput{QuietSeconds: 10, Workspace: correct, PreviousNotes: "Earlier version inserted the current value before the lookup; same-index reuse was an unresolved concern.", History: []llm.Message{{Role: "model", Text: "Trace your code for [3, 2, 4] with target 6."}, {Role: "user", Text: "I was matching the first 3 with itself. I moved the lookup before insertion. It now returns indices 1 and 2 for that case, and [3,3] returns [0,1]. The lookup stores prior indices only. Time and space are both O(n)."}}}},
		{ID: "clarification-only", Question: "url-shortener", Review: "Supply only the requested scenario throughput facts/explicit assumptions, without demanding a design choice or releasing the whole reference.", Allowed: []string{"answer"}, Input: ObservationInput{QuietSeconds: 7, History: []llm.Message{{Role: "model", Text: "Design a service that creates short links and redirects them to the original URLs."}, {Role: "user", Text: "How many new links per day should I plan for?"}}}},
		{ID: "unfinished-design", Question: "url-shortener", Review: "Stay silent; a cache box is not a completed proposal or reason to start questioning cache design.", Allowed: []string{"wait"}, Input: ObservationInput{QuietSeconds: 2, Workspace: "In-app whiteboard: client -> API; cache rectangle; database rectangle, no outgoing edges yet.", History: []llm.Message{{Role: "model", Text: "Design a URL shortener."}, {Role: "user", Text: "I am sketching the request path and will explain the storage decisions when the diagram is ready."}}}},
		{ID: "exhausted-intro-advance", Question: "lld-parking-lot", Review: "Move from completed intro to the planned LLD task with concise opening; don't stretch rapport to fill time or announce all hidden requirements.", Allowed: []string{"advance"}, Input: ObservationInput{Stage: Section{ID: "intro", Kind: "intro", Title: "Opening"}, NextStage: &Section{ID: "core", Kind: "lld", Title: "Low-level design", CandidateLed: true}, QuietSeconds: 8, History: []llm.Message{{Role: "model", Text: "Hi, I'm Alex. Tell me briefly about your background."}, {Role: "user", Text: "I am a backend engineer with three years building APIs. I am ready for the design question."}}}},
	}
	defer func() {
		data, _ := json.MarshalIndent(map[string]any{"director_version": DirectorVersion, "model": model, "synthetic_data_only": true, "review_required": true, "samples": cases}, "", "  ")
		if err := os.WriteFile(output, data, 0600); err != nil {
			t.Error(err)
		}
	}()
	for i := range cases {
		c := &cases[i]
		t.Run(c.ID, func(t *testing.T) {
			q, ok := cat.Get(c.Question)
			if !ok {
				t.Fatal("evaluation scenario unavailable")
			}
			q.Settings.TargetLevel = "mid"
			sections := SectionPlan(q, false, "")
			if c.Input.Stage.ID == "" {
				for j, section := range sections {
					if section.Kind != "intro" && section.Kind != "wrap" {
						c.Input.Stage = section
						if j+1 < len(sections) {
							c.Input.NextStage = &sections[j+1]
						}
						break
					}
				}
			}
			c.Input.RemainingSeconds = 720
			c.Input.Trigger = "periodic_review"
			system := SystemPrompt(q, "neutral", 3, "main", "", "", 15, "aoede", "en", sections, "")
			ctx, cancel := context.WithTimeout(context.Background(), 35*time.Second)
			defer cancel()
			decision, err := DecideObservation(ctx, client, model, system, c.Input)
			if err != nil {
				c.Error = err.Error()
				t.Fatal(c.Error)
			}
			c.Decision = decision
			if !slices.Contains(c.Allowed, decision.Action) {
				t.Errorf("action %q inconsistent with synthetic case criterion", decision.Action)
			}
			t.Logf("%s: %s — %s", c.ID, decision.Action, decision.Utterance)
		})
	}
}
