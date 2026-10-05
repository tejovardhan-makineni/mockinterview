package main

import (
	"encoding/json"
	"github.com/tejo/mockinterview-api/internal/corpus"
	"github.com/tejo/mockinterview-api/internal/pack"
	"strings"
	"testing"
)

func TestPreviewContainsOnlyPublicFieldsAndResolvesEveryPackRound(t *testing.T) {
	cat, err := corpus.Load("../../data/corpus")
	if err != nil {
		t.Fatal(err)
	}
	packs, err := pack.Load("../../data/packs", cat)
	if err != nil {
		t.Fatal(err)
	}
	out := snapshot(cat, packs)
	if len(out.Questions) != cat.Count() || len(out.Packs) != packs.Count() {
		t.Fatal("bundled bank or practice paths are incomplete")
	}
	data, _ := json.Marshal(out)
	for _, private := range []string{"reference", "rubric", "interviewer_notes", "interviewer_definition", "format_definition", "guidance"} {
		if strings.Contains(string(data), `"`+private+`":`) {
			t.Fatalf("leaked %s", private)
		}
	}
	byID := map[string]corpus.Summary{}
	for _, q := range out.Questions {
		if _, seen := byID[q.ID]; seen {
			t.Fatalf("duplicate %s", q.ID)
		}
		byID[q.ID] = q
		original, _ := cat.Get(q.ID)
		if q.RoleTrack != original.RoleTrack || q.Difficulty != original.Difficulty {
			t.Fatalf("scope changed: %s", q.ID)
		}
	}
	for _, p := range out.Packs {
		for _, rd := range p.Rounds {
			id, ok := pack.PickQuestion(cat, p, rd)
			if _, present := byID[id]; !ok || !present {
				t.Fatalf("bundled round cannot resolve: %s/%s", p.ID, rd.ID)
			}
		}
	}
	for _, p := range out.Professions {
		primary, shared := 0, 0
		for _, q := range out.Questions {
			for i, area := range q.Areas {
				if area == p.Key {
					if i == 0 {
						primary++
					} else {
						shared++
					}
				}
			}
		}
		if p.PrimaryCount != primary || p.SharedCount != shared || p.Count != primary+shared {
			t.Fatalf("inflated catalog count: %+v", p)
		}
	}
	for _, id := range []string{"url-shortener", "lru-cache", "teacher-classroom", "sales-discovery", "law-issue-spotting-contract"} {
		if _, ok := byID[id]; !ok {
			t.Fatalf("missing showcase example %s", id)
		}
	}
}
