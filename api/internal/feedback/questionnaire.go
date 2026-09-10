package feedback

import (
	"encoding/json"
	"github.com/tejo/mockinterview-api/internal/store"
	"strings"
)

type SurveyOption struct {
	Value string `json:"value"`
	Label string `json:"label"`
}
type SurveyQuestion struct {
	ID      string         `json:"id"`
	Prompt  string         `json:"prompt"`
	Options []SurveyOption `json:"options"`
}
type Questionnaire struct {
	ComparisonVersion string           `json:"comparison_version"`
	Version           string           `json:"version"`
	SubjectKey        string           `json:"subject_key"`
	SubjectLabel      string           `json:"subject_label"`
	Questions         []SurveyQuestion `json:"questions"`
}
type subject struct{ key, label, focus, domains string }

var subjects = []subject{
	{"software_design", "Software design", "your reasoning about software design decisions", "system_design,low_level_design"},
	{"ml_design", "Machine-learning design", "your reasoning about machine-learning system decisions", "ml_system_design"},
	{"coding", "Coding", "your reasoning about the coding solution", "coding"},
	{"work_sample", "Work-sample review", "your reasoning about the work sample", "code_review,sql_review,ai_critique"},
	{"behavioral", "Behavioral interviews", "the decisions you made in the experience you described", "behavioral"},
	{"consulting", "Consulting cases", "your reasoning about the business case", "case"},
	{"engineering_fundamentals", "Engineering fundamentals", "your engineering reasoning", "circuits,geotechnical,mechanical_design,mechanics,power_systems,signals_systems,structural,thermodynamics,transportation"},
	{"clinical_reasoning", "Clinical reasoning", "your reasoning about the fictional clinical case", "clinical_reasoning"},
	{"healthcare_scenarios", "Healthcare scenarios", "your decisions in the fictional healthcare scenario", "medical_residency,prioritization"},
	{"legal", "Legal scenarios", "your reasoning about the fictional legal scenario", "issue_spotting,legal_practice"},
	{"data_experimentation", "Data and experimentation", "your reasoning about data and evidence", "experimentation"},
	{"product_marketing", "Product and marketing", "your reasoning about product or market decisions", "product_sense,go_to_market"},
	{"finance", "Finance", "your financial reasoning", "valuation"},
	{"ux", "User experience", "your reasoning about user-experience decisions", "design_critique,portfolio_review"},
	{"roleplay", "Role-play", "your decisions during the role-play", "sales_roleplay,stakeholder_roleplay,employee_relations,classroom_management"},
	{"incident_response", "Incident response", "your reasoning about incident response", "incident_response"},
	{"candidate_questions", "Candidate questions", "the role-fit concerns behind your questions", "candidate_questions"},
}

// Decode only public catalog metadata from the frozen snapshot. Never return
// its reference answer, rubric anchors, interviewer instructions or transcript.
type surveyContext struct {
	Title  string `json:"title"`
	Domain string `json:"domain"`
	Format string `json:"format_id"`
}

func surveyMetadata(s store.Session) surveyContext {
	var c surveyContext
	_ = json.Unmarshal(s.QuestionSnapshot, &c)
	if c.Title == "" {
		c.Title = "Interview"
	}
	return c
}
func surveySubject(s store.Session) subject {
	domain := surveyMetadata(s).Domain
	for _, v := range subjects {
		for _, d := range strings.Split(v.domains, ",") {
			if d == domain {
				return v
			}
		}
	}
	return subject{key: "general", label: "General interview practice", focus: "your reasoning about this scenario"}
}
func questionnaire(s store.Session) Questionnaire {
	sub := surveySubject(s)
	rows := []struct {
		id, prompt string
		labels     []string
	}{
		{"usability_ease", "How easy was it to use the app during this interview?", []string{"Very difficult", "Difficult", "Neither easy nor difficult", "Easy", "Very easy"}},
		{"interviewer_realism", "Compared with interviews you have experienced, how realistic did the interviewer’s behavior feel?", []string{"Not at all realistic", "Slightly realistic", "Moderately realistic", "Very realistic", "Extremely realistic"}},
		{"subject_probe_quality", "How well did the interviewer explore " + sub.focus + "?", []string{"Not at all well", "Slightly well", "Moderately well", "Very well", "Extremely well"}},
		{"challenge_fit", "For the level you selected, how challenging was this interview?", []string{"Much too easy", "A little too easy", "About right", "A little too hard", "Much too hard"}},
		{"report_actionability", "After reading the report, how clear is what you should practice next?", []string{"Not at all clear", "Slightly clear", "Moderately clear", "Very clear", "Extremely clear"}},
		{"disruption_severity", "How much did technical problems interrupt this interview?", []string{"No interruption", "Minor interruption", "Moderate interruption", "Major interruption", "Could not finish"}},
	}
	out := Questionnaire{ComparisonVersion: store.ToolComparisonVersion, Version: store.InterviewFeedbackVersion, SubjectKey: sub.key, SubjectLabel: sub.label, Questions: []SurveyQuestion{}}
	for _, r := range rows {
		q := SurveyQuestion{ID: r.id, Prompt: r.prompt, Options: []SurveyOption{}}
		for i, l := range r.labels {
			q.Options = append(q.Options, SurveyOption{Value: string(rune('1' + i)), Label: l})
		}
		q.Options = append(q.Options, SurveyOption{Value: "unable_to_judge", Label: "Unable to judge"})
		if r.id == "report_actionability" {
			q.Options = append(q.Options, SurveyOption{Value: "report_not_read", Label: "I have not read the report"}, SurveyOption{Value: "report_unavailable", Label: "The report is unavailable"})
		}
		out.Questions = append(out.Questions, q)
	}
	return out
}
