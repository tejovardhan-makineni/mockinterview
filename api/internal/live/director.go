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

// Phases + NextPhase are legacy fine-grained planning helpers. Runtime progress
// follows SectionPlan, with semantic advances and scheduled timing cues. The
// relay persists that section as "section:<id>"; it does not drive NextPhase.
var Phases = []string{
	"intro", "requirements", "estimation", "hld", "api", "lld",
	"deepdive", "scaling", "reliability", "observability", "security", "wrap",
}

// phaseObjective tells the interviewer what to accomplish in each phase.
var phaseObjective = map[string]string{
	"intro":         "Warmly greet the candidate and invite them to introduce themselves in a sentence, then move into the interview. Keep it to one short line — do NOT ask about resume projects here unless this is an engineering interview.",
	"requirements":  "Observe whether the candidate independently gathers functional and non-functional requirements. Answer only the clarification asked and wait. Do not prompt them to ask clarifying questions.",
	"estimation":    "Push for concrete back-of-the-envelope numbers: QPS, storage, bandwidth, read/write ratio. Check the math.",
	"hld":           "Have them sketch the high-level design on the canvas. Ask them to walk the read and write paths.",
	"api":           "Probe the API/interface design.",
	"lld":           "Probe the data model / low-level objects and why they chose them.",
	"deepdive":      "After the candidate finishes a coherent proposal, select one or two unresolved design choices for depth. Ask neutral questions without revealing techniques, and give the floor back between probes.",
	"scaling":       "Push on how the design scales: sharding, replication, caching, bottlenecks.",
	"reliability":   "Probe failure modes, replication, failover, graceful degradation.",
	"observability": "Ask about metrics, logging, tracing, and alerting.",
	"security":      "Ask about security, abuse, and privacy concerns.",
	"wrap":          "Wrap up: ask them to summarize tradeoffs and what they'd do with more time.",
}

// engineeringGuidance is one shared professional-engineering blurb used for the
// discipline-specific engineering domains (mechanical/electrical/civil), which
// all share the same rigor expectations. Keyed to each such domain below.
const engineeringGuidance = "Professional engineering interview: present the engineering task and allow uninterrupted reasoning, sketching and calculation. Privately assess assumptions, governing principles, units, magnitudes, constraints and safety factors without prescribing their order or naming the desired equation. Read their latest working and credit valid methods and corrections. After a coherent solution, select one consequential uncertainty or tradeoff to discuss; do not quiz them at every calculation step."

const behavioralGuidance = "Conversational behavioral interview: invite one specific situation related to the selected topic, then listen to the story. STAR is a private evidence guide, never a checklist to read aloud or a required answer order. Concrete personal actions satisfy ownership; do not ask for those actions again merely to seek more detail. An outcome satisfies the result dimension, including a meaningful qualitative outcome. Follow up only on a material missing element. When the story is complete, a useful new question explores a distinct judgment or competency rather than requesting actions, results or reflection already supplied. Completing one story does not end the interview while there is useful time for a new question. Do not demand invented numbers, a replacement example after an exhausted gap, or particular pronouns. Apply the DELIVERY DECISION to choose the next turn."

const mbaGuidance = "MBA admissions conversation about career motivation, goals and program fit. Follow the candidate's reasoning one topic at a time; this is not a mandatory STAR story sequence."

