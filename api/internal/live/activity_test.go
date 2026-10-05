package live

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/tejo/mockinterview-api/internal/corpus"
)

func TestIdleCheckWaitsForRealWorkspaceInactivity(t *testing.T) {
	start := time.Date(2026, 10, 4, 0, 0, 0, 0, time.UTC)
	for _, kind := range []string{"coding", "design", "lld"} {
		t.Run(kind, func(t *testing.T) {
			activity := newConversationActivity([]Section{{Kind: kind}}, start)
			if activity.allowNudge(start.Add(59 * time.Second)) {
				t.Fatal("interrupted a candidate during technical working time")
			}
			activity.observe(start.Add(55*time.Second), true, true)
			if activity.allowNudge(start.Add(time.Minute)) {
				t.Fatal("recent workspace editing was mistaken for silence")
			}
			if !activity.allowNudge(start.Add(115 * time.Second)) {
				t.Fatal("a long inactive workspace can receive one check-in")
			}
			activity.observe(start.Add(120*time.Second), false, false)
			if activity.allowNudge(start.Add(10 * time.Minute)) {
				t.Fatal("interviewer's own speech rearmed a repeated nudge")
			}
			activity.observe(start.Add(10*time.Minute), true, true)
			if !activity.allowNudge(start.Add(11 * time.Minute)) {
				t.Fatal("fresh candidate work should allow a later check-in")
			}
		})
	}
	activity := newConversationActivity([]Section{{Kind: "behavioral"}}, start)
	if activity.allowNudge(start.Add(44*time.Second)) || !activity.allowNudge(start.Add(45*time.Second)) {
		t.Fatal("conversational silence should use its shorter window")
	}
	activity.observe(start.Add(time.Minute), true, true)
	if activity.allowNudge(start.Add(119 * time.Second)) {
		t.Fatal("working-time request must extend the conversational quiet window")
	}
	if !activity.allowNudge(start.Add(2 * time.Minute)) {
		t.Fatal("inactive workspace should permit a neutral check-in after one minute")
	}
	// A subsequent substantive candidate turn ends the workspace interval.
	activity.observe(start.Add(3*time.Minute), true, false)
	if !activity.allowNudge(start.Add(3*time.Minute + 45*time.Second)) {
		t.Fatal("working flag remained sticky after the candidate resumed conversation")
	}
}

func TestExplicitRequestsForWorkingTime(t *testing.T) {
	for _, text := range []string{
		"Why don't you let me draw the system design?",
		"Let me think about it.",
		"Can I draw the diagram first?",
		"I'm just figuring out my answer.",
		"Please stop asking questions and let me finish.",
		"Let me read the prompt.",
		"Let me review the case first.",
		"Let me calculate the numbers.",
		"Let me draft the response.",
		"I am still reviewing.",
	} {
		if !requestsWorkingTime(text) {
			t.Errorf("did not preserve candidate's floor for %q", text)
		}
	}
	for _, text := range []string{"How many clicks per second?", "I'm ready to discuss the design.", "The watermark follows the latest event time.",
		"Let me think. I would keep event IDs for 24 hours.",
		"Let me think, I would keep event IDs for 24 hours.",
		"Let me draw the diagram, then I will explain my partitioning choice.",
		"Let me think. Actually, I am ready.",
		"I finished the diagram. Let me explain it.",
		"Let me calculate. The result is 45 dollars.",
		"Let me review the case, the patient is stable.",
		"Let me draft the response and explain my recommendation.",
	} {
		if requestsWorkingTime(text) {
			t.Errorf("blocked a substantive candidate turn %q", text)
		}
	}
}

func TestTechnicalOpeningsDoNotCoachClarification(t *testing.T) {
	for _, domain := range []string{"coding", "system_design", "ml_system_design", "low_level_design"} {
		focus := firstQuestionFocus(corpus.Question{Domain: domain})
		if !strings.Contains(focus, "WAIT SILENTLY") || strings.Contains(focus, "?") {
			t.Fatalf("%s opening still prompts requirements gathering: %s", domain, focus)
		}
	}
	cat, err := corpus.Load("../../data/corpus")
	if err != nil {
		t.Fatal(err)
	}
	q, _ := cat.Get("ad-click-aggregator")
	var reference struct {
		Facts []struct {
			ID         string `json:"id"`
			Value      string `json:"value"`
			RevealWhen string `json:"reveal_when"`
		} `json:"facts"`
		DeepDives []struct {
			Probe string `json:"probe"`
		} `json:"deep_dives"`
	}
	if err = json.Unmarshal(q.Reference, &reference); err != nil {
		t.Fatal(err)
	}
	volume, size := false, false
	for _, fact := range reference.Facts {
		if fact.ID == "peak-click-volume" {
			volume = strings.Contains(fact.Value, "500,000") && !strings.Contains(fact.Value, "200") && strings.Contains(fact.RevealWhen, "alone")
		}
		if fact.ID == "average-click-event-size" {
			size = strings.Contains(fact.Value, "200") && strings.Contains(fact.RevealWhen, "event size")
		}
	}
	if !volume || !size {
		t.Fatal("click volume and event size must have independent disclosure rules")
	}
	for _, probe := range reference.DeepDives {
		for _, hint := range []string{"watermarks", "key salting", "two-stage aggregation", "idempotent upserts", "CDC/Debezium"} {
			if strings.Contains(probe.Probe, hint) {
				t.Fatalf("probe discloses the technique being assessed: %s", probe.Probe)
			}
		}
		if strings.Count(probe.Probe, "?") != 1 {
			t.Fatalf("compound scripted probe remains: %s", probe.Probe)
		}
	}
}
