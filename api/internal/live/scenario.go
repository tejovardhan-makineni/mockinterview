package live

import (
	"encoding/json"
	"strings"

	"github.com/tejo/mockinterview-api/internal/corpus"
)

// Authored separately from the scored assignment. The legacy STAR briefs bundle
// situation/actions/results and their references contain aggressive interviewer
// scripts. Feeding both to a live model made it recite those scripts despite the
// shared pacing policy. The scorer and candidate's full assignment stay intact.
var storyOpenings = map[string]string{
	"behavioral-leadership-conflict":         "Tell me about a time you led a team through a serious conflict.",
	"behavioral-handling-failure":            "Tell me about a significant professional failure you experienced.",
	"behavioral-bias-for-action":             "Tell me about a time you had to make an important decision without all the information you wanted.",
	"behavioral-conflict-with-manager":       "Tell me about a time you disagreed with your manager on something that mattered.",
	"behavioral-scope-cut":                   "Tell me about a time you had to say no to a feature or request that people wanted.",
	"behavioral-dealing-with-ambiguity":      "Tell me about an ambiguous problem you were responsible for resolving.",
	"behavioral-mentoring":                   "Tell me about a time you helped someone develop professionally.",
	"behavioral-influence-without-authority": "Tell me about a time you needed to influence a team you had no authority over.",
	"behavioral-ownership":                   "Tell me about a time you took responsibility for a problem outside your assigned role.",
	"behavioral-customer-obsession":          "Tell me about a time you went beyond the usual expectations for a customer.",
	"behavioral-tight-deadline":              "Tell me about a time you faced an aggressive deadline for something important.",
	"behavioral-disagree-commit":             "Tell me about a decision you committed to despite initially disagreeing with it.",
}

func liveQuestion(q corpus.Question) corpus.Question {
	if opening, ok := storyOpenings[q.ID]; ok {
		q.Prompt = opening
		q.InterviewerNotes = ""
		q.Reference = nil
		q.Rubric = append([]corpus.RubricDim(nil), q.Rubric...)
		for i := range q.Rubric {
			// Descriptive labels retain the assessment areas; scoring prose and
			// exemplar stories do not belong in the live conversational script.
			q.Rubric[i].Description = ""
		}
	}
	return q
}

func firstQuestionFocus(q corpus.Question) string {
	if opening, ok := storyOpenings[q.ID]; ok {
		return opening
	}
	if q.ID == "mba-admissions" {
		return "What is motivating you to pursue an MBA at this point in your career?"
	}
	switch q.FormatID {
	case "ai-output-critique":
		return "What is your assessment of the AI's main claim?"
	case "work-sample-defense":
		return "What is the first concern you notice in the supplied artifact?"
	case "incident-simulation":
		return "What would you do first in this incident?"
	case "stakeholder-simulation":
		return "Invite the candidate to open the stakeholder conversation, then respond in character and wait."
	case "reverse-interview":
		return "What would you like to know about the role?"
	}
	switch q.Domain {
	case "coding", "system_design", "ml_system_design", "low_level_design":
		return "What would you clarify first about the problem?"
	case "clinical_reasoning", "prioritization":
		return "What would you assess first?"
	case "case":
		return "Where would you start investigating this problem?"
	default:
		return "What is your first step in approaching this scenario?"
	}
}

// Facts for the opening are separate from the request being elicited. In
// particular, "one question" must not turn into asking about a problem the
// voice candidate has not yet heard. Later variants remain in the full brief.
func firstQuestionSetup(q corpus.Question) string {
	if _, ok := storyOpenings[q.ID]; ok {
		return "The first situation invitation below establishes the behavioral topic; no separate scenario or STAR checklist is needed."
	}
	switch q.ID {
	case "two-sum-variants":
		return "Given an integer array nums and an integer target, find the indices of two numbers whose sum equals target. There is exactly one solution, and the same element may not be used twice. Introduce only Two Sum now; Three Sum is a later follow-up."
	case "ai-output-critique-forecast":
		return "An AI claims that new onboarding caused a 20% revenue increase and recommends rolling out to everyone. Its evidence is two monthly trial cohorts: May had 100 conversions from 1,000 trials; June had 120 from 1,000. June also introduced a new advertising channel. State these facts, without judging the claim or requesting missing evidence and a decision note yet."
	case "sql-review-retention":
		return "The query shown in the workspace measures day-7 retention: the fraction of a signup cohort with at least one event on calendar day 7 after signup, in UTC. The users table has one row per user; events may have multiple rows per user per day. Introduce that review context without reading every SQL line aloud or requesting both fixes and tests yet."
	case "work-sample-reservation-review":
		return "The inventory function shown in the workspace should accept positive integer requests and nonnegative integer stock, reject invalid inputs without changing stock, and return remaining stock plus whether the request was accepted. This is a code walkthrough without execution. Introduce that expected behavior without requesting tests and a fix yet."
	case "incident-triage-checkout":
		return "The candidate is on call. Checkout errors rose after a deployment, and support reports failed purchases. Further incident observations are available when requested."
	case "stakeholder-scope-negotiation":
		return "The client expects three promised features this month, but the team can safely deliver only two. You play the client lead; the candidate opens the conversation."
	case "candidate-questions-role-fit":
		return "This is the final part of a fictional interview with the hiring manager of a small product team. The candidate asks questions to understand role fit."
	default:
		return "Briefly state the primary problem from the candidate brief, including the inputs, outputs, essential constraints and facts needed to start. Present any code or diagram as the artifact visible in the workspace. Do not read later variants, probing checklists or all deliverables at once. Then ask the first focused question below."
	}
}

// The full reference remains available once, with all conditional facts and
// hypothetical variants intact. Only index the triggers here, rather than
// duplicating copyable, often multipart probe scripts a second time.
func probeTriggers(ref json.RawMessage) string {
	var material map[string]json.RawMessage
	if json.Unmarshal(ref, &material) != nil {
		return ""
	}
	var triggers []string
	for _, key := range []string{"deep_dives", "followup_bank", "probes"} {
		var probes []map[string]any
		if json.Unmarshal(material[key], &probes) != nil {
			continue
		}
		for _, probe := range probes {
			trigger, _ := probe["trigger"].(string)
			if trigger == "" {
				trigger, _ = probe["topic"].(string)
			}
			if trigger != "" {
				triggers = append(triggers, "- WHEN "+trigger)
			}
		}
	}
	return strings.Join(triggers, "\n")
}
