package feedback

import (
	"encoding/json"
	"github.com/tejo/mockinterview-api/internal/auth"
	"github.com/tejo/mockinterview-api/internal/httpx"
	"github.com/tejo/mockinterview-api/internal/store"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"
)

type metricTotals struct {
	Eligible     int      `json:"eligible_sessions"`
	Responded    int      `json:"responded_sessions"`
	Pending      int      `json:"pending_sessions"`
	ResponseRate *float64 `json:"response_rate"`
}
type questionMetric struct {
	ID             string         `json:"id"`
	Label          string         `json:"label"`
	Distribution   map[string]int `json:"distribution"`
	Answered       int            `json:"answered_count"`
	Unrated        int            `json:"unrated_count"`
	Mean           *float64       `json:"mean"`
	Favorable      int            `json:"favorable_count"`
	FavorableRate  *float64       `json:"favorable_rate"`
	FavorableLabel string         `json:"favorable_label"`
	sum            int
}
type metricGroup struct {
	Key   string `json:"key"`
	Label string `json:"label"`
	metricTotals
	Questions []questionMetric `json:"questions"`
}
type metricResponse struct {
	SchemaVersion string        `json:"schema_version"`
	Days          int           `json:"days"`
	GroupBy       string        `json:"group_by"`
	GeneratedAt   time.Time     `json:"generated_at"`
	Totals        metricTotals  `json:"totals"`
	Groups        []metricGroup `json:"groups"`
	Note          string        `json:"note"`
}

const metricsNote = "All eligible started attempts in the rolling UTC window [generated_at minus days*24h, generated_at) are included, including failed or unavailable reports. Legacy, unstarted and deleted attempts are excluded. Each current response counts once; later edits/submissions and deletions can change historical results. Unrated answers are excluded from numeric summaries and favorable-rate denominators. Means describe ordinal responses only; challenge and disruption have no mean. Favorable means 4–5 for positive items, 3 for challenge fit and 1 for disruption. Rates are fractions from 0 to 1. These are unvalidated self-report items, not objective accuracy or calibrated quality measures; no composite score is calculated. Small groups can identify a participant; restrict access and do not publish raw groups."

func tally(t *metricTotals) {
	t.Pending = t.Eligible - t.Responded
	if t.Eligible > 0 {
		rate := float64(t.Responded) / float64(t.Eligible)
		t.ResponseRate = &rate
	}
}
func grouping(a store.Session, by string) (string, string) {
	c := surveyMetadata(a)
	switch by {
	case "subject":
		s := surveySubject(a)
		return s.key, s.label
	case "domain":
		if c.Domain != "" {
			return c.Domain, strings.ReplaceAll(c.Domain, "_", " ")
		}
	case "question":
		return a.QuestionID, c.Title
	case "mode":
		if a.Mode != "" {
			return a.Mode, a.Mode
		}
	case "provider":
		if a.Provider != "" {
			return a.Provider, a.Provider
		}
	case "format":
		if c.Format != "" {
			return c.Format, c.Format
		}
	case "level":
		var settings struct {
			Level string `json:"target_level"`
		}
		_ = json.Unmarshal(a.Config, &settings)
		switch settings.Level {
		case "entry", "junior", "mid", "senior", "staff":
			return settings.Level, settings.Level
		}
	}
	return "unspecified", "Unspecified"
}
func aggregateMetrics(rows []store.InterviewFeedbackRow, days int, by string, now time.Time) metricResponse {
	out := metricResponse{SchemaVersion: store.InterviewFeedbackVersion, Days: days, GroupBy: by, GeneratedAt: now, Groups: []metricGroup{}, Note: metricsNote}
	groups := map[string]*metricGroup{}
	for _, r := range rows {
		key, label := grouping(r.Session, by)
		g := groups[key]
		if g == nil {
			g = &metricGroup{Key: key, Label: label, Questions: []questionMetric{}}
			for _, q := range questionnaire(r.Session).Questions {
				prompt := q.Prompt
				if q.ID == "subject_probe_quality" && by != "subject" && by != "domain" && by != "question" {
					prompt = "How well did the interviewer explore the subject-specific reasoning?"
				}
				m := questionMetric{ID: q.ID, Label: prompt, Distribution: map[string]int{}, FavorableLabel: "4 or 5"}
				if q.ID == "challenge_fit" {
					m.FavorableLabel = "About right (3)"
				}
				if q.ID == "disruption_severity" {
					m.FavorableLabel = "No interruption (1)"
				}
				for _, o := range q.Options {
					m.Distribution[o.Value] = 0
				}
				g.Questions = append(g.Questions, m)
			}
			groups[key] = g
		}
		out.Totals.Eligible++
		g.Eligible++
		if r.Response == nil {
			continue
		}
		out.Totals.Responded++
		g.Responded++
		for i := range g.Questions {
			q := &g.Questions[i]
			v := r.Response.Answers[q.ID]
			q.Distribution[v]++
			n, e := strconv.Atoi(v)
			if e != nil || n < 1 || n > 5 {
				q.Unrated++
				continue
			}
			q.Answered++
			q.sum += n
			favorable := n >= 4
			if q.ID == "challenge_fit" {
				favorable = n == 3
			}
			if q.ID == "disruption_severity" {
				favorable = n == 1
			}
			if favorable {
				q.Favorable++
			}
		}
	}
	tally(&out.Totals)
	for _, g := range groups {
		tally(&g.metricTotals)
		for i := range g.Questions {
			q := &g.Questions[i]
			if q.Answered > 0 {
				rate := float64(q.Favorable) / float64(q.Answered)
				q.FavorableRate = &rate
				if q.ID != "challenge_fit" && q.ID != "disruption_severity" {
					mean := float64(q.sum) / float64(q.Answered)
					q.Mean = &mean
				}
			}
		}
		out.Groups = append(out.Groups, *g)
	}
	sort.Slice(out.Groups, func(i, j int) bool { return out.Groups[i].Key < out.Groups[j].Key })
	return out
}
func (s *Service) InterviewMetrics(w http.ResponseWriter, r *http.Request) {
	u, e := s.store.UserByID(r.Context(), auth.UserID(r.Context()))
	if e != nil || u.Role != "admin" {
		httpx.WriteProblem(w, 403, "admins only")
		return
	}
	days := 30
	if value := r.URL.Query().Get("days"); value != "" {
		days, e = strconv.Atoi(value)
		if e != nil || days < 1 || days > 365 {
			httpx.WriteProblem(w, 400, "days must be an integer from 1 to 365")
			return
		}
	}
	by := r.URL.Query().Get("group_by")
	if by == "" {
		by = "subject"
	}
	switch by {
	case "subject", "domain", "question", "mode", "provider", "format", "level":
	default:
		httpx.WriteProblem(w, 400, "Unsupported feedback grouping")
		return
	}
	now := time.Now().UTC()
	rows, e := s.store.InterviewFeedbackWindow(r.Context(), now.Add(-time.Duration(days)*24*time.Hour), now)
	if e != nil {
		httpx.WriteProblem(w, 503, "Could not load interview feedback metrics")
		return
	}
	httpx.WriteJSON(w, 200, aggregateMetrics(rows, days, by, now))
}
