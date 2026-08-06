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
	GeminiName string `json:"-"`
}

// Voices is the catalog served to clients. To add a voice, append one line.
var Voices = []Voice{
	{ID: "aoede", Label: "Aoede", Gender: "female", GeminiName: "Aoede"},
	{ID: "kore", Label: "Kore", Gender: "female", GeminiName: "Kore"},
	{ID: "leda", Label: "Leda", Gender: "female", GeminiName: "Leda"},
	{ID: "charon", Label: "Charon", Gender: "male", GeminiName: "Charon"},
	{ID: "fenrir", Label: "Fenrir", Gender: "male", GeminiName: "Fenrir"},
	{ID: "orus", Label: "Orus", Gender: "male", GeminiName: "Orus"},
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
