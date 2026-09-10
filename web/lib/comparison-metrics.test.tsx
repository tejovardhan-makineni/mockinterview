import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ComparisonMetrics } from "../components/ComparisonMetrics";
import { comparisonMetricsCSV } from "./comparisonMetrics";
import type {
  InterviewFeedbackMetrics,
  ToolComparisonMetrics,
} from "./features/feedback";

function comparison(
  overrides: Partial<ToolComparisonMetrics> = {},
): ToolComparisonMetrics {
  return {
    instrument_version: "tool-comparison-v1",
    answered_count: 12,
    skipped_count: 3,
    prior_use: { yes: 8, no: 3, prefer_not_to_say: 1 },
    preference: {
      mockinterview_better: 2,
      about_same: 1,
      other_tools_better: 1,
      unable_to_judge: 4,
    },
    compared_count: 4,
    other_tools_better_rate: 0.25,
    ...overrides,
  };
}

function metrics(): InterviewFeedbackMetrics {
  const totals = {
    eligible_sessions: 20,
    responded_sessions: 15,
    pending_sessions: 5,
    response_rate: 0.75,
  };
  return {
    schema_version: "post-interview-v1",
    days: 30,
    group_by: "subject",
    generated_at: "2026-09-10T00:00:00Z",
    totals,
    comparison: comparison(),
    groups: [
      {
        key: "technical",
        label: "Technical reasoning",
        ...totals,
        questions: [],
        comparison: comparison(),
      },
    ],
    note: "Synthetic fixture",
  };
}

function renderComparison(data: ToolComparisonMetrics, title?: string) {
  const element = document.createElement("div");
  element.innerHTML = renderToStaticMarkup(
    <ComparisonMetrics data={data} title={title} />,
  );
  return element;
}

// These fixture rows contain no embedded commas/newlines. Formula and multiline
// escaping are checked separately against the complete CSV string.
function csvRecords(csv: string) {
  const [header, ...rows] = csv.split("\r\n");
  const cells = (row: string) =>
    row
      .slice(1, -1)
      .split('\",\"')
      .map((cell) => cell.replaceAll('\"\"', '\"'));
  const keys = cells(header);
  return rows.map((row) =>
    Object.fromEntries(cells(row).map((value, index) => [keys[index], value])),
  );
}

describe("optional tool comparison presentation", () => {
  it("uses rated comparisons as the denominator and identifies missing optional responses", () => {
    const element = renderComparison(comparison(), "Optional tool comparison");
    expect(element.querySelector("section")?.getAttribute("aria-label")).toBe(
      "Optional tool comparison",
    );
    expect(element.textContent).toContain("1 / 4 · 25%");
    expect(element.textContent).toContain("Unable to judge: 4");
    expect(element.textContent).toContain(
      "unable-to-judge and blank preferences are excluded",
    );
    expect(element.textContent).toContain(
      "No comparison saved counts submitted check-ins without this optional response, including older responses",
    );
    expect(element.textContent).not.toContain("1 / 12");
    expect(element.textContent).not.toContain("1 / 15");
  });

  it("shows a real zero percent when rated comparisons exist", () => {
    const base = comparison();
    const element = renderComparison(
      comparison({
        preference: { ...base.preference, other_tools_better: 0 },
        compared_count: 3,
        other_tools_better_rate: 0,
      }),
    );
    expect(element.textContent).toContain("0 / 3 · 0%");
    expect(element.textContent).not.toContain("No rated comparisons");
  });

  it("shows no rated comparisons for an unrated cohort instead of zero percent", () => {
    const element = renderComparison(
      comparison({
        preference: {
          mockinterview_better: 0,
          about_same: 0,
          other_tools_better: 0,
          unable_to_judge: 8,
        },
        compared_count: 0,
        other_tools_better_rate: null,
      }),
    );
    expect(element.textContent).toContain("No rated comparisons");
    expect(element.textContent).not.toContain("0%");
  });
});

describe("aggregate tool comparison CSV", () => {
  it("preserves total/group scope, cohort context, instrument and denominator", () => {
    const rows = csvRecords(comparisonMetricsCSV(metrics()));
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.row_type)).toEqual(["total", "group"]);
    for (const row of rows) {
      expect(row).toMatchObject({
        schema_version: "post-interview-v1",
        days: "30",
        generated_at: "2026-09-10T00:00:00Z",
        group_by: "subject",
        instrument_version: "tool-comparison-v1",
        responded_sessions: "15",
        answered_count: "12",
        skipped_count: "3",
        preference_unable_to_judge: "4",
        compared_count: "4",
        other_tools_better_rate: "0.25",
      });
    }
    expect(rows[0].group_key).toBe("");
    expect(rows[0].group_label).toBe("");
    expect(rows[1].group_key).toBe("technical");
    expect(rows[1].group_label).toBe("Technical reasoning");
  });

  it("keeps null rates blank and genuine zero rates numeric", () => {
    const data = metrics();
    data.comparison = comparison({ other_tools_better_rate: null });
    data.groups[0].comparison = comparison({ other_tools_better_rate: 0 });
    const rows = csvRecords(comparisonMetricsCSV(data));
    expect(rows[0].other_tools_better_rate).toBe("");
    expect(rows[1].other_tools_better_rate).toBe("0");
  });

  it("omits absent comparison scopes without manufacturing zero aggregates", () => {
    const data = metrics();
    delete data.comparison;
    let rows = csvRecords(comparisonMetricsCSV(data));
    expect(rows).toHaveLength(1);
    expect(rows[0].row_type).toBe("group");
    delete data.groups[0].comparison;
    expect(comparisonMetricsCSV(data).split("\r\n")).toHaveLength(1);
    data.comparison = comparison();
    rows = csvRecords(comparisonMetricsCSV(data));
    expect(rows).toHaveLength(1);
    expect(rows[0].row_type).toBe("total");
  });

  it("neutralizes formula labels and quotes commas, newlines and quotes", () => {
    for (const label of [
      "=FORMULA()",
      "+FORMULA()",
      "-FORMULA()",
      "@FORMULA()",
      "  =FORMULA()",
      "\tFORMULA()",
    ]) {
      const data = metrics();
      data.groups[0].label = label;
      expect(comparisonMetricsCSV(data)).toContain(`\"'${label}\"`);
    }
    const data = metrics();
    data.groups[0].label = 'Group, "quoted"\ncontinued';
    expect(comparisonMetricsCSV(data)).toContain(
      '\"Group, \"\"quoted\"\"\ncontinued\"',
    );
  });

  it("allows only aggregate fields even when the API includes unexpected free text", () => {
    const data = metrics();
    const privateFields = {
      tool_names: "PRIVATE_TOOL_NAME",
      details: "PRIVATE_COMPARISON_DETAILS",
      comment: "PRIVATE_COMMENT",
      comments: ["PRIVATE_COMMENT_LIST"],
    };
    Object.assign(data, privateFields);
    Object.assign(data.comparison!, privateFields);
    Object.assign(data.groups[0], privateFields);
    Object.assign(data.groups[0].comparison!, privateFields);
    const csv = comparisonMetricsCSV(data);
    for (const value of [
      "tool_names",
      "details",
      "comment",
      "PRIVATE_TOOL_NAME",
      "PRIVATE_COMPARISON_DETAILS",
      "PRIVATE_COMMENT",
    ])
      expect(csv).not.toContain(value);
    expect(csvRecords(csv)).toHaveLength(2);
  });
});
