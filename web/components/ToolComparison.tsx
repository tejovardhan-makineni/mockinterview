"use client";
import { useId } from "react";
import type { ToolComparison } from "@/lib/features/feedback";
import { Button } from "./ui";
export const COMPARISON_VERSION = "tool-comparison-v1";
const priorUseLabels: Record<ToolComparison["prior_use"], string> = {
  yes: "Yes",
  no: "No",
  prefer_not_to_say: "Prefer not to say",
};
const preferenceLabels: Record<
  Exclude<ToolComparison["preference"], "">,
  string
> = {
  mockinterview_better: "mockinterview.live was better",
  about_same: "About the same",
  other_tools_better: "The other tools were better",
  unable_to_judge: "Unable to judge",
};
export function comparisonTooLong(value: ToolComparison | null) {
  return (
    !!value &&
    (Array.from(value.tool_names).length > 300 ||
      Array.from(value.details).length > 1000)
  );
}
export function ToolComparisonSummary({
  value,
}: {
  value: ToolComparison | null;
}) {
  return (
    <section
      className="mt-5 rounded-lg border border-[var(--color-line)] p-4"
      aria-label="Saved optional tool comparison"
    >
      <h3 className="text-sm font-semibold">
        Other interview-practice tools (optional)
      </h3>
      {!value ? (
        <p className="mt-2 text-sm text-[var(--color-muted)]">
          No comparison saved
        </p>
      ) : (
        <dl className="mt-3 space-y-3 text-sm">
          <div>
            <dt className="font-medium">
              Used another interview-practice tool
            </dt>
            <dd>{priorUseLabels[value.prior_use]}</dd>
          </div>
          {value.prior_use === "yes" && (
            <>
              <div>
                <dt className="font-medium">Tools tried</dt>
                <dd className="whitespace-pre-wrap break-words">
                  {value.tool_names || "Not provided"}
                </dd>
              </div>
              <div>
                <dt className="font-medium">
                  Experience compared with other tools
                </dt>
                <dd>
                  {value.preference
                    ? preferenceLabels[value.preference]
                    : "Not rated"}
                </dd>
              </div>
              <div>
                <dt className="font-medium">What worked better or worse</dt>
                <dd className="whitespace-pre-wrap break-words">
                  {value.details || "Not provided"}
                </dd>
              </div>
            </>
          )}
        </dl>
      )}
    </section>
  );
}
export function ToolComparisonFields({
  value,
  onChange,
  disabled = false,
}: {
  value: ToolComparison | null;
  onChange: (value: ToolComparison | null) => void;
  disabled?: boolean;
}) {
  const prefix = useId();
  const toolsLength = Array.from(value?.tool_names ?? "").length;
  const detailsLength = Array.from(value?.details ?? "").length;
  function prior(prior_use: ToolComparison["prior_use"]) {
    onChange(
      prior_use === "yes" && value?.prior_use === "yes"
        ? value
        : {
            version: COMPARISON_VERSION,
            prior_use,
            tool_names: "",
            preference: "",
            details: "",
          },
    );
  }
  return (
    <section
      className="rounded-xl border border-[var(--color-line)] p-4 sm:p-5"
      aria-labelledby={prefix + "-heading"}
    >
      <h3 id={prefix + "-heading"} className="font-semibold">
        Other interview-practice tools (optional)
      </h3>
      <p className="mt-2 text-sm text-[var(--color-muted)]">
        You can skip this section. It does not affect your six required answers
        or your next interview. Avoid personal, confidential or identifying
        information.
      </p>
      <fieldset disabled={disabled} className="mt-4 min-w-0">
        <legend className="text-sm font-medium">
          Have you used another interview-practice tool?
        </legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {(
            Object.entries(priorUseLabels) as [
              ToolComparison["prior_use"],
              string,
            ][]
          ).map(([key, label]) => (
            <label
              key={key}
              className="flex min-h-11 items-center gap-3 rounded-lg border border-[var(--color-line)] p-3 text-sm"
            >
              <input
                type="radio"
                name={prefix + "-prior"}
                value={key}
                checked={value?.prior_use === key}
                onChange={() => prior(key)}
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      {value?.prior_use === "yes" && (
        <div className="mt-5 space-y-5">
          <div>
            <label
              htmlFor={prefix + "-tools"}
              className="block text-sm font-medium"
            >
              Which tools have you tried? (optional)
            </label>
            <input
              id={prefix + "-tools"}
              className="field-select mt-2"
              type="text"
              disabled={disabled}
              value={value.tool_names}
              onChange={(e) =>
                onChange({ ...value, tool_names: e.target.value })
              }
              aria-invalid={toolsLength > 300 || undefined}
              aria-describedby={prefix + "-tools-count"}
            />
            <p
              className="mt-2 text-xs"
              id={prefix + "-tools-count"}
              role={toolsLength > 300 ? "alert" : undefined}
            >
              {toolsLength} / 300 characters
              {toolsLength > 300
                ? ". Shorten the tool names or clear this optional section before saving. Your text has been kept."
                : ""}
            </p>
          </div>
          <fieldset disabled={disabled} className="min-w-0">
            <legend className="text-sm font-medium">
              Compared with the other tools you’ve used, how was this interview
              experience? (optional)
            </legend>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {(
                Object.entries(preferenceLabels) as [
                  Exclude<ToolComparison["preference"], "">,
                  string,
                ][]
              ).map(([key, label]) => (
                <label
                  key={key}
                  className="flex min-h-11 items-center gap-3 rounded-lg border border-[var(--color-line)] p-3 text-sm"
                >
                  <input
                    type="radio"
                    name={prefix + "-preference"}
                    value={key}
                    checked={value.preference === key}
                    onChange={() => onChange({ ...value, preference: key })}
                  />
                  {label}
                </label>
              ))}
            </div>
            {value.preference && (
              <Button
                variant="ghost"
                className="mt-2"
                disabled={disabled}
                onClick={() => onChange({ ...value, preference: "" })}
              >
                Clear comparison rating
              </Button>
            )}
          </fieldset>
          <div>
            <label
              htmlFor={prefix + "-details"}
              className="block text-sm font-medium"
            >
              What worked better or worse, and in which tool? (optional)
            </label>
            <textarea
              id={prefix + "-details"}
              rows={3}
              className="field-select mt-2"
              disabled={disabled}
              value={value.details}
              onChange={(e) => onChange({ ...value, details: e.target.value })}
              aria-invalid={detailsLength > 1000 || undefined}
              aria-describedby={prefix + "-details-count"}
            />
            <p
              className="mt-2 text-xs"
              id={prefix + "-details-count"}
              role={detailsLength > 1000 ? "alert" : undefined}
            >
              {detailsLength} / 1,000 characters
              {detailsLength > 1000
                ? ". Shorten the comparison details or clear this optional section before saving. Your text has been kept."
                : ""}
            </p>
          </div>
        </div>
      )}
      {value && (
        <Button
          className="mt-4"
          variant="ghost"
          disabled={disabled}
          onClick={() => onChange(null)}
        >
          Clear and skip tool comparison
        </Button>
      )}
    </section>
  );
}