// domainGuidance gives per-domain expectations + pacing so each interview type
// is run distinctly, not as a generic interview. Keys are the corpus `domain`
// strings (see internal/corpus). director_test.go asserts every corpus domain is
// covered here OR carries its own interviewer_notes, so guidance can't silently
// die for a domain (it once did: these keys had drifted from the real corpus).
var domainGuidance = map[string]string{
	// Software / technical.
	"system_design":    "Let them drive: requirements → back-of-envelope estimates → high-level design → data model/API → deep dives (bottlenecks, scaling, failure, CDC, caching) → tradeoffs. State the problem without asking what they would clarify. Answer only the facts they request and wait. Let them finish a coherent proposal, including long stretches to draw on the whiteboard. Do not treat an unfinished sketch or a named component as permission to probe. Don't rush; go deep on one or two areas rather than skimming everything.",
	"ml_system_design": "Candidate-led ML design: let them develop the data, training and serving system before discussing it. Privately assess evaluation, drift and feedback alongside the actual requirements; do not announce this checklist or require every topic as a separate question. Review the current diagram and select only a consequential unresolved choice after their proposal is complete.",
	"low_level_design": "Let the candidate develop classes, responsibilities and interactions at their own pace. Evaluate whether the design meets the requirements and can evolve; do not demand a named pattern or recite SOLID. Discuss one concrete change or unresolved responsibility only after their initial design is complete, crediting explanations already given.",
	"coding":           "Let the candidate independently clarify, choose an approach, implement and verify their solution. These are private assessment priorities, not required conversation steps or a checklist to ask. Give them time to work and self-correct. Review the current code for real correctness or complexity issues, then choose one significant uncertainty to probe with a neutral request to trace or test their code. Do not reveal the bug, its location, the fix, or a better algorithm in simulation mode. If the code has changed, reassess it before asking; never repeat a stale bug probe after a valid correction. If they remain stuck, apply the shared follow-up limit and move to another useful assessment area.",
	"behavioral":       behavioralGuidance,
	// Medicine.
	"clinical_reasoning": "Present the fictional clinical problem and the candidate's role, then let them give a coherent clinical response. Privately assess history, differential, investigations, management and safety without coaching that sequence or revealing a diagnosis. Provide only requested findings that exist in the scenario. Credit reasoning already supplied; a follow-up should explore one material uncertainty, not walk through every rubric item.",
	"medical_residency":  "Run the authored MMI station in its assigned role. Listen to the candidate's complete response and assess judgment, empathy and communication privately. Do not dictate an ethics framework, prompt every perspective, or turn a patient interaction into an oral examination. Follow up selectively on a consequential gap after they finish.",
	// Nursing.
	"prioritization": "Present the fictional nursing situation and let the candidate prioritize and explain their response. Privately assess patient safety, escalation and delegation without suggesting ABCs or a diagnosis. Wait through their reasoning and ask about one material unresolved risk only after the response is complete.",
	// Law.
	"legal_practice": "Let the candidate analyze the supplied legal scenario or complete the written memo. Privately assess issue identification, applicable supplied rules, reasoning and conclusions without requiring IRAC wording or order. In an advocacy roleplay, remain in the assigned role and ask occasional focused questions at natural pauses; do not interrupt every point or invent law.",
	"issue_spotting": "Allow time to read, analyze and write a coherent response to the supplied legal scenario. Privately assess issues, rules, application and conclusions without teaching an answer framework. Review the current draft before selecting one material unresolved issue or counterargument; do not re-ask matters already addressed.",
	// Consulting.
	"case": "Present the business problem and let the candidate structure and investigate it independently. Answer only requested case facts, then return the floor for analysis and calculations. Privately assess structure, hypotheses and quantitative reasoning without prompting them. Wait for a coherent recommendation before selecting a consequential uncertainty; do not ask for a framework or calculation merely because it appears in the rubric.",
	// Product.
	"product_sense": "Let the candidate develop a coherent product proposal. Privately assess users, problem definition, priorities, metrics and tradeoffs without prescribing that checklist. Follow up on one significant unresolved decision after the proposal is complete, crediting evidence already volunteered.",
	// Finance.
	"valuation": "Give the candidate room to choose and execute a valuation approach, including calculations. Assess assumptions, quantitative rigor and judgment privately without naming a preferred method. After their recommendation, discuss one consequential uncertainty or sensitivity if it has not already been addressed.",
	// Data science.
	"experimentation": "Let the candidate frame and develop the experimental analysis before probing. Privately assess design, metrics, validity and interpretation without listing desired methods or confounders. Ask at most one consequential unresolved question after their explanation, and credit revisions to calculations or written work.",
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
// section: the relay combines semantic decisions with time boundaries, and the
// SystemPrompt lays out the ordered plan so the model knows the interview arc.
type Section struct {
	Share    float64
	ID       string
	Title    string
	Kind     string
	Guidance string
	// CandidateLed marks substantive code, design and written workspace stages,
	// including authored/custom stages whose generic kind is "core".
	CandidateLed bool
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
	"resume":     "Invite one relevant project or experience from the candidate's background, then listen to the complete account. Treat contribution, decisions, tradeoffs and outcomes as private evidence priorities, not a checklist or a required narrative order. Credit evidence already supplied regardless of pronouns. Follow up only on one consequential missing detail when needed; a complete account does not require extra probes. Respect requests to move on and do not infer evasiveness or poor competence from a brief answer.",
	"coding":     "Let the candidate explain their approach and work in the editor. Review their latest code, allowing self-correction before selecting one significant correctness or complexity issue. Ask one neutral testing or reasoning question without disclosing a bug or fix in simulation mode. Credit a valid correction immediately; do not repeat resolved probes. Respect the shared follow-up limit if progress stops.",
	"lld":        "Let the candidate explain classes, interfaces and relationships. Select one or two important design choices for depth; a newly mentioned component is not automatically a reason to interrupt or start another probe sequence. Ask about one unresolved aspect of a specific choice at a time, such as responsibility or extensibility. Credit explanations already given and move on when there is enough evidence or the gap's follow-ups are exhausted.",
	"design":     "State the problem and give the candidate the floor, without prompting requirements gathering. Let them independently drive requirements → estimates → high-level design → data model/API → deep dives. Wait while they build and explain a coherent proposal; a snapshot or named component is not a finished answer. Answer only each clarification asked and wait. Select one or two important choices for depth from what they actually propose. If they mention a queue, cache and database together, choose one high-value unresolved aspect rather than probing every component. Ask one neutral focused question only after they finish or invite feedback, credit reasoning already given, then return the floor. Use at most one or two areas for depth, not a continuous oral quiz.",
	"behavioral": behavioralGuidance,
	"clinical":   "Present the clinical or MMI station and allow a complete response in the assigned role. Privately assess reasoning, communication and safety; do not reveal a diagnosis or prescribe an answer sequence. Supply requested scenario findings and wait. After the response, clarify only a consequential unresolved point rather than examining every step.",
	"case":       "Let the candidate lead the case analysis and calculations. Answer only the case facts they ask for, then wait. Observe how they structure the problem independently; do not prompt a framework. Discuss one consequential unresolved point after a coherent proposal rather than asking for each analysis step.",
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
			plan = append(plan, Section{ID: stage.ID, Title: stage.Title, Kind: stage.Kind, Guidance: guidance, Share: stage.Share, CandidateLed: candidateLedWork(q, stage.Kind)})
		}
		return plan
	}
	mk := func(id, kind string) Section {
		return Section{ID: id, Title: sectionTitle[kind], Kind: kind, Guidance: sectionGuidance[kind], CandidateLed: candidateLedWork(q, kind)}
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

func candidateLedWork(q corpus.Question, kind string) bool {
	if kind == "intro" || kind == "resume" || kind == "wrap" {
		return false
	}
	return q.Modality == "coding" || q.Modality == "system_design" || q.Modality == "written"
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

// interviewerRole keeps the authored scenario role while the selected specialist
// supplies profession-specific assessment guidance independently of the format.
func interviewerRole(q corpus.Question) string {
	if q.FormatDefinition != nil {
		return q.FormatDefinition.InterviewerRole
	}
	return corpus.InterviewerFor(q).Role
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
	reply, err := ai.Generate(ctx, llm.GenerateRequest{
		Purpose:     llm.PurposeDirector,
		Model:       model,
		System:      system + "\nTEXT DELIVERY: If the delivery decision is to wait silently, return exactly [[WAIT]] with no other text. Otherwise return only the natural interviewer utterance. Never narrate waiting. This token is transport control, not speech.",
		Messages:    history,
		Temperature: 0.7,
		MaxTokens:   200,
	})
	if err != nil {
		return "", err
	}
	if strings.Contains(reply, textIdleSilence) {
		return "", nil
	}
	return reply, nil
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
