package persona

// Language is a locale the app UI and the interviewer can run in. Code is the
// stable id stored/sent (ISO-639-ish). Label is the endonym shown in the picker.
// Name is the English name used in LLM prompts (director + translation). Adding
// a language is one line here.
type Language struct {
	Code  string `json:"code"`
	Label string `json:"label"`
	Name  string `json:"name"`
}

// Languages is the offered set. English is first (the source language — app copy
// is authored in English and translated from it).
var Languages = []Language{
	{"en", "English", "English"},
	{"es", "Español", "Spanish"},
	{"fr", "Français", "French"},
	{"de", "Deutsch", "German"},
	{"pt", "Português", "Portuguese"},
	{"hi", "हिन्दी", "Hindi"},
	{"zh", "中文", "Chinese (Simplified)"},
	{"ja", "日本語", "Japanese"},
	{"ar", "العربية", "Arabic"},
}

// DefaultLanguageCode is the source language; app copy is authored in it.
func DefaultLanguageCode() string { return "en" }

// LanguageByCode returns the catalog entry and whether it was found.
func LanguageByCode(code string) (Language, bool) {
	for _, l := range Languages {
		if l.Code == code {
			return l, true
		}
	}
	return Language{}, false
}

// ValidLanguage reports whether code is an offered language.
func ValidLanguage(code string) bool {
	_, ok := LanguageByCode(code)
	return ok
}

// NormalizeLanguage coerces a (possibly empty/unknown) code to a valid one,
// falling back to the default source language.
func NormalizeLanguage(code string) string {
	if ValidLanguage(code) {
		return code
	}
	return DefaultLanguageCode()
}

// LanguageName returns the English name of a language (for prompts), defaulting
// to English.
func LanguageName(code string) string {
	if l, ok := LanguageByCode(code); ok {
		return l.Name
	}
	return "English"
}
