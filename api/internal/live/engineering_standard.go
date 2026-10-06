package live

import (
	"fmt"
	"strings"

	"github.com/tejo/mockinterview-api/internal/corpus"
)

// engineeringStandard calibrates technical practice, not an employer's hiring
// decision. The public sources and the boundaries of our level mapping are in
// docs/ADAPTIVE-INTERVIEWER.md. Shared behavioral/professional formats must keep
// their own rubric even when software engineers are among their audience.
func engineeringStandard(q corpus.Question) string {
	var domain string
	switch q.Domain {
	case "coding":
		domain = "CODING EVIDENCE: read the actual code for a correct executable solution, suitable data structures, time/space complexity, edge cases and meaningful tests. Assess robustness and clarity in the chosen language. Pseudocode can be a working draft; final implementation is real code when the task requests it. Static inspection is not execution: never claim tests ran or passed without tool results. Credit a correction immediately; do not keep probing a defect that is already fixed."
	case "system_design":
		domain = "SYSTEM DESIGN EVIDENCE: assess whether requirements, interfaces, data flow and component choices form a coherent practical system. Discuss relevant capacity, consistency, reliability, cost and failure tradeoffs in the candidate's actual proposal. A technology name or familiar diagram is not evidence of a working design. Do not force every possible topic into a single round."
	case "low_level_design":
		domain = "LOW-LEVEL DESIGN EVIDENCE: assess responsibilities, contracts, invariants, object or module interactions, testability and how the design handles a concrete change. Prefer the simplest design that meets the requirements. Do not require named design patterns, an acronym recital or unnecessary abstractions. Ask about an observed responsibility or consequence after the initial design is coherent."
	case "ml_system_design":
		domain = "ML SYSTEM DESIGN EVIDENCE: assess the problem objective, data and label assumptions, evaluation choices, training/serving boundaries and a workable feedback loop. Examine relevant leakage, drift, reliability, latency and cost risks in the actual proposal. Accept a simpler non-ML alternative when justified; do not turn architecture practice into a memorized model or framework quiz."
	default:
		return ""
	}

	level := strings.TrimSpace(q.Settings.TargetLevel)
	if level == "" {
		level = q.Difficulty
	}
	var scope string
	switch level {
	case "entry":
		scope = "ENTRY SCOPE: focus on fundamentals in a bounded problem: understanding the task, reasoning through a valid approach, producing a correct basic solution and checking representative cases. Study and project experience are valid evidence. Do not demand production ownership, organizational influence or senior-scale architecture."
	case "junior":
		scope = "JUNIOR SCOPE: focus on sound fundamentals and ownership of a bounded implementation: clear reasoning, correct behavior, sensible structure, basic complexity and relevant tests. Look for the candidate's own decisions and self-correction without demanding senior-scale architecture or cross-team leadership."
	case "mid":
		scope = "MID SCOPE: expect independent feature or component decisions, an implementable solution and justified tradeoffs. Within this task, assess testing, integration, operation and security where relevant, including how the component fits the surrounding system. Seek concrete reasoning about the candidate's own choices, not a list of practices."
	case "senior":
		scope = "SENIOR SCOPE: expect a system-wide view, robust and maintainable solutions, consequential operational failure handling and clear ownership of technical tradeoffs. Look for how other engineers can safely extend, test and operate the design. Assess depth in the selected task; senior coding still requires correct code, not an unsolicited architecture interview."
	case "staff":
		scope = "STAFF SCOPE: this is broader-scope practice, not an official Amazon level equivalence. Where the selected task supports it, examine ambiguous requirements, boundaries across systems or teams, migration and operational risks, durable technical direction and evidence for competing tradeoffs. Keep a coding round grounded in correct code; do not invent cross-organization requirements."
	default:
		// Custom free-text levels are meaningful to their authored brief. Do not
		// turn an unfamiliar level into an implicit mid or senior assessment.
		scope = "CUSTOM LEVEL SCOPE: use the configured target level and authored brief without guessing an equivalence to a standard software role. Keep expectations within this task and its explicit rubric."
	}

	challenge := "CHALLENGE SCOPE: standard uses the authored problem scope."
	switch q.Settings.Challenge {
	case "foundation":
		challenge = "CHALLENGE SCOPE: foundation narrows the problem and makes its requirements clearer; it does not lower the configured target level or grant unrequested solution hints."
	case "stretch":
		challenge = "CHALLENGE SCOPE: stretch may introduce one relevant additional constraint after the core work is coherent; it does not silently raise the configured target level."
	}
	return fmt.Sprintf(`SOFTWARE ENGINEERING PRACTICE STANDARD:
Use the authored rubric and configured target level, informed by public software-interview preparation guidance. This is our practice calibration, not Amazon's private hiring rubric, an employer affiliation or a prediction of hiring outcomes. Different rounds assess different competencies; do not transplant a whole interview loop into this task.
%s
%s
%s
EVIDENCE BEFORE PROBING: credit finalized speech and the latest code or design together. Let the candidate clarify and finish their approach without announcing a checklist. Probe only a consequential unresolved gap after a natural handover; accept alternative valid solutions. Missing evidence is unassessed, not proof of inability. After sufficient evidence, or the existing follow-up limit, move on without demanding perfection.
`, scope, challenge, domain)
}
