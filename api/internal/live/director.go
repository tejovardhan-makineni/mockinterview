// Package live implements the interview "director": the brain that decides how
// the AI interviewer behaves. It assembles the system instruction (persona +
// intensity + the question's rubric/deep-dives + current phase objective +
// live canvas/workspace context) and produces interviewer turns. The Gemini
// Live WebSocket relay (transport) is layered on top of this in relay.go.
package live

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/tejo/mockinterview-api/internal/corpus"
	"github.com/tejo/mockinterview-api/internal/llm"
	personapkg "github.com/tejo/mockinterview-api/internal/persona"
)

// Phases + NextPhase describe the interview's intended arc and are a SEAM for
// explicit phase progression. Today the relay seeds the prompt with the "intro"
// phase and lets the Gemini Live model pace the conversation naturally within
// it (using the per-phase objectives below as guidance), so NextPhase is not yet
// driven in production — don't assume the stored session phase advances.
var Phases = []string{
	"intro", "requirements", "estimation", "hld", "api", "lld",
	"deepdive", "scaling", "reliability", "observability", "security", "wrap",
}

// phaseObjective tells the interviewer what to accomplish in each phase.
var phaseObjective = map[string]string{
	"intro":         "Warmly greet the candidate and invite them to introduce themselves in a sentence, then move into the interview. Keep it to one short line — do NOT ask about resume projects here unless this is an engineering interview.",
	"requirements":  "Get the candidate to gather functional and non-functional requirements. Probe for missing clarifying questions.",
	"estimation":    "Push for concrete back-of-the-envelope numbers: QPS, storage, bandwidth, read/write ratio. Check the math.",
	"hld":           "Have them sketch the high-level design on the canvas. Ask them to walk the read and write paths.",
	"api":           "Probe the API/interface design.",
	"lld":           "Probe the data model / low-level objects and why they chose them.",
	"deepdive":      "Interrupt on specific components they placed. Use the deep-dive probes. This is where you separate strong from weak candidates.",
	"scaling":       "Push on how the design scales: sharding, replication, caching, bottlenecks.",
	"reliability":   "Probe failure modes, replication, failover, graceful degradation.",
	"observability": "Ask about metrics, logging, tracing, and alerting.",
	"security":      "Ask about security, abuse, and privacy concerns.",
	"wrap":          "Wrap up: ask them to summarize tradeoffs and what they'd do with more time.",
}

// engineeringGuidance is one shared professional-engineering blurb used for the
// discipline-specific engineering domains (mechanical/electrical/civil), which
// all share the same rigor expectations. Keyed to each such domain below.
const engineeringGuidance = "Professional engineering interview: have the candidate state assumptions and the governing principles/equations FIRST, set the problem up with a clear sketch (free-body / circuit / system diagram) before computing, then work it QUANTITATIVELY with correct units and sanity-checked magnitudes. Probe where each number comes from, the design constraints and safety factors, and the trade-offs behind their choices. Don't accept a plugged-in formula without the assumptions behind it; let them reason out loud."

const behavioralGuidance = "Conversational behavioral interview: invite one specific situation related to the selected topic, then listen to the story. STAR is a private evidence guide, never a checklist to read aloud or a required answer order. Concrete personal actions satisfy ownership; do not ask for those actions again merely to seek more detail. An outcome satisfies the result dimension, including a meaningful qualitative outcome. Follow up only on a material missing element. When the story is complete, a useful new question explores a distinct judgment or competency rather than requesting actions, results or reflection already supplied. Completing one story does not end the interview while there is useful time for a new question. Do not demand invented numbers, a replacement example after an exhausted gap, or particular pronouns. Apply the DELIVERY DECISION to choose the next turn."

const mbaGuidance = "MBA admissions conversation about career motivation, goals and program fit. Follow the candidate's reasoning one topic at a time; this is not a mandatory STAR story sequence."

