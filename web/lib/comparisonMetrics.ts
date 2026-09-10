import type {
  FeedbackTotals,
  InterviewFeedbackMetrics,
  ToolComparisonMetrics,
} from "./features/feedback";

const columns = [
  "row_type",
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
  "instrument_version",
  "answered_count",
  "skipped_count",
  "prior_use_yes",
  "prior_use_no",
  "prior_use_prefer_not_to_say",
  "preference_mockinterview_better",
  "preference_about_same",
  "preference_other_tools_better",
  "preference_unable_to_judge",
  "compared_count",
  "other_tools_better_rate",
];

function csvCell(value: string | number | null | undefined) {
  let text = value == null ? "" : String(value);
  // Labels may contain contributor-controlled text. Neutralize spreadsheet
  // formulas even when the triggering character follows leading whitespace.
  if (/^\s*[=+@-]|^[\t\r\n]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}

export function comparisonMetricsCSV(data: InterviewFeedbackMetrics) {
  const rows: (string | number | null | undefined)[][] = [columns];
  const addRow = (
    rowType: "total" | "group",
    totals: FeedbackTotals,
    comparison: ToolComparisonMetrics,
    key = "",
    label = "",
  ) => {
    // Explicit columns ensure optional free text or unexpected API fields
    // cannot enter this aggregate export.
    rows.push([
      rowType,
      data.schema_version,
      data.days,
      data.generated_at,
      data.group_by,
      key,
      label,
      totals.eligible_sessions,
      totals.responded_sessions,
      totals.pending_sessions,
      totals.response_rate,
      comparison.instrument_version,
      comparison.answered_count,
      comparison.skipped_count,
      comparison.prior_use.yes,
      comparison.prior_use.no,
      comparison.prior_use.prefer_not_to_say,
      comparison.preference.mockinterview_better,
      comparison.preference.about_same,
      comparison.preference.other_tools_better,
      comparison.preference.unable_to_judge,
      comparison.compared_count,
      comparison.other_tools_better_rate,
    ]);
  };

  if (data.comparison) addRow("total", data.totals, data.comparison);
  for (const group of data.groups) {
    if (group.comparison)
      addRow("group", group, group.comparison, group.key, group.label);
  }
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}

export function downloadComparisonMetrics(data: InterviewFeedbackMetrics) {
  const blob = new Blob([comparisonMetricsCSV(data)], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = `interview-tool-comparison-${data.group_by}-${data.days}days.csv`;
    link.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}
