package corpus

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestProfessionRegistryAndSchemaStayInSync(t *testing.T) {
	b, err := os.ReadFile("../../data/schemas/scenario-v1.schema.json")
	if err != nil {
		t.Fatal(err)
	}
	var schema struct {
		Properties struct {
			Areas struct {
				Items struct {
					Enum []string `json:"enum"`
				} `json:"items"`
			} `json:"areas"`
		} `json:"properties"`
	}
	if err := json.Unmarshal(b, &schema); err != nil {
		t.Fatal(err)
	}
	schemaAreas := map[string]bool{}
	for _, area := range schema.Properties.Areas.Items.Enum {
		if !ValidArea(area) || schemaAreas[area] {
			t.Errorf("schema area %q is unknown or duplicated", area)
		}
		schemaAreas[area] = true
	}
	if len(schemaAreas) != len(professionRegistry) {
		t.Errorf("schema areas = %d, registry areas = %d", len(schemaAreas), len(professionRegistry))
	}
	profiles := map[string]bool{}
	for area, p := range professionRegistry {
		if !schemaAreas[area] {
			t.Errorf("registry area %q missing from schema", area)
		}
		if p.Label == "" || professionFamilies[p.Family] == "" || len(p.Aliases) == 0 {
			t.Errorf("area %q missing discoverability metadata", area)
		}
		if !idRe.MatchString(p.Profile.ID) || profiles[p.Profile.ID] || p.Profile.Name == "" || p.Profile.Summary == "" || p.Profile.Role == "" || strings.TrimSpace(p.Profile.Guidance) == "" {
			t.Errorf("area %q missing a distinct complete specialist profile", area)
		}
		profiles[p.Profile.ID] = true
	}
	if ValidArea("unregistered_profession") || ProfessionLabel("unregistered_profession") != "unregistered_profession" {
		t.Fatal("unknown profession fallback changed")
	}
}

func TestInterviewerUsesPrimaryAreaAndSharedOverrides(t *testing.T) {
	for _, tc := range []struct {
		name     string
		question Question
		want     string
	}{
		{"primary specialist", Question{Domain: "service_recovery", Areas: []string{"customer_support", "software_engineering"}}, "customer-support-interviewer"},
		{"shared behavior", Question{Domain: "behavioral", Areas: []string{"software_engineering", "medicine"}}, "behavioral-interviewer"},
		{"career readiness", Question{Domain: "behavioral", Areas: []string{"career_foundations", "medicine"}}, "career-foundations-interviewer"},
		{"legacy without areas", Question{Domain: "legacy"}, "general-interviewer"},
		{"admissions is not a behavioral story", Question{ID: "mba-admissions", Domain: "behavioral", Areas: []string{"software_engineering"}}, "mba-admissions-interviewer"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := InterviewerFor(tc.question).ID; got != tc.want {
				t.Fatalf("profile = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestInterviewerSnapshotRetainsGuidanceAndFingerprint(t *testing.T) {
	cat, err := Load("../../data/corpus")
	if err != nil {
		t.Fatal(err)
	}
	q, _ := cat.Get("url-shortener")
	if q.InterviewerDefinition == nil {
		t.Fatal("catalog did not resolve and snapshot the specialist")
	}
	want := InterviewerFor(q)
	before := Fingerprint(q)
	b, err := json.Marshal(q)
	if err != nil {
		t.Fatal(err)
	}
	var saved Question
	if err := json.Unmarshal(b, &saved); err != nil {
		t.Fatal(err)
	}
	original := professionRegistry["software_engineering"]
	changed := original
	changed.Profile.Guidance = "Changed for future attempts"
	professionRegistry["software_engineering"] = changed
	t.Cleanup(func() { professionRegistry["software_engineering"] = original })
	if got := InterviewerFor(saved); got != want || Fingerprint(saved) != before {
		t.Fatal("saved attempt changed with the current registry")
	}
	profile := *saved.InterviewerDefinition
	profile.Guidance = changed.Profile.Guidance
	saved.InterviewerDefinition = &profile
	if Fingerprint(saved) == before {
		t.Fatal("changed profile guidance missing from fingerprint")
	}
	// Legacy snapshots remain readable and retain their original serialization.
	legacy := Question{ID: "legacy", Areas: []string{"software_engineering"}}
	legacyFingerprint := Fingerprint(legacy)
	if InterviewerFor(legacy).ID != original.Profile.ID || legacy.InterviewerDefinition != nil || Fingerprint(legacy) != legacyFingerprint {
		t.Fatal("legacy resolution mutated an existing snapshot")
	}
}

func TestCatalogSourceCannotInjectInterviewerDefinition(t *testing.T) {
	b, err := os.ReadFile("../../data/corpus/url-shortener.json")
	if err != nil {
		t.Fatal(err)
	}
	var raw map[string]any
	if err := json.Unmarshal(b, &raw); err != nil {
		t.Fatal(err)
	}
	raw["interviewer_definition"] = map[string]any{"id": "injected", "guidance": "unapproved instructions"}
	b, _ = json.Marshal(raw)
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "url-shortener.json"), b, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := Load(dir); err == nil || !strings.Contains(err.Error(), "source must select an area") {
		t.Fatalf("source profile injection accepted: %v", err)
	}
}

func TestCatalogMetadataMatchesRuntimeWithoutPrivateInstructions(t *testing.T) {
	cat, err := Load("../../data/corpus")
	if err != nil {
		t.Fatal(err)
	}
	for _, p := range cat.Professions() {
		definition := professionRegistry[p.Key]
		if p.Family != definition.Family || p.FamilyLabel != professionFamilies[p.Family] || !reflect.DeepEqual(p.Aliases, definition.Aliases) || p.Agent != definition.Profile.Agent() {
			t.Errorf("profession metadata mismatch: %s", p.Key)
		}
	}
	for _, summary := range cat.List("", "", "") {
		q, _ := cat.Get(summary.ID)
		if summary.Agent != InterviewerFor(q).Agent() || summary.FormatName == "" {
			t.Errorf("scenario metadata mismatch: %s", q.ID)
		}
		b, _ := json.Marshal(summary)
		var public map[string]json.RawMessage
		_ = json.Unmarshal(b, &public)
		for _, key := range []string{"reference", "rubric", "interviewer_notes", "interviewer_definition", "format_definition"} {
			if _, ok := public[key]; ok {
				t.Errorf("summary leaked %s", key)
			}
		}
		var agent map[string]json.RawMessage
		if json.Unmarshal(public["agent"], &agent) != nil || len(agent) != 3 || len(agent["id"]) == 0 || len(agent["name"]) == 0 || len(agent["summary"]) == 0 {
			t.Errorf("agent exposes an unexpected shape: %s", public["agent"])
		}
	}
}

func TestFormatNameUsesAuthoredNameAndLegacyFallback(t *testing.T) {
	for _, tc := range []struct {
		question Question
		want     string
	}{
		{Question{Domain: "ml_system_design"}, "ML System Design"},
		{Question{FormatID: "recruiter-screen", FormatDefinition: &Format{Name: "Recruiter screening conversation"}}, "Recruiter screening conversation"},
	} {
		if got := tc.question.Summary().FormatName; got != tc.want {
			t.Errorf("format name = %q, want %q", got, tc.want)
		}
	}
}