// domainGuidance gives per-domain expectations + pacing so each interview type
// is run distinctly, not as a generic interview. Keys are the corpus `domain`
// strings (see internal/corpus). director_test.go asserts every corpus domain is
// covered here OR carries its own interviewer_notes, so guidance can't silently
// die for a domain (it once did: these keys had drifted from the real corpus).
var domainGuidance = map[string]string{
	// Software / technical.
	"system_design":    "Let them drive: requirements → back-of-envelope estimates → high-level design → data model/API → deep dives (bottlenecks, scaling, failure, CDC, caching) → tradeoffs. Give them long stretches to draw on the whiteboard. Don't rush; go deep on one or two areas rather than skimming everything.",
	"ml_system_design": "As system design, but center it on ML infra: data/feature pipeline, training vs serving, evaluation, drift/monitoring, feedback loops. Probe eval and drift specifically.",
	"low_level_design": "Object-oriented design: expect classes, responsibilities, relationships, and design patterns. Probe SOLID and extensibility ('how would you add feature X?'). Let them sketch a class diagram.",
	"coding":           "Pace: clarify the problem → discuss approach → implement → verify correctness and complexity. These are separate conversation steps, not a checklist to ask at once. Let the candidate work and self-correct. Review the current code for real correctness or complexity issues, then choose one significant uncertainty to probe with a neutral request to trace or test their code. Do not reveal the bug, its location, the fix, or a better algorithm in simulation mode. If the code has changed, reassess it before asking; never repeat a stale bug probe after a valid correction. If they remain stuck, apply the shared follow-up limit and move to another useful assessment area.",
	"behavioral":       behavioralGuidance,
	// Medicine.
	"clinical_reasoning": "Clinical reasoning: structured history → differential (life-threatening causes FIRST) → targeted investigations → management → safety-netting. Do not accept jumping to treatment without a differential.",
	"medical_residency":  "MMI-style: assess ethical reasoning, empathy, communication, and structure. Present the station scenario and probe how they'd act and why; look for balanced perspectives.",
	// Nursing.
	"prioritization": "Prioritization + patient safety (ABCs), escalation, and delegation. Probe what they'd do first and why.",
	// Law.
	"legal_practice": "IRAC discipline: issue-spotting → rule → application → conclusion, and press for counterarguments. For written, expect a structured memo.",
	"issue_spotting": "IRAC discipline: issue-spotting → rule → application → conclusion, and press for counterarguments. For written, expect a structured memo.",
	// Consulting.
	"case": "Expect an upfront STRUCTURE/framework before diving in, a hypothesis, and QUANTITATIVE reasoning. Provide case data (numbers) when asked. Push back on 'bigger is better' with 'how would you structure this?'.",
	// Product.
	"product_sense": "Product sense: user + problem + prioritization + metrics + tradeoffs. Push for a crisp target user and how they'd measure success.",
	// Finance.
	"valuation": "Expect a clear framework (e.g. DCF steps), explicit assumptions, quantitative rigor, and sensible judgment. Ask for sensitivities.",
	// Data science.
	"experimentation": "Experiment/statistical rigor: problem framing, experiment design, validity threats, interpretation. Probe metrics and confounders.",
	// Professional-engineering disciplines (mechanical/electrical/civil) — shared blurb.
	"thermodynamics":    engineeringGuidance,
	"mechanics":         engineeringGuidance,
	"mechanical_design": engineeringGuidance,
	"structural":        engineeringGuidance,
	"geotechnical":      engineeringGuidance,
	"transportation":    engineeringGuidance,
	"circuits":          engineeringGuidance,
	"power_systems":     engineeringGuidance,
	"signals_systems":   engineeringGuidance,
}

// Section is one phase of the sectioned interview. The interview runs as ONE
// continuous voice session, but the interviewer's "brain" specializes per
// section: the relay drives progression on time and the SystemPrompt lays out
// the whole plan so the model knows the arc and how to behave in each part.
type Section struct {
	Share    float64
	ID       string
	Title    string
	Kind     string
	Guidance string
}

