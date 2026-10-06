package corpus

import (
	"encoding/json"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
)

func TestCandidateBriefIsTheOnlyPublicPrompt(t *testing.T) {
	q := Question{ID: "private-facts", Title: "Design a service", Prompt: "PRIVATE requirement: 5 million events per second. PRIVATE later variant.", CandidateBrief: "Design an event collection service.", Reference: json.RawMessage(`{"answer":"PRIVATE solution"}`), InterviewerNotes: "PRIVATE assessor notes"}
	cat := &Catalog{byID: map[string]Question{q.ID: q}, order: []string{q.ID}}
	svc := NewService(cat)
	router := chi.NewRouter()
	router.Get("/questions", svc.List)
	router.Get("/questions/{id}", svc.Get)
	for _, path := range []string{"/questions", "/questions/private-facts"} {
		t.Run(path, func(t *testing.T) {
			response := httptest.NewRecorder()
			router.ServeHTTP(response, httptest.NewRequest("GET", path, nil))
			if response.Code != 200 {
				t.Fatalf("status %d: %s", response.Code, response.Body.String())
			}
			if strings.Contains(response.Body.String(), "PRIVATE") {
				t.Fatalf("private assignment leaked: %s", response.Body.String())
			}
			if !strings.Contains(response.Body.String(), q.CandidateBrief) {
				t.Fatal("missing public task")
			}
		})
	}
	frozen, _ := json.Marshal(q)
	if !strings.Contains(string(frozen), q.Prompt) || !strings.Contains(string(frozen), q.CandidateBrief) {
		t.Fatal("private assignment and authored opening must both remain in frozen server snapshots")
	}
	if q.Summary().Prompt != q.CandidateBrief || q.Summary().CandidateBrief != q.CandidateBrief {
		t.Fatal("unsafe public projection")
	}
}

func TestTechnicalCorpusHasAuthoredBriefsWithoutChangingOtherAssignments(t *testing.T) {
	cat, err := Load("../../data/corpus")
	if err != nil {
		t.Fatal(err)
	}
	technical := 0
	for _, summary := range cat.List("", "", "") {
		q, _ := cat.Get(summary.ID)
		switch q.Domain {
		case "coding", "system_design", "low_level_design", "ml_system_design":
			technical++
			if strings.TrimSpace(q.CandidateBrief) == "" || summary.Prompt != q.CandidateBrief {
				t.Errorf("%s: technical task needs an authored opening", q.ID)
			}
			if q.Prompt == "" {
				t.Errorf("%s: lost private assignment", q.ID)
			}
		default:
			if summary.Prompt != q.Prompt {
				t.Errorf("%s: nontechnical facts or artifacts were changed", q.ID)
			}
		}
	}
	if technical < 73 {
		t.Fatalf("lost technical coverage: %d", technical)
	}
	for id, required := range map[string][]string{
		"two-sum-variants":           {"indices", "Exactly one solution", "same element cannot be used twice"},
		"number-of-islands":          {"up, down, left, or right", "not diagonally", "surrounded by water"},
		"min-meeting-rooms":          {"start when another ends"},
		"kth-largest-element":        {"Count duplicate values separately"},
		"word-break":                 {"Dictionary words may be reused"},
		"lru-cache":                  {"O(1)", "Reading, inserting, or updating", "-1"},
		"design-search-autocomplete": {"descending frequency", "ASCII lexicographic order", "increments its count"},
	} {
		q, _ := cat.Get(id)
		for _, fact := range required {
			if !strings.Contains(q.PublicBrief(), fact) {
				t.Errorf("%s: missing core semantic %q", id, fact)
			}
		}
	}
	for id, hidden := range map[string]string{"two-sum-variants": "3-Sum", "coin-change": "DISTINCT COMBINATIONS", "word-break": "trie", "llm-inference-gateway": "KV-cache"} {
		q, _ := cat.Get(id)
		if !strings.Contains(q.Prompt, hidden) || strings.Contains(q.PublicBrief(), hidden) {
			t.Errorf("%s: later variant or solution checklist must stay private", id)
		}
	}
}

func TestCandidateBriefValidationAndMockProjection(t *testing.T) {
	cat, err := Load("../../data/corpus")
	if err != nil {
		t.Fatal(err)
	}
	q, _ := cat.Get("url-shortener")
	for _, bad := range []string{"   ", strings.Repeat("x", 2001)} {
		q.CandidateBrief = bad
		if Validate(q) == nil {
			t.Fatal("invalid candidate brief accepted")
		}
	}
	raw, err := os.ReadFile("../../../web/lib/features/catalog-preview.json")
	if err != nil {
		t.Fatal(err)
	}
	var preview struct {
		Questions []Summary `json:"questions"`
	}
	if err := json.Unmarshal(raw, &preview); err != nil {
		t.Fatal(err)
	}
	for _, item := range preview.Questions {
		q, exists := cat.Get(item.ID)
		if !exists {
			t.Fatalf("unknown mock scenario %s", item.ID)
		}
		if item.Prompt != q.PublicBrief() || item.CandidateBrief != q.CandidateBrief {
			t.Errorf("%s: bundled mock prompt differs from public corpus projection", item.ID)
		}
	}
}
