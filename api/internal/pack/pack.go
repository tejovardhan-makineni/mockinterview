// Package pack loads and serves company/goal "interview packs": ordered sets of
// rounds (e.g. Amazon's loop: behavioral, coding, coding, LLD, system design,
// bar-raiser) built on top of the corpus. Each round either pins a specific
// corpus question (question_id) or is a "pooled" round that resolves to a
// concrete corpus question deterministically at start time by matching
// (domain, modality, area) and preferring a difficulty.
//
// Packs never carry their own question content — they only reference the corpus
// — so a pack is valid only if every round can resolve to a real question.
package pack

import (
	"crypto/sha256"
	"encoding/binary"
	"fmt"
	"sort"
	"strings"

	"github.com/tejo/mockinterview-api/internal/corpus"
)

// Round is one stage of a pack's interview loop.
type Round struct {
	ID         string `json:"id"`
	Title      string `json:"title"`
	Kind       string `json:"kind"`     // free text: behavioral, coding, lld, system_design, bar_raiser, case, mmi, ...
	Domain     string `json:"domain"`   // corpus domain (coding, system_design, low_level_design, case, ...)
	Modality   string `json:"modality"` // corpus modality (coding, system_design, conversational, ...)
	Difficulty string `json:"difficulty"`
	Minutes    int    `json:"minutes"`
	QuestionID string `json:"question_id,omitempty"` // if set, pins this exact corpus question
	Focus      string `json:"focus,omitempty"`       // becomes the director round_focus
}

// Pack is an ordered interview loop for a company or goal.
type Pack struct {
	Revision     int      `json:"revision"`
	ReviewStatus string   `json:"review_status"`
	SourceNote   string   `json:"source_note"`
	ID           string   `json:"id"`
	Name         string   `json:"name"`
	Company      string   `json:"company,omitempty"`
	Blurb        string   `json:"blurb,omitempty"`
	Areas        []string `json:"areas"` // professions this pack targets (corpus areas)
	Track        string   `json:"track,omitempty"`
	Rounds       []Round  `json:"rounds"`
}

// Validate checks a pack against the corpus: every area is a valid profession,
// every round is well-formed and resolvable to a real corpus question, and
// round ids are unique within the pack.
func Validate(p Pack, cat *corpus.Catalog) error {
	if strings.TrimSpace(p.ID) == "" {
		return fmt.Errorf("pack id required")
	}
	if strings.TrimSpace(p.Name) == "" {
		return fmt.Errorf("%s: name required", p.ID)
	}
	if len(p.Areas) == 0 {
		return fmt.Errorf("%s: at least one area required", p.ID)
	}
	for _, a := range p.Areas {
		if !corpus.ValidArea(a) {
			return fmt.Errorf("%s: unknown area %q", p.ID, a)
		}
	}
	if len(p.Rounds) == 0 {
		return fmt.Errorf("%s: at least one round required", p.ID)
	}
	seen := map[string]bool{}
	for i, rd := range p.Rounds {
		if rd.Minutes < 3 || rd.Minutes > 90 {
			return fmt.Errorf("%s: round %q minutes must be 3..90", p.ID, rd.ID)
		}
		if rd.Difficulty != "" && rd.Difficulty != "entry" && rd.Difficulty != "junior" && rd.Difficulty != "mid" && rd.Difficulty != "senior" && rd.Difficulty != "staff" {
			return fmt.Errorf("%s: invalid round difficulty", p.ID)
		}
		if strings.TrimSpace(rd.ID) == "" {
			return fmt.Errorf("%s: round %d: id required", p.ID, i)
		}
		if seen[rd.ID] {
			return fmt.Errorf("%s: duplicate round id %q", p.ID, rd.ID)
		}
		seen[rd.ID] = true
		if strings.TrimSpace(rd.Title) == "" {
			return fmt.Errorf("%s: round %q: title required", p.ID, rd.ID)
		}
		if strings.TrimSpace(rd.Domain) == "" {
			return fmt.Errorf("%s: round %q: domain required", p.ID, rd.ID)
		}
		if strings.TrimSpace(rd.Modality) == "" {
			return fmt.Errorf("%s: round %q: modality required", p.ID, rd.ID)
		}
		if rd.QuestionID != "" {
			q, ok := cat.Get(rd.QuestionID)
			if !ok {
				return fmt.Errorf("%s: round %q: question_id %q not found in corpus", p.ID, rd.ID, rd.QuestionID)
			}
			if q.Domain != rd.Domain || q.Modality != rd.Modality {
				return fmt.Errorf("%s: round %q: question %q is (%s,%s), round is (%s,%s)",
					p.ID, rd.ID, rd.QuestionID, q.Domain, q.Modality, rd.Domain, rd.Modality)
			}
			areaSet := map[string]bool{}
			for _, a := range p.Areas {
				areaSet[a] = true
			}
			if !intersects(q.Areas, areaSet) {
				return fmt.Errorf("%s: pinned question does not match profession", p.ID)
			}
			continue
		}
		// Pooled round: at least one corpus question in one of the pack's areas
		// must match (domain, modality).
		if len(candidates(cat, p, rd)) == 0 {
			return fmt.Errorf("%s: round %q: no corpus question matches (domain=%s, modality=%s) in areas %v",
				p.ID, rd.ID, rd.Domain, rd.Modality, p.Areas)
		}
	}
	return nil
}