// sectionTitle is the human-facing title shown per section kind (surfaced to the
// browser as the `section` event title).
var sectionTitle = map[string]string{
	"intro":      "Intro & warm-up",
	"resume":     "Resume deep-dive",
	"coding":     "Coding",
	"lld":        "Low-level design",
	"design":     "System design",
	"behavioral": "Behavioral",
	"clinical":   "Clinical reasoning",
	"case":       "Case",
	"core":       "Main question",
	"wrap":       "Wrap-up",
}

// sectionGuidance is the specialized interviewer brain per section KIND. Each
// entry tells the interviewer how to behave while that section is active. The
// relay injects the active section's guidance as a live directive on transition,
// and SystemPrompt lists them all so the model knows the arc up front.
var sectionGuidance = map[string]string{
	"intro":      "Open warmly: greet the candidate, say your name, ONE bit of genuine small talk, and let them give a short self-introduction. Keep it light and human — no interview question yet. React naturally to what they say.",
	"resume":     "Deep-dive ONE project they're genuinely proud of. Probe their INDIVIDUAL contribution ('what was YOUR part, specifically?'), the key decisions they made and why, and the tradeoffs they weighed. Ask 1-2 varied, specific follow-ups drawn from THEIR answer. VARY your questions every run — do not fall back on the same stock resume questions; make each one fit what they actually said. If their answer is thin, evasive, or a joke, ask ONE genuine follow-up to draw out the real story before moving on.",
	"coding":     "Let the candidate explain their approach and work in the editor. Review their latest code, allowing self-correction before selecting one significant correctness or complexity issue. Ask one neutral testing or reasoning question without disclosing a bug or fix in simulation mode. Credit a valid correction immediately; do not repeat resolved probes. Respect the shared follow-up limit if progress stops.",
	"lld":        "Let the candidate explain classes, interfaces and relationships. Select one or two important design choices for depth; a newly mentioned component is not automatically a reason to interrupt or start another probe sequence. Ask about one unresolved aspect of a specific choice at a time, such as responsibility or extensibility. Credit explanations already given and move on when there is enough evidence or the gap's follow-ups are exhausted.",
	"design":     "Let them drive requirements → estimates → high-level design → data model/API → deep dives, with room to draw. Select one or two important choices for depth from what they actually propose. If they mention a queue, cache and database together, choose one high-value unresolved aspect rather than probing every component. Ask one focused question, credit reasoning already given, and move on when there is enough evidence or the gap's follow-ups are exhausted.",
	"behavioral": behavioralGuidance,
	"clinical":   "Structured clinical reasoning: history → differential (life-threatening causes FIRST) → targeted investigations → management → safety-netting, or MMI-style ethical/communication probing for a station scenario. Do not accept jumping to treatment without a differential; probe the 'why' behind each step.",
	"case":       "Expect an upfront STRUCTURE/framework before diving in, a clear hypothesis, and QUANTITATIVE reasoning. Provide case data (numbers) when they ask. Push back on hand-waving with 'how would you structure this?' and make them show the math.",
	"core":       "Run the main question in a domain-appropriate, structured way. Let the candidate drive; probe their reasoning, choices, and tradeoffs one question at a time, and go deep on the highest-signal areas rather than skimming.",
	"wrap":       "Wind down: ask 'Before we wrap up, do you have any questions for me?' and STOP. WAIT for their reply and answer each question briefly and naturally (silently note the quality of what they ask). Only once they clearly have no more questions, thank them warmly and wish them well, THEN call the end_interview function.",
}

