package persona

import "testing"

func TestValidVoice(t *testing.T) {
	if !ValidVoice("aoede") {
		t.Error("aoede should be a valid voice")
	}
	if ValidVoice("nope") {
		t.Error("unknown voice should be invalid")
	}
}

func TestGeminiVoiceNameFallback(t *testing.T) {
	if got := GeminiVoiceName("charon"); got != "Charon" {
		t.Errorf("charon -> %q, want Charon", got)
	}
	if got := GeminiVoiceName("does-not-exist"); got != DefaultVoiceGeminiName {
		t.Errorf("unknown voice -> %q, want fallback %q", got, DefaultVoiceGeminiName)
	}
}

func TestValidFace(t *testing.T) {
	if !ValidFace("sophia") {
		t.Error("sophia should be a valid face")
	}
	if ValidFace("ghost") {
		t.Error("unknown face should be invalid")
	}
}

func TestValidPersonality(t *testing.T) {
	for _, id := range []string{"supportive", "neutral", "interruptive", "annoying"} {
		if !ValidPersonality(id) {
			t.Errorf("%q should be a valid personality", id)
		}
	}
	if ValidPersonality("chaotic") {
		t.Error("unknown personality should be invalid")
	}
}

// Every face must carry a kind the client understands.
func TestFacesHaveKnownKind(t *testing.T) {
	for _, f := range Faces {
		if f.Kind != "human" && f.Kind != "fun" && f.Kind != "realistic" {
			t.Errorf("face %q has unexpected kind %q", f.ID, f.Kind)
		}
	}
}
