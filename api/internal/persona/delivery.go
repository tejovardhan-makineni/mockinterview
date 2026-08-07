package persona

import (
	"fmt"
	"strings"
)

// Delivery is HOW an interviewer speaks a line: the words, plus a
// natural-language STYLE directive that Gemini native TTS honours to modulate
// tone and pace. It is composed purely from the interviewer config — face (the
// person), voice (the timbre), personality (temperament) and intensity
// (pressure) — so the SAME rules drive both the Settings voice-and-face preview
// and the live interview intro. Everything expressive is data in this one file:
// change a map here and delivery changes everywhere. This is the modular seam.
type Delivery struct {
	Line  string // the words spoken
	Style string // TTS style directive (tone + pace), prepended for Gemini
}

// TTSPrompt is what we hand Gemini native TTS: a leading style instruction it
// applies, followed by the line to speak.
func (d Delivery) TTSPrompt() string {
	if strings.TrimSpace(d.Style) == "" {
		return d.Line
	}
	return "Say this " + d.Style + ": " + d.Line
}

// facePersona is the on-camera person behind a face id: a name and a short
// self-descriptor used to build a first-person introduction.
type facePersona struct{ name, role string }

var facePersonas = map[string]facePersona{
	"sophia":  {"Sophia", "one of the engineers on the panel"},
	"marcus":  {"Marcus", "a senior engineer here"},
	"richard": {"Richard", "a staff engineer, and I'll be your interviewer today"},
}

func personaFor(faceID string) facePersona {
	if p, ok := facePersonas[faceID]; ok {
		return p
	}
	if f, ok := FaceByID(faceID); ok {
		return facePersona{f.Label, "your interviewer today"}
	}
	return facePersona{"your interviewer", "on the panel"}
}

// toneFor maps a personality to a spoken tone. To add a personality, add it to
// the Personalities catalog and give it a tone here.
func toneFor(personality string) string {
	switch personality {
	case "supportive":
		return "in a warm, friendly, encouraging tone"
	case "interruptive":
		return "in a brisk, direct, probing tone"
	case "annoying":
		return "in an impatient, clipped, mildly skeptical tone"
	default: // neutral / unknown
		return "in a calm, professional, even tone"
	}
}

// paceFor maps intensity 1..5 to delivery energy.
func paceFor(intensity int) string {
	switch {
	case intensity <= 1:
		return "speaking slowly and relaxed"
	case intensity == 2:
		return "at an easy, unhurried pace"
	case intensity == 3:
		return "at a natural pace"
	case intensity == 4:
		return "speaking briskly, with energy"
	default: // 5+
		return "speaking quickly and with high energy"
	}
}

// lineFor composes the WORDS — one short, punchy line (kept brief so the preview
// synthesises fast and plays quickly), distinct per personality, nudged by
// intensity, in first person from the face's persona.
func lineFor(p facePersona, personality string, intensity int) string {
	switch personality {
	case "supportive":
		if intensity <= 2 {
			return fmt.Sprintf("Hi, I'm %s — really glad you're here. No rush; let's just have a good conversation.", p.name)
		}
		return fmt.Sprintf("Hi, I'm %s — glad you're here. We've a fair bit to cover, so let's dive in.", p.name)
	case "interruptive":
		if intensity >= 4 {
			return fmt.Sprintf("I'm %s. I run a tight interview and I'll jump in fast — so keep it sharp. Ready?", p.name)
		}
		return fmt.Sprintf("I'm %s. Heads-up: I'll interrupt with follow-ups the moment something's worth digging into.", p.name)
	case "annoying":
		if intensity >= 4 {
			return fmt.Sprintf("%s. Let's be efficient — no fluff, no hand-waving. Show me you know your stuff.", p.name)
		}
		return fmt.Sprintf("%s here. I want specifics, not hand-waving — give me those and we'll get along fine.", p.name)
	default: // neutral
		if intensity >= 4 {
			return fmt.Sprintf("Hello, I'm %s, %s. Let's move at a good clip and get straight into it.", p.name, p.role)
		}
		return fmt.Sprintf("Hello, I'm %s, %s. I'll keep this professional and let your answers speak for themselves.", p.name, p.role)
	}
}

// NormalizeVoiceID / NormalizeFaceID / NormalizePersonalityID coerce a
// (possibly empty or unknown) id from a request to a valid catalog id, falling
// back to the catalog default. They keep delivery composition total — it always
// has a real interviewer to work with.
func NormalizeVoiceID(id string) string {
	if ValidVoice(id) {
		return id
	}
	return DefaultVoiceID()
}

func NormalizeFaceID(id string) string {
	if ValidFace(id) {
		return id
	}
	return DefaultFaceID()
}

func NormalizePersonalityID(id string) string {
	if ValidPersonality(id) {
		return id
	}
	return DefaultPersonalityID()
}

// PreviewDelivery composes the Settings voice-and-face preview: what the chosen
// interviewer says, and how they say it, from the full interviewer config. The
// voice id is not spoken as a name — it selects the timbre at synthesis time.
func PreviewDelivery(voiceID, faceID, personality string, intensity int) Delivery {
	_ = voiceID // timbre is applied at synthesis, not in the words
	return Delivery{
		Line:  lineFor(personaFor(faceID), personality, intensity),
		Style: toneFor(personality) + ", " + paceFor(intensity),
	}
}