// coreKind maps a corpus question's domain to the CORE section kind.
func coreKind(domain string) string {
	switch domain {
	case "coding":
		return "coding"
	case "low_level_design":
		return "lld"
	case "system_design", "ml_system_design":
		return "design"
	case "behavioral":
		return "behavioral"
	case "clinical_reasoning", "medical_residency":
		return "clinical"
	case "prioritization":
		return "clinical"
	case "case":
		return "case"
	default:
		return "core"
	}
}

// SectionPlan builds the ordered interview plan: intro → (resume if hasResume) →
// CORE (derived from the question's domain) → wrap. Each section carries the
// specialized guidance for its kind. A non-empty roundFocus (e.g. from a company
// pack round) is appended as extra emphasis to the CORE section only.
func SectionPlan(q corpus.Question, hasResume bool, roundFocus string) []Section {
	if q.FormatDefinition != nil {
		plan := make([]Section, 0, len(q.FormatDefinition.Stages))
		for _, stage := range q.FormatDefinition.Stages {
			guidance := stage.Guidance
			if stage.Kind != "intro" && stage.Kind != "wrap" && roundFocus != "" {
				guidance += " Round focus: " + roundFocus
			}
			plan = append(plan, Section{ID: stage.ID, Title: stage.Title, Kind: stage.Kind, Guidance: guidance, Share: stage.Share})
		}
		return plan
	}
	mk := func(id, kind string) Section {
		return Section{ID: id, Title: sectionTitle[kind], Kind: kind, Guidance: sectionGuidance[kind]}
	}
	plan := []Section{mk("intro", "intro")}
	if hasResume && q.Domain != "medical_residency" && (q.Settings.Minutes == 0 || q.Settings.Minutes >= 15) {
		plan = append(plan, mk("resume", "resume"))
	}
	ck := coreKind(q.Domain)
	core := mk("core", ck)
	if q.ID == "mba-admissions" {
		core.Kind, core.Title, core.Guidance = "core", "MBA admissions", mbaGuidance
	}
	if rf := strings.TrimSpace(roundFocus); rf != "" {
		core.Guidance = strings.TrimSpace(core.Guidance) + " EXTRA EMPHASIS FOR THIS ROUND: " + rf
	}
	plan = append(plan, core)
	plan = append(plan, mk("wrap", "wrap"))
	return plan
}

// personaTone combines the persona's directive (owned by the persona catalog)
// with the selected intensity. Adding a personality is a one-line edit in
// internal/persona/personalities.go — its Directive flows through here.
func personaTone(persona string, intensity int) string {
	base := personapkg.Directive(persona)
	level := "moderate"
	switch {
	case intensity <= 2:
		level = "low — give the candidate room to think"
	case intensity >= 4:
		level = "high — keep the pressure on and move briskly"
	}
	return fmt.Sprintf("%s Interview intensity is %s.", base, level)
}

// interviewerRole returns the human role/title the interviewer plays, tailored
// to the interview's field — so a software station is run by an engineer and a
// clinical station by a physician, matching the candidate's selected area.
func interviewerRole(q corpus.Question) string {
	if q.FormatDefinition != nil {
		return q.FormatDefinition.InterviewerRole
	}
	// Behavioral is a shared station across every field; keep the role neutral.
	if q.Domain == "behavioral" {
		return "a hiring manager who has run hundreds of interviews"
	}
	area := ""
	if len(q.Areas) > 0 {
		area = q.Areas[0]
	}
	switch area {
	case "software_engineering":
		if q.Domain == "ml_system_design" {
			return "a senior machine-learning engineer"
		}
		return "a senior software engineer who interviews candidates often"
	case "mechanical_engineering":
		return "a senior mechanical engineer"
	case "electrical_engineering":
		return "a senior electrical engineer"
	case "civil_engineering":
		return "a senior civil and structural engineer"
	case "data_science":
		return "a senior data scientist"
	case "medicine":
		return "an attending physician who supervises trainees"
	case "nursing":
		return "a senior charge nurse and preceptor"
	case "law":
		return "a partner at a law firm"
	case "consulting":
		return "an engagement manager at a consulting firm"
	case "product_management":
		return "a senior product manager"
	case "finance":
		return "a senior finance professional"
	case "ux_design":
		return "a design lead"
	case "sales":
		return "a sales hiring manager"
	case "marketing":
		return "a marketing lead"
	case "human_resources":
		return "a people operations lead"
	case "education":
		return "an experienced educator"
	}
	return "an experienced interviewer in this field"
}

