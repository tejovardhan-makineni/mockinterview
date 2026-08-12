package pack

import (
	"testing"

	"github.com/tejo/mockinterview-api/internal/corpus"
)

func loadAll(t *testing.T) (*corpus.Catalog, *Catalog) {
	t.Helper()
	cc, err := corpus.Load("../../data/corpus")
	if err != nil {
		t.Fatalf("corpus load: %v", err)
	}
	pc, err := Load("../../data/packs", cc)
	if err != nil {
		t.Fatalf("pack load: %v", err)
	}
	return cc, pc
}

// TestLoadSeededPacks ensures every seeded pack loads + validates against the
// real corpus, and the expected seed ids are present.
func TestLoadSeededPacks(t *testing.T) {
	_, pc := loadAll(t)
	want := []string{"amazon", "faang-generic", "google", "mbb-consulting", "medicine-mmi", "meta"}
	for _, id := range want {
		if _, ok := pc.Get(id); !ok {
			t.Errorf("expected seed pack %q to be loaded", id)
		}
	}
	if pc.Count() < len(want) {
		t.Errorf("expected at least %d packs, got %d", len(want), pc.Count())
	}
}

// TestResolveRoundEveryRound checks that every round of every pack resolves to a
// concrete, existing corpus question whose (domain, modality) match the round.
func TestResolveRoundEveryRound(t *testing.T) {
	cc, pc := loadAll(t)
	svc := NewService(cc, pc, nil)
	for _, p := range pc.All() {
		for _, rd := range p.Rounds {
			qid, focus, ok := svc.ResolveRound(p.ID, rd.ID)
			if !ok {
				t.Errorf("%s/%s: ResolveRound not ok", p.ID, rd.ID)
				continue
			}
			if focus != rd.Focus {
				t.Errorf("%s/%s: focus = %q, want %q", p.ID, rd.ID, focus, rd.Focus)
			}
			q, ok := cc.Get(qid)
			if !ok {
				t.Errorf("%s/%s: resolved question %q not in corpus", p.ID, rd.ID, qid)
				continue
			}
			if q.Domain != rd.Domain || q.Modality != rd.Modality {
				t.Errorf("%s/%s: resolved %q is (%s,%s), round is (%s,%s)",
					p.ID, rd.ID, qid, q.Domain, q.Modality, rd.Domain, rd.Modality)
			}
		}
	}
}

// TestPickQuestionDeterministic verifies PickQuestion returns the same id on
// repeated calls for a pooled round.
func TestPickQuestionDeterministic(t *testing.T) {
	cc, pc := loadAll(t)
	p, ok := pc.Get("amazon")
	if !ok {
		t.Fatal("amazon pack missing")
	}
	var coding Round
	for _, rd := range p.Rounds {
		if rd.ID == "coding-1" {
			coding = rd
		}
	}
	if coding.ID == "" {
		t.Fatal("coding-1 round missing")
	}
	first, ok := PickQuestion(cc, p, coding)
	if !ok {
		t.Fatal("PickQuestion not ok")
	}
	for i := 0; i < 20; i++ {
		got, ok := PickQuestion(cc, p, coding)
		if !ok || got != first {
			t.Fatalf("PickQuestion not deterministic: got %q, want %q", got, first)
		}
	}
	// A pooled round must prefer its declared difficulty.
	if q, _ := cc.Get(first); q.Difficulty != coding.Difficulty {
		t.Errorf("PickQuestion difficulty = %q, want %q", q.Difficulty, coding.Difficulty)
	}
}

// TestPickQuestionPinned verifies a question_id round returns exactly that id.
func TestPickQuestionPinned(t *testing.T) {
	cc, pc := loadAll(t)
	p, ok := pc.Get("medicine-mmi")
	if !ok {
		t.Fatal("medicine-mmi pack missing")
	}
	for _, rd := range p.Rounds {
		if rd.QuestionID == "" {
			continue
		}
		got, ok := PickQuestion(cc, p, rd)
		if !ok || got != rd.QuestionID {
			t.Errorf("%s: pinned pick = %q (ok=%v), want %q", rd.ID, got, ok, rd.QuestionID)
		}
	}
}

// TestListProfession verifies profession filtering.
func TestListProfession(t *testing.T) {
	_, pc := loadAll(t)
	all := pc.List("")
	if len(all) != pc.Count() {
		t.Errorf("List(\"\") = %d, want all %d", len(all), pc.Count())
	}
	swe := pc.List("software_engineering")
	if len(swe) == 0 {
		t.Fatal("expected software_engineering packs")
	}
	for _, p := range swe {
		found := false
		for _, a := range p.Areas {
			if a == "software_engineering" {
				found = true
			}
		}
		if !found {
			t.Errorf("pack %q returned for software_engineering but lacks the area", p.ID)
		}
	}
	// consulting filter should return mbb-consulting and not amazon.
	con := pc.List("consulting")
	ids := map[string]bool{}
	for _, p := range con {
		ids[p.ID] = true
	}
	if !ids["mbb-consulting"] {
		t.Error("expected mbb-consulting in consulting list")
	}
	if ids["amazon"] {
		t.Error("did not expect amazon in consulting list")
	}
}
