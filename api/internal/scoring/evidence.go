package scoring

import (
	"encoding/json"
	"fmt"
	"math"
	"strings"

	"github.com/tejo/mockinterview-api/internal/corpus"
	"github.com/tejo/mockinterview-api/internal/store"
)

const ScoringVersion = "2026-09-10.1"
const maxEvidenceBytes = 512 * 1024

type EvidenceRef struct {
	SourceID string `json:"source_id"`
	Quote    string `json:"quote"`
}
type evidenceRecord struct {
	ID        string `json:"id"`
	Role      string `json:"role"`
	Text      string `json:"text"`
	Timestamp int64  `json:"ts_ms"`
}

func encodeEvidence(turns []store.Turn, workspace string) (map[string]string, []byte, error) {
	sources := map[string]string{}
	records := make([]evidenceRecord, 0, len(turns)+1)
	for i, t := range turns {
		id := t.ID
		if id == "" {
			id = fmt.Sprintf("turn-%d", i+1)
		}
		if t.Role == "candidate" {
			sources[id] = t.Text
		}
		records = append(records, evidenceRecord{id, t.Role, t.Text, t.TsMs})
	}
	if workspace != "" {
		sources["workspace"] = workspace
		records = append(records, evidenceRecord{ID: "workspace", Role: "candidate_workspace", Text: workspace})
	}
	encoded, err := json.Marshal(records)
	if err != nil {
		return nil, nil, err
	}
	if len(encoded) > maxEvidenceBytes {
		return nil, nil, fmt.Errorf("interview evidence exceeds the supported 512 KiB assessment limit; saved work has not been truncated")
	}
	return sources, encoded, nil
}

func validateScores(q corpus.Question, r *Result, sources map[string]string) error {
	allowed := map[string]corpus.RubricDim{}
	for _, d := range q.Rubric {
		allowed[d.Key] = d
	}
	seen := map[string]bool{}
	for i := range r.Scores {
		s := &r.Scores[i]
		d, ok := allowed[s.Dimension]
		if !ok || seen[s.Dimension] {
			return fmt.Errorf("assessment returned unknown or duplicate dimension %q", s.Dimension)
		}
		seen[s.Dimension] = true
		if math.IsNaN(s.Score) || math.IsInf(s.Score, 0) || s.Score < 0 || s.Score > 4 || s.CoveragePct < 0 || s.CoveragePct > 100 {
			return fmt.Errorf("assessment returned invalid numeric bounds for %s", s.Dimension)
		}
		s.Weight = d.Weight
		if !s.Assessed {
			s.Score = 0
			s.CoveragePct = 0
			s.Evidence = ""
			s.EvidenceRefs = nil
			continue
		}
		if len(s.EvidenceRefs) == 0 {
			return fmt.Errorf("assessed dimension %s has no evidence references", s.Dimension)
		}
		var citations []string
		for _, ref := range s.EvidenceRefs {
			source, exists := sources[ref.SourceID]
			if !exists || len(strings.TrimSpace(ref.Quote)) < 3 || !strings.Contains(source, ref.Quote) {
				return fmt.Errorf("assessment evidence for %s is not supported by the saved candidate record", s.Dimension)
			}
			citations = append(citations, fmt.Sprintf("[%s] %s", ref.SourceID, ref.Quote))
		}
		s.Evidence = strings.Join(citations, "\n")
	}
	// Missing dimensions are explicitly unassessed, never inferred by averaging.
	for _, d := range q.Rubric {
		if !seen[d.Key] {
			r.Scores = append(r.Scores, DimScore{Dimension: d.Key, Weight: d.Weight, Expected: d.Description, Assessed: false})
		}
	}
	return nil
}

func learningDrills(q corpus.Question) []corpus.Drill {
	if len(q.LearningDrills) > 0 {
		return q.LearningDrills
	}
	return []corpus.Drill{
		{ID: "reflect-before-retry", Title: "Reflect on your attempt", Minutes: 3, Prompt: "Choose one decision from your saved answer. What worked, what would you change, and what evidence supports that?", Checklist: []string{"Name your own decision", "Point to evidence", "Choose one improvement"}},
		{ID: "explain-a-tradeoff", Title: "Explain one decision, two ways", Minutes: 5, Prompt: "Compare two reasonable approaches to the scenario. Explain your choice and what new information would change it.", Checklist: []string{"State the goal", "Compare alternatives fairly", "Explain a tradeoff", "Name a condition that changes the choice"}},
		{ID: "transfer-next-attempt", Title: "Plan a fresh scenario", Minutes: 2, Prompt: "Pick one skill to test in a different scenario at your next eligible interview. Rehearsing the same answer is useful, but is not independent evidence of readiness.", Checklist: []string{"Choose one skill", "Use a different scenario", "Keep target level comparable"}},
	}
}
