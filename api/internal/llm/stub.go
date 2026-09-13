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
	case PurposeResumeMatch:
		return mustJSON(stubResumeMatch()), nil
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
		"contact": map[string]any{
			"location": "San Francisco, CA",
			"email":    "alex@example.com",
			"phone":    "(555) 123-4567",
			"links":    []string{"github.com/alexc", "linkedin.com/in/alexc"},
		},
		"summary": "Backend-leaning engineer with distributed systems depth and payments experience.",
		"experience": []map[string]any{
			{
				"company": "Acme Corp", "role": "Senior Software Engineer", "start": "2021", "end": "Present",
				"bullets": []string{
					"Worked on the payments ledger service.",
					"Responsible for search platform.",
					"Helped with various backend tasks and improvements.",
				},
			},
			{
				"company": "Globex", "role": "Software Engineer", "start": "2018", "end": "2021",
				"bullets": []string{
					"Built internal tools and APIs.",
					"Participated in on-call rotation.",
				},
			},
		},
		"education": []map[string]any{
			{"school": "State University", "degree": "B.S. Computer Science", "dates": "2014 – 2018"},
		},
		"skills": []map[string]any{
			{"category": "Languages", "items": []string{"Go", "Python", "TypeScript"}},
			{"category": "Infrastructure", "items": []string{"Distributed Systems", "Postgres", "Kubernetes", "gRPC", "Kafka", "Redis", "Elasticsearch"}},
		},
		"projects": []map[string]any{
			{"name": "Payments Ledger", "summary": "Built an idempotent double-entry ledger handling 5k TPS.", "tech": []string{"Go", "Postgres", "Kafka"}},
			{"name": "Search Platform", "summary": "Owned a typeahead service with p99 < 40ms across 3 regions.", "tech": []string{"Elasticsearch", "Redis"}},
		},
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
		"critical_fixes": []map[string]any{
			{"title": "Vague responsibility bullet", "location": "Experience 1, bullet 1", "detail": "'Worked on the payments ledger service' states no outcome, scale, or metric."},
			{"title": "Filler bullet dilutes impact", "location": "Experience 1, bullet 3", "detail": "'Helped with various backend tasks' says nothing measurable — cut it or replace with a result."},
		},
		"quantifiable_impacts": []map[string]any{
			{"text": "5k TPS with zero reconciliation drift over 12 months", "note": "Concrete throughput + reliability window — exactly the shape recruiters scan for."},
			{"text": "p99 from 120ms to 40ms", "note": "Clear before/after latency win."},
		},
		"ats_breakdown": map[string]any{
			"formatting":    "pass",
			"keyword_match": 72,
			"notes":         "Single-column, standard headings. Add missing hard skills (CDC, sharding) verbatim to lift keyword match.",
		},
	}
}

func stubResumeMatch() map[string]any {
	return map[string]any{
		"match_score":      68,
		"verdict":          "Strong backend fit; missing a few explicitly-required cloud + streaming keywords. (stub)",
		"matched_keywords": []string{"Go", "Postgres", "Kubernetes", "distributed systems", "Kafka"},
		"missing_keywords": []string{"AWS", "Terraform", "gRPC streaming", "observability"},
		"strengths": []string{
			"Direct distributed-systems and payments experience aligns with the core of the role.",
			"Demonstrated ownership at scale (5k TPS, p99 40ms).",
		},
		"gaps": []string{
			"No explicit cloud provider (AWS/GCP) named though the JD requires it.",
			"Infrastructure-as-code (Terraform) not mentioned.",
		},
		"tailoring_suggestions": []map[string]any{
			{"issue": "Cloud keywords absent", "detail": "The JD lists AWS as required; the resume never names a cloud.", "suggestion": "Add the specific AWS services you used (EKS, RDS, SQS) to the relevant role."},
			{"issue": "IaC not surfaced", "detail": "Terraform is a listed must-have.", "suggestion": "If you've written Terraform/Pulumi, add a bullet quantifying what it provisioned."},
		},
		"ats_keyword_match": 64,
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

// stubDirectorTurn is a finite local demo, not a semantic assessment engine.
// Keep it single-focus and never recycle its probe bank indefinitely. Real
// providers follow the shared director policy using the full conversation.
func stubDirectorTurn(req GenerateRequest) string {
	last := ""
	asked := make(map[string]bool)
	for _, message := range req.Messages {
		if message.Role == "model" || message.Role == "assistant" {
			asked[message.Text] = true
		}
	}
	for i := len(req.Messages) - 1; i >= 0; i-- {
		if req.Messages[i].Role == "user" {
			last = strings.ToLower(req.Messages[i].Text)
			break
		}
	}
	if last == "" || strings.HasPrefix(last, "begin the interview using its authored opening") || strings.HasPrefix(last, "begin with a brief greeting") {
		intro := "Demo interview. "
		if _, title, ok := strings.Cut(req.System, "INTERVIEW: "); ok {
			if title, _, ok = strings.Cut(title, ". Format: "); ok && strings.TrimSpace(title) != "" {
				intro = "Demo interview: " + strings.TrimSpace(title) + ". "
			}
		}
		if strings.Contains(req.System, "Domain: behavioral.") {
			return intro + "Tell me about one specific situation related to this topic."
		}
		return intro + "What would you clarify first about the scenario shown in your workspace?"
	}
	closing := "Let's leave this topic there. What would you like to ask before we wrap up?"
	if asked[closing] {
		return "Thank you for trying the demo. You can finish the session when you're ready."
	}
	if strings.Contains(last, "don't know") || strings.Contains(last, "move on") || strings.Contains(last, "skip this") {
		return closing
	}
	var probes []string
	if strings.Contains(req.System, "Workspace: system_design.") || strings.Contains(req.System, "Workspace: coding.") {
		switch {
		case strings.Contains(last, "database") || strings.Contains(last, "postgres") || strings.Contains(last, "sql"):
			probes = append(probes, "What failure would you plan for in that database?")
		case strings.Contains(last, "cache"):
			probes = append(probes, "How would you keep the cached data consistent?")
		case strings.Contains(last, "queue") || strings.Contains(last, "kafka"):
			probes = append(probes, "What ordering does your queue need to preserve?")
		}
	}
	probes = append(probes, "What evidence supports that choice?", "What is the main uncertainty that remains?")
	for _, probe := range probes {
		if !asked[probe] {
			return probe
		}
	}
	return closing
}

func mustJSON(v any) string {
	b, _ := json.Marshal(v)
	return string(b)
}
