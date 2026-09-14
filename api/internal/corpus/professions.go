package corpus

import (
	"net/http"
	"sort"

	"github.com/tejo/mockinterview-api/internal/httpx"
)

// ValidArea reports whether a is a known profession/area. Exported so other
// packages (e.g. pack validation) can check profession keys.
func ValidArea(a string) bool {
	_, ok := professionRegistry[a]
	return ok
}

// ProfessionLabel returns the human label for a profession key (or the key).
func ProfessionLabel(key string) string {
	if p, ok := professionRegistry[key]; ok {
		return p.Label
	}
	return key
}

// Profession is a profession present in the corpus with its question count and
// the tracks it appears under. The client uses this to gate the catalog + build
// the onboarding/settings profession picker (backend is the source of truth).
type Profession struct {
	Key         string           `json:"key"`
	Label       string           `json:"label"`
	Family      string           `json:"family"`
	FamilyLabel string           `json:"family_label"`
	Aliases     []string         `json:"aliases"`
	Agent       InterviewerAgent `json:"agent"`
	Count       int              `json:"count"`
	Tracks      []string         `json:"tracks"`
}

// Professions returns every profession present in the loaded corpus, with a
// question count and the set of tracks it spans, sorted by count desc then key.
func (c *Catalog) Professions() []Profession {
	counts := map[string]int{}
	tracks := map[string]map[string]bool{}
	for _, id := range c.order {
		q := c.byID[id]
		for _, a := range q.Areas {
			counts[a]++
			if tracks[a] == nil {
				tracks[a] = map[string]bool{}
			}
			if q.Track != "" {
				tracks[a][q.Track] = true
			}
		}
	}
	out := make([]Profession, 0, len(counts))
	for key, n := range counts {
		ts := make([]string, 0, len(tracks[key]))
		for t := range tracks[key] {
			ts = append(ts, t)
		}
		sort.Strings(ts)
		definition := professionRegistry[key]
		out = append(out, Profession{
			Key: key, Label: definition.Label, Family: definition.Family,
			FamilyLabel: professionFamilies[definition.Family], Aliases: append([]string{}, definition.Aliases...),
			Agent: definition.Profile.Agent(), Count: n, Tracks: ts,
		})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Count != out[j].Count {
			return out[i].Count > out[j].Count
		}
		return out[i].Key < out[j].Key
	})
	return out
}

// ListProfessions serves the profession catalog for gating + onboarding.
func (s *Service) ListProfessions(w http.ResponseWriter, r *http.Request) {
	httpx.WriteJSON(w, http.StatusOK, s.cat.Professions())
}
