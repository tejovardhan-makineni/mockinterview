package llm

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
)

// Stub is a deterministic, offline Client. It returns plausible, schema-shaped
// output keyed off GenerateRequest.Purpose so the entire product is exercisable
// (and unit-testable) with no API key and no network. It is intentionally
// simple and stable — tests assert on its output.
type Stub struct{}

func NewStub() *Stub { return &Stub{} }

func (s *Stub) Stubbed() bool { return true }
func (s *Stub) Info() Info    { return Info{Provider: "stub", Model: "deterministic", Stubbed: true} }

func (s *Stub) Generate(_ context.Context, req GenerateRequest) (string, error) {
	switch req.Purpose {
	case PurposeResumeParse:
		return mustJSON(stubResume()), nil
	case PurposeResumeReview:
		return mustJSON(stubResumeReview()), nil
	case PurposeScore:
		return mustJSON(stubScore()), nil
	case PurposeDirector:
		return stubDirectorTurn(req), nil
	case PurposeSummarize:
		return "The candidate is progressing through the design; a data store and an application tier are present on the canvas.", nil
	default:
		if req.JSONSchema != nil {
			return "{}", nil
		}
		return "This is a deterministic stub response. Set GEMINI_API_KEY to use the real model.", nil
	}
}

func stubResume() map[string]any {
	return map[string]any{
		"name":             "Alex Candidate",
		"headline":         "Senior Software Engineer",
		"years_experience": 7,
		"skills":           []string{"Go", "Distributed Systems", "Postgres", "Kubernetes", "gRPC"},
		"projects": []map[string]any{
			{"name": "Payments Ledger", "summary": "Built an idempotent double-entry ledger handling 5k TPS.", "tech": []string{"Go", "Postgres", "Kafka"}},
			{"name": "Search Platform", "summary": "Owned a typeahead service with p99 < 40ms across 3 regions.", "tech": []string{"Elasticsearch", "Redis"}},
		},
		"summary": "Backend-leaning engineer with distributed systems depth and payments experience.",
	}
}

func stubResumeReview() map[string]any {
	return map[string]any{
		"overall_score": 3.4,
		"summary":       "Strong backend experience; impact is under-quantified and the summary buries the lead. (stub)",
		"strengths": []string{
			"Clear distributed-systems focus with concrete scale (5k TPS).",
			"Good tech breadth across storage, streaming, and search.",
		},
		"gaps": []string{
			"Bullets describe responsibilities, not outcomes.",
			"No metrics on latency/cost/reliability improvements.",
			"Summary line is generic.",
		},
		"line_edits": []map[string]any{
			{"original": "Worked on the payments ledger service.", "improved": "Designed an idempotent double-entry ledger sustaining 5k TPS with zero reconciliation drift over 12 months."},
			{"original": "Responsible for search platform.", "improved": "Owned a 3-region typeahead service, cutting p99 from 120ms to 40ms and halving index cost."},
		},
		"impact_suggestions": []string{
			"Quantify every bullet: %, latency, $, scale, or time saved.",
			"Lead each role with your single biggest result.",
		},
		"ats_notes": "Include role-relevant keywords (Kafka, CDC, sharding) verbatim; keep to a single-column layout for parser compatibility.",
	}
}

func stubScore() map[string]any {
	dims := []string{
		"requirements", "clarifying_questions", "estimations", "api_design",
		"data_model", "high_level_design", "depth_reasoning", "deep_dive",
		"scaling", "bottlenecks", "reliability", "observability", "security", "coverage",
	}
	scores := make([]map[string]any, 0, len(dims))
	for i, d := range dims {
		scores = append(scores, map[string]any{
			"dimension":    d,
			"score":        2 + (i % 3), // 2..4, deterministic
			"evidence":     fmt.Sprintf("Stub evidence for %s.", d),
			"expected":     fmt.Sprintf("Expected coverage of %s per the reference rubric.", d),
			"actual":       fmt.Sprintf("Candidate partially addressed %s.", d),
			"coverage_pct": 40 + (i%4)*15,
		})
	}
	return map[string]any{
		"scores":      scores,
		"overall":     2.6,
		"summary":     "Solid structure with room to deepen estimations and failure handling. (stub)",
		"strengths":   []string{"Clear requirement gathering", "Reasonable high-level design"},
		"gaps":        []string{"Thin back-of-envelope math", "Limited discussion of failure modes"},
		"coaching_md": "## Coaching (stub)\n\n- Lead with a crisp requirements + estimation pass.\n- When you place a datastore, proactively cover replication, CDC, and hotspots.\n",
	}
}

// stubDirectorTurn produces a short interviewer utterance. It lightly reacts to
// the last candidate message so a scripted local interview feels alive.
func stubDirectorTurn(req GenerateRequest) string {
	last := ""
	for i := len(req.Messages) - 1; i >= 0; i-- {
		if req.Messages[i].Role == "user" {
			last = strings.ToLower(req.Messages[i].Text)
			break
		}
	}
	switch {
	case last == "":
		return "Let's begin. Walk me through how you'd approach this system. Start with the functional requirements."
	case strings.Contains(last, "database") || strings.Contains(last, "postgres") || strings.Contains(last, "sql"):
		return "You mentioned a database. How would you capture changes out of it — say for a search index or cache? Would you use change data capture, something like Debezium?"
	case strings.Contains(last, "cache"):
		return "Good. What eviction policy would you use for that cache, and how do you handle a cache stampede on a cold key?"
	case strings.Contains(last, "queue") || strings.Contains(last, "kafka"):
		return "How do you guarantee ordering and exactly-once semantics through that queue?"
	default:
		return "Okay. Can you make your back-of-the-envelope numbers concrete — expected QPS, storage per year, and the read/write ratio?"
	}
}

func mustJSON(v any) string {
	b, _ := json.Marshal(v)
	return string(b)
}
