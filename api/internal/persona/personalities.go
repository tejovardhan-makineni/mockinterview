package persona

// Personality is an interviewer demeanor the candidate can select. Everything
// about a demeanor lives on this struct: the client-facing Blurb AND the
// Directive that shapes the director's system prompt (read by internal/live).
// To add a demeanor, append ONE entry here — no other file changes.
type Personality struct {
	ID        string `json:"id"`
	Label     string `json:"label"`
	Blurb     string `json:"blurb"`
	Directive string `json:"-"` // instruction fragment injected into the interviewer's system prompt
}

// Personalities is the catalog of selectable interviewer demeanors. The FIRST
// entry is the default a brand-new user gets (see DefaultPersonalityID), so the
// balanced/professional "neutral" persona leads — a stress/adversarial style is
// never the default and is offered only as an explicit opt-in (HR-8).
var Personalities = []Personality{
	{ID: "neutral", Label: "Balanced", Blurb: "Professional and even — closest to a typical real interview. Recommended default.",
		Directive: "You are balanced and professional. Neither warm nor cold. You give little away."},
	{ID: "supportive", Label: "Supportive", Blurb: "Warm and encouraging; nudges you when you're stuck.",
		Directive: "You are warm and encouraging. Offer a gentle hint if the candidate is stuck for a while. Acknowledge good points."},
	{ID: "interruptive", Label: "Interruptive", Blurb: "Probes hard and barges in on gaps, like a senior bar-raiser.",
		Directive: "You interrupt frequently with pointed follow-ups the moment the candidate touches something worth probing. You do not let them monologue."},
	{ID: "annoying", Label: "Stress (practice)", Blurb: "Optional stress-practice style: deliberately terse and pressuring to help you rehearse composure. This is a training mode, not how most real interviews go.",
		Directive: "You are running an OPT-IN stress-practice interview to help the candidate rehearse composure under pressure. You are impatient and skeptical: push back hard, express mild frustration at vagueness, and demand specifics. Never be abusive or personal — this is a demanding practice style, not hostility."},
}

// Directive returns the interviewer prompt fragment for a personality id, with a
// balanced-professional fallback for unknown ids.
func Directive(id string) string {
	if p, ok := PersonalityByID(id); ok && p.Directive != "" {
		return p.Directive
	}
	return "You are balanced and professional."
}

// Catalog defaults are the first entry of each list — the single source of truth
// for what a brand-new user gets. store.DefaultConfig and the live relay both
// read these instead of hardcoding ids.
func DefaultVoiceID() string {
	if len(Voices) > 0 {
		return Voices[0].ID
	}
	return "aoede"
}

func DefaultFaceID() string {
	if len(Faces) > 0 {
		return Faces[0].ID
	}
	return "alex"
}

func DefaultPersonalityID() string {
	if len(Personalities) > 0 {
		return Personalities[0].ID
	}
	return "neutral"
}

// PersonalityByID returns the catalog entry and whether it was found.
func PersonalityByID(id string) (Personality, bool) {
	for _, p := range Personalities {
		if p.ID == id {
			return p, true
		}
	}
	return Personality{}, false
}

// ValidPersonality reports whether id is a known personality.
func ValidPersonality(id string) bool {
	_, ok := PersonalityByID(id)
	return ok
}
