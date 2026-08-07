// Package persona holds the swappable catalogs that define the interviewer's
// presentation: voices, faces (3D avatars), and personalities. Each catalog is
// a single self-contained file — adding or changing a voice/face/personality
// means editing one file here and nothing else. The rest of the app looks these
// up through the exported registries and validators.
package persona

// Voice is a Gemini native-audio prebuilt voice offered to the candidate.
// GeminiName is the provider-side voice name used by the Live and TTS APIs; it
// is not serialized to clients (they only ever send/receive our stable ID).
type Voice struct {
	ID         string `json:"id"`
	Label      string `json:"label"`
	Gender     string `json:"gender"`
	Sample     string `json:"sample"` // the unique line spoken in the voice preview
	GeminiName string `json:"-"`
}

// Voices is the catalog served to clients. Each carries a UNIQUE, personable
// preview line (a name, a place, a bit of character) so "hear this interviewer"
// feels distinct per voice — not a vanilla greeting. To add a voice, append one.
var Voices = []Voice{
	{ID: "aoede", Label: "Aoede", Gender: "female", GeminiName: "Aoede",
		Sample: "Hi, I'm Aoede — I flew in from Lisbon this morning, running on three espressos and mild jet lag. Let's see what you've got."},
	{ID: "kore", Label: "Kore", Gender: "female", GeminiName: "Kore",
		Sample: "Hey there, Kore here, dialing in from a very rainy Seattle. Fun fact: I have never lost a staring contest. Shall we begin?"},
	{ID: "leda", Label: "Leda", Gender: "female", GeminiName: "Leda",
		Sample: "Hello! Leda, live from Buenos Aires. I promise to be tough but fair — okay, mostly fair. Ready when you are."},
	{ID: "charon", Label: "Charon", Gender: "male", GeminiName: "Charon",
		Sample: "Hey, Charon speaking, straight out of Chicago. I like strong coffee and even stronger system designs. Let's dig in."},
	{ID: "fenrir", Label: "Fenrir", Gender: "male", GeminiName: "Fenrir",
		Sample: "What's up — I'm Fenrir, Reykjavik born, which explains the cold takes. Don't worry, I only bite bad assumptions."},
	{ID: "orus", Label: "Orus", Gender: "male", GeminiName: "Orus",
		Sample: "Greetings, Orus here from Bangalore. My hobbies include long walks and short feedback loops. Let's do this."},
}

// SampleLine returns the preview line for a voice id (default if unknown).
func SampleLine(id string) string {
	if v, ok := VoiceByID(id); ok && v.Sample != "" {
		return v.Sample
	}
	return "Hi, I'm your interviewer. Let's start — tell me a bit about yourself and a project you're proud of."
}

// DefaultVoiceGeminiName is used when an unknown id is requested.
const DefaultVoiceGeminiName = "Aoede"

// VoiceByID returns the catalog entry and whether it was found.
func VoiceByID(id string) (Voice, bool) {
	for _, v := range Voices {
		if v.ID == id {
			return v, true
		}
	}
	return Voice{}, false
}

// ValidVoice reports whether id is a known voice.
func ValidVoice(id string) bool {
	_, ok := VoiceByID(id)
	return ok
}

// GeminiVoiceName maps our voice id to the provider voice name, falling back to
// the default when the id is unknown.
func GeminiVoiceName(id string) string {
	if v, ok := VoiceByID(id); ok {
		return v.GeminiName
	}
	return DefaultVoiceGeminiName
}
