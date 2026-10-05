package corpus

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestRoleScopeValidationAndSnapshot(t *testing.T) {
	cat, err := Load("../../data/corpus")
	if err != nil {
		t.Fatal(err)
	}
	q, _ := cat.Get("url-shortener")
	for _, level := range []string{"entry", "junior", "mid", "senior", "staff", "principal", "manager", "senior_manager", "director", "vp", "executive"} {
		q.Difficulty = level
		for _, track := range []string{"", "individual_contributor", "management", "executive"} {
			q.RoleTrack = track
			if err := Validate(q); err != nil {
				t.Fatalf("%s/%s: %v", track, level, err)
			}
		}
	}
	q.RoleTrack = "leadership"
	if Validate(q) == nil {
		t.Fatal("unknown role track accepted")
	}
	q.RoleTrack, q.Difficulty = "management", "unknown"
	if Validate(q) == nil {
		t.Fatal("unknown seniority accepted")
	}
	q.Difficulty = "director"
	encoded, _ := json.Marshal(q)
	var frozen Question
	if err := json.Unmarshal(encoded, &frozen); err != nil {
		t.Fatal(err)
	}
	configured := ApplySessionConfig(frozen, json.RawMessage(`{"target_level":"vp","role_track":"executive"}`))
	if configured.Settings.TargetLevel != "vp" || configured.Settings.RoleTrack != "executive" || frozen.RoleTrack != "management" {
		t.Fatal("authored and session scopes were conflated")
	}
	if Fingerprint(configured) != Fingerprint(frozen) {
		t.Fatal("session settings altered authored fingerprint")
	}
	inherited := ApplySessionConfig(frozen, nil)
	if inherited.Settings.RoleTrack != "management" || inherited.Settings.TargetLevel != "director" {
		t.Fatal("authored defaults lost")
	}
	safe, _ := json.Marshal(configured.Summary())
	var fields map[string]json.RawMessage
	_ = json.Unmarshal(safe, &fields)
	if string(fields["role_track"]) != `"management"` {
		t.Fatal("public summary lost authored role scope")
	}
	for _, field := range []string{"reference", "rubric", "interviewer_notes", "format_definition", "interviewer_definition"} {
		if _, ok := fields[field]; ok {
			t.Fatalf("public summary leaked %s", field)
		}
	}
	frozen.RoleTrack = ""
	if ApplySessionConfig(frozen, nil).Settings.RoleTrack != "" {
		t.Fatal("missing track became IC")
	}
	safe, _ = json.Marshal(frozen.Summary())
	if strings.Contains(string(safe), "role_track") {
		t.Fatal("legacy summary invented a track")
	}
}

func TestProfessionCountsSeparatePrimaryAndShared(t *testing.T) {
	cat := &Catalog{order: []string{"primary", "shared", "other"}, byID: map[string]Question{
		"primary": {Areas: []string{"software_engineering", "data_science"}, Track: "engineering"},
		"shared":  {Areas: []string{"career_foundations", "software_engineering", "data_science"}, Track: "professional"},
		"other":   {Areas: []string{"data_science"}, Track: "professional"},
	}}
	for _, p := range cat.Professions() {
		if p.PrimaryCount+p.SharedCount != p.Count {
			t.Fatalf("double counted %s", p.Key)
		}
		switch p.Key {
		case "software_engineering":
			if p.Count != 2 || p.PrimaryCount != 1 || p.SharedCount != 1 {
				t.Fatalf("wrong software counts: %+v", p)
			}
		case "data_science":
			if p.Count != 3 || p.PrimaryCount != 1 || p.SharedCount != 2 {
				t.Fatalf("wrong data counts: %+v", p)
			}
		}
	}
}

func TestCatalogRoleFilterDoesNotInferLegacyScope(t *testing.T) {
	cat := &Catalog{order: []string{"manager", "legacy", "principal"}, byID: map[string]Question{
		"manager":   {ID: "manager", RoleTrack: "management", Difficulty: "director", Areas: []string{"software_engineering"}},
		"legacy":    {ID: "legacy", Difficulty: "senior", Areas: []string{"software_engineering"}},
		"principal": {ID: "principal", RoleTrack: "individual_contributor", Difficulty: "principal", Areas: []string{"software_engineering"}},
	}}
	for _, tc := range []struct {
		track, want string
		status      int
	}{
		{"management", "manager", 200}, {"unspecified", "legacy", 200}, {"individual_contributor", "principal", 200}, {"leader", "", 400},
	} {
		recorder := httptest.NewRecorder()
		NewService(cat).List(recorder, httptest.NewRequest("GET", "/questions?role_track="+tc.track, nil))
		if recorder.Code != tc.status {
			t.Fatalf("%s: %d", tc.track, recorder.Code)
		}
		if tc.status != 200 {
			continue
		}
		var summaries []Summary
		if err := json.Unmarshal(recorder.Body.Bytes(), &summaries); err != nil {
			t.Fatal(err)
		}
		if len(summaries) != 1 || summaries[0].ID != tc.want {
			t.Fatalf("wrong scope for %s: %+v", tc.track, summaries)
		}
	}
}

func TestLegacySnapshotDoesNotInheritNewCatalogMetadata(t *testing.T) {
	current := Question{ID: "same-question", Title: "New title", RoleTrack: "individual_contributor", Difficulty: "principal", LearningDrills: []Drill{{ID: "new-drill"}}, InterviewerDefinition: &InterviewerProfile{ID: "new-profile"}}
	cat := &Catalog{order: []string{current.ID}, byID: map[string]Question{current.ID: current}}
	legacy := Question{ID: current.ID, Title: "Saved title", Difficulty: "senior"}
	snapshot, _ := json.Marshal(legacy)
	restored, ok := cat.ResolveSnapshot(current.ID, snapshot)
	if !ok || restored.Title != "Saved title" || restored.RoleTrack != "" || restored.Difficulty != "senior" || restored.InterviewerDefinition != nil || len(restored.LearningDrills) != 0 {
		t.Fatalf("legacy snapshot inherited new fields: %+v", restored)
	}
	configured := ApplySessionConfig(restored, json.RawMessage(`{"target_level":"senior"}`))
	if configured.Settings.RoleTrack != "" {
		t.Fatal("legacy restore invented role scope")
	}
	noSnapshot, ok := cat.ResolveSnapshot(current.ID, nil)
	if !ok || noSnapshot.Title != current.Title || noSnapshot.RoleTrack != current.RoleTrack {
		t.Fatal("attempt without a snapshot lost its catalog fallback")
	}
}
