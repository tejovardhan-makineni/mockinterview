import type {
  InterviewFeedbackEnvelope,
  InterviewFeedbackMetrics,
} from "./features/feedback";

export function completeFeedback(
  envelope: InterviewFeedbackEnvelope,
  answers: Record<string, string>,
) {
  return (
    envelope.questionnaire.questions.length > 0 &&
    envelope.questionnaire.questions.every((q) =>
      q.options.some((o) => o.value === answers[q.id]),
    )
  );
}
export function feedbackHref(id: string, next?: string) {
  return (
    "/feedback?s=" +
    encodeURIComponent(id) +
    (next ? "&next=" + encodeURIComponent(next) : "")
  );
}
export const rateText = (value: number | null | undefined) =>
  value == null || !Number.isFinite(value)
    ? "Not rated"
    : `${(value * 100).toFixed(1)}%`;
export const meanText = (value: number | null | undefined) =>
  value == null || !Number.isFinite(value) ? "Not rated" : value.toFixed(2);
export function metricsCSV(data: InterviewFeedbackMetrics) {
  const cell = (value: unknown) => {
    let text = value == null ? "" : String(value);
    // Aggregate labels can still contain contributor-controlled text. Do not
    // let an opened spreadsheet evaluate them as formulas.
    if (/^[=+@\t\r-]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  };
  const rows: unknown[][] = [
    [
      "schema_version",
      "days",
      "generated_at",
      "group_by",
      "group_key",
      "group_label",
      "eligible_sessions",
      "responded_sessions",
      "pending_sessions",
      "response_rate",
      "question_id",
      "question_label",
      "answer_value",
      "answer_count",
      "answered_count",
      "unrated_count",
      "mean",
      "favorable_count",
      "favorable_criterion",
      "favorable_rate",
    ],
  ];
  for (const g of data.groups)
    for (const q of g.questions) {
      const entries = Object.entries(q.distribution);
      for (const [value, count] of entries.length ? entries : [["", 0]])
        rows.push([
          data.schema_version,
          data.days,
          data.generated_at,
          data.group_by,
          g.key,
          g.label,
          g.eligible_sessions,
          g.responded_sessions,
          g.pending_sessions,
          g.response_rate,
          q.id,
          q.label,
          value,
          count,
          q.answered_count,
          q.unrated_count,
          q.mean,
          q.favorable_count,
          q.favorable_label,
          q.favorable_rate,
        ]);
    }
  if (!data.groups.length)
    rows.push([
      data.schema_version,
      data.days,
      data.generated_at,
      data.group_by,
      "",
      "",
      data.totals.eligible_sessions,
      data.totals.responded_sessions,
      data.totals.pending_sessions,
      data.totals.response_rate,
      ...Array(10).fill(""),
    ]);
  return rows.map((row) => row.map(cell).join(",")).join("\r\n");
}
export function downloadAggregate(
  data: InterviewFeedbackMetrics,
  format: "json" | "csv",
) {
  const blob = new Blob(
    [format === "json" ? JSON.stringify(data, null, 2) : metricsCSV(data)],
    { type: format === "json" ? "application/json" : "text/csv;charset=utf-8" },
  );
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `interview-feedback-${data.group_by}-${data.days}days.${format}`;
  a.click();
  URL.revokeObjectURL(url);
}
