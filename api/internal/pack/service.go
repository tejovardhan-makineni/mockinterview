package pack

import (
	"context"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/tejo/mockinterview-api/internal/auth"
	"github.com/tejo/mockinterview-api/internal/corpus"
	"github.com/tejo/mockinterview-api/internal/httpx"
	"github.com/tejo/mockinterview-api/internal/store"
)

// Repo is the subset of the session store the pack service needs, defined here
// (consumer side) so the store package does not depend on pack.
type Repo interface {
	SessionsForPack(ctx context.Context, userID, packID string) ([]store.SessionSummary, error)
}

// Service serves pack listing, detail, and per-user progress.
type Service struct {
	corpus *corpus.Catalog
	packs  *Catalog
	repo   Repo
}

// NewService wires the pack service.
func NewService(corpusCat *corpus.Catalog, packs *Catalog, repo Repo) *Service {
	return &Service{corpus: corpusCat, packs: packs, repo: repo}
}

// ResolveRound looks up a pack round and resolves it to a concrete corpus
// question id plus the round's focus. It satisfies interview.PackResolver.
func (s *Service) ResolveRound(packID, roundID string) (questionID, focus string, ok bool) {
	p, ok := s.packs.Get(packID)
	if !ok {
		return "", "", false
	}
	for _, rd := range p.Rounds {
		if rd.ID != roundID {
			continue
		}
		qid, ok := PickQuestion(s.corpus, p, rd)
		if !ok {
			return "", "", false
		}
		return qid, rd.Focus, true
	}
	return "", "", false
}

// ---- client-safe views ----

// roundSummary is the trimmed round shape returned in pack listings.
type roundSummary struct {
	ID      string `json:"id"`
	Title   string `json:"title"`
	Kind    string `json:"kind"`
	Minutes int    `json:"minutes"`
}

// packSummary is the client-safe pack projection for the list endpoint.
type packSummary struct {
	ID      string         `json:"id"`
	Name    string         `json:"name"`
	Company string         `json:"company,omitempty"`
	Blurb   string         `json:"blurb,omitempty"`
	Areas   []string       `json:"areas"`
	Track   string         `json:"track,omitempty"`
	Rounds  []roundSummary `json:"rounds"`
}

func summarize(p Pack) packSummary {
	rounds := make([]roundSummary, 0, len(p.Rounds))
	for _, rd := range p.Rounds {
		rounds = append(rounds, roundSummary{ID: rd.ID, Title: rd.Title, Kind: rd.Kind, Minutes: rd.Minutes})
	}
	return packSummary{
		ID: p.ID, Name: p.Name, Company: p.Company, Blurb: p.Blurb,
		Areas: p.Areas, Track: p.Track, Rounds: rounds,
	}
}

// List serves client-safe pack summaries with an optional ?profession= filter.
func (s *Service) List(w http.ResponseWriter, r *http.Request) {
	packs := s.packs.List(r.URL.Query().Get("profession"))
	out := make([]packSummary, 0, len(packs))
	for _, p := range packs {
		out = append(out, summarize(p))
	}
	httpx.WriteJSON(w, http.StatusOK, out)
}

// Get serves a single pack with its full rounds.
func (s *Service) Get(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	p, ok := s.packs.Get(id)
	if !ok {
		httpx.WriteProblem(w, http.StatusNotFound, "pack not found")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, p)
}

// ---- progress ----

type progressRoundRef struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	Kind  string `json:"kind"`
}

type progressRound struct {
	Round     progressRoundRef `json:"round"`
	SessionID string           `json:"session_id,omitempty"`
	Status    string           `json:"status"` // not_started | in_progress | done
	Overall   *float64         `json:"overall,omitempty"`
	Scored    *bool            `json:"scored,omitempty"`
}

type progressResponse struct {
	Pack             packSummary     `json:"pack"`
	Rounds           []progressRound `json:"rounds"`
	OverallReadiness float64         `json:"overall_readiness"`
}

// Progress serves the authed user's per-round progress for a pack, plus an
// overall readiness (mean scored round overall / 5, normalised 0..1; 0 if none).
func (s *Service) Progress(w http.ResponseWriter, r *http.Request) {
	uid := auth.UserID(r.Context())
	if uid == "" {
		httpx.WriteProblem(w, http.StatusUnauthorized, "authentication required")
		return
	}
	id := chi.URLParam(r, "id")
	p, ok := s.packs.Get(id)
	if !ok {
		httpx.WriteProblem(w, http.StatusNotFound, "pack not found")
		return
	}
	sessions, err := s.repo.SessionsForPack(r.Context(), uid, id)
	if err != nil {
		httpx.WriteProblem(w, http.StatusInternalServerError, "failed to load pack progress")
		return
	}
	// Best session per round: prefer a scored (done) session; sessions are
	// newest-first, so the first match for a round wins within a status tier.
	best := map[string]store.SessionSummary{}
	for _, ss := range sessions {
		if ss.PackRoundID == "" {
			continue
		}
		cur, seen := best[ss.PackRoundID]
		if !seen {
			best[ss.PackRoundID] = ss
			continue
		}
		if scored(ss) && !scored(cur) {
			best[ss.PackRoundID] = ss
		}
	}

	rounds := make([]progressRound, 0, len(p.Rounds))
	var sum float64
	var n int
	for _, rd := range p.Rounds {
		pr := progressRound{
			Round:  progressRoundRef{ID: rd.ID, Title: rd.Title, Kind: rd.Kind},
			Status: "not_started",
		}
		if ss, ok := best[rd.ID]; ok {
			pr.SessionID = ss.ID
			pr.Overall = ss.Overall
			pr.Scored = ss.Scored
			if scored(ss) {
				pr.Status = "done"
				sum += *ss.Overall
				n++
			} else {
				pr.Status = "in_progress"
			}
		}
		rounds = append(rounds, pr)
	}
	// Readiness is normalised 0..1 (mean of scored round overalls / 5) so the UI
	// can render it directly as a percentage ring.
	readiness := 0.0
	if n > 0 {
		readiness = (sum / float64(n)) / 5.0
	}
	httpx.WriteJSON(w, http.StatusOK, progressResponse{
		Pack: summarize(p), Rounds: rounds, OverallReadiness: readiness,
	})
}

// scored reports whether a session has a completed, scored report.
func scored(ss store.SessionSummary) bool {
	return ss.Scored != nil && *ss.Scored && ss.Overall != nil
}