// SystemPrompt builds the full interviewer system instruction for a session.
// resumeSummary and canvasContext may be empty. voice is the selected voice id;
// the interviewer takes that voice's name as their own (e.g. "Charon").
func SystemPrompt(q corpus.Question, persona string, intensity int, phase, resumeSummary, canvasContext string, durationMin int, voice, language string, sections []Section, roundFocus string) string {
	return buildSystemPrompt(q, persona, intensity, phase, resumeSummary, canvasContext, durationMin, voice, language, sections, roundFocus)
}

// extractProbes pulls deep_dives / followup_bank / probes questions out of the
// modality-specific reference blob for the interviewer to draw on.
func extractProbes(ref json.RawMessage) string {
	if len(ref) == 0 {
		return ""
	}
	var m map[string]json.RawMessage
	if err := json.Unmarshal(ref, &m); err != nil {
		return ""
	}
	var out []string
	collect := func(key, field string) {
		raw, ok := m[key]
		if !ok {
			return
		}
		var arr []map[string]any
		if json.Unmarshal(raw, &arr) != nil {
			return
		}
		for _, it := range arr {
			if q, ok := it[field].(string); ok && q != "" {
				trigger, _ := it["trigger"].(string)
				if trigger == "" {
					trigger, _ = it["topic"].(string)
				}
				if trigger == "" {
					trigger = "when relevant to the candidate response"
				}
				out = append(out, "- WHEN "+trigger+": "+q)
			}
		}
	}
	collect("deep_dives", "probe")
	collect("followup_bank", "question")
	collect("probes", "question")
	var follows []string
	if json.Unmarshal(m["follow_ups"], &follows) == nil {
		for _, q := range follows {
			out = append(out, "- WHEN relevant and not previously covered: "+q)
		}
	}
	return strings.Join(out, "\n")
}

// NextTurn produces the interviewer's next spoken line given the conversation so
// far. Used for the text/stub director and any non-voice modality. The Live
// voice relay uses SystemPrompt directly with Gemini's audio model.
func NextTurn(ctx context.Context, ai llm.Client, model, system string, history []llm.Message) (string, error) {
	if len(history) == 0 {
		// Gemini requires at least one content turn even with a system prompt.
		// Keep kickoff aligned with the authored format instead of adding rapport.
		history = []llm.Message{{Role: "user", Text: openingInstruction}}
	}
	return ai.Generate(ctx, llm.GenerateRequest{
		Purpose:     llm.PurposeDirector,
		Model:       model,
		System:      system,
		Messages:    history,
		Temperature: 0.7,
		MaxTokens:   200,
	})
}

// NextPhase returns the phase after the given one (or "wrap" at the end),
// skipping phases that don't apply to the modality.
func NextPhase(modality, current string) string {
	skip := map[string]map[string]bool{
		"coding":         {"estimation": true, "hld": true, "api": true, "scaling": true, "observability": true},
		"conversational": {"estimation": true, "hld": true, "api": true, "lld": true, "scaling": true, "observability": true, "security": true},
		"written":        {"estimation": true, "hld": true, "api": true, "lld": true, "scaling": true, "observability": true},
	}[modality]

	idx := -1
	for i, p := range Phases {
		if p == current {
			idx = i
			break
		}
	}
	for i := idx + 1; i < len(Phases); i++ {
		if skip != nil && skip[Phases[i]] {
			continue
		}
		return Phases[i]
	}
	return "wrap"
}