// candidates returns the sorted corpus question ids that match the round's
// (domain, modality) and share at least one area with the pack. Difficulty is
// NOT applied here — it is used only as a preference in PickQuestion.
func candidates(cat *corpus.Catalog, p Pack, round Round) []string {
	packAreas := map[string]bool{}
	for _, a := range p.Areas {
		packAreas[a] = true
	}
	var ids []string
	// List filters by (modality, track, domain); track is left empty.
	for _, s := range cat.List(round.Modality, "", round.Domain) {
		if !intersects(s.Areas, packAreas) {
			continue
		}
		ids = append(ids, s.ID)
	}
	sort.Strings(ids)
	return ids
}

func intersects(areas []string, set map[string]bool) bool {
	for _, a := range areas {
		if set[a] {
			return true
		}
	}
	return false
}

// PickQuestion resolves a round to a concrete corpus question id.
// If the round pins a question_id it is returned directly. Otherwise a corpus
// question is chosen DETERMINISTICALLY: among questions matching the round's
// (domain, modality) that share an area with the pack, questions matching the
// round's difficulty are preferred; ties are broken by sorted id (first wins).
// ok is false when nothing matches.
func PickQuestion(cat *corpus.Catalog, p Pack, round Round) (questionID string, ok bool) {
	if round.QuestionID != "" {
		return round.QuestionID, true
	}
	cands := candidates(cat, p, round)
	if len(cands) == 0 {
		return "", false
	}
	if round.Difficulty != "" {
		var pref []string
		for _, id := range cands {
			if q, ok := cat.Get(id); ok && q.Difficulty == round.Difficulty {
				pref = append(pref, id)
			}
		}
		if len(pref) > 0 {
			// cands is already sorted, so pref preserves sorted order.
			return pref[0], true
		}
	}
	return cands[0], true
}

// PickQuestionWithSeed rotates a pooled round without repeating previous
// questions while an unseen compatible scenario remains. Persist the chosen
// question on the session; never re-resolve it during reconnect or scoring.
func PickQuestionWithSeed(cat *corpus.Catalog, p Pack, round Round, seed string, seen []string) (string, bool) {
	if round.QuestionID != "" {
		_, ok := cat.Get(round.QuestionID)
		return round.QuestionID, ok
	}
	pool := candidates(cat, p, round)
	if len(pool) == 0 {
		return "", false
	}
	excluded := map[string]bool{}
	for _, id := range seen {
		excluded[id] = true
	}
	fresh := []string{}
	for _, id := range pool {
		if !excluded[id] {
			fresh = append(fresh, id)
		}
	}
	if len(fresh) > 0 {
		pool = fresh
	}
	preferred := []string{}
	for _, id := range pool {
		q, _ := cat.Get(id)
		if q.Difficulty == round.Difficulty {
			preferred = append(preferred, id)
		}
	}
	if len(preferred) > 0 {
		pool = preferred
	}
	hash := sha256.Sum256([]byte(seed + ":" + p.ID + ":" + round.ID))
	return pool[binary.BigEndian.Uint64(hash[:8])%uint64(len(pool))], true
}
