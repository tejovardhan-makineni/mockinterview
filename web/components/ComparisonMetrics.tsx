import type { ToolComparisonMetrics } from "@/lib/features/feedback";

export function ComparisonMetrics({
  data,
  title = "Optional tool comparison",
}: {
  data: ToolComparisonMetrics;
  title?: string;
}) {
  const rate = data.other_tools_better_rate;
  const rateLabel =
    rate == null || !Number.isFinite(rate)
      ? "No rated comparisons"
      : `${Number((rate * 100).toFixed(1))}%`;

  return (
    <section
      aria-label={title}
      className="rounded-lg border border-[var(--color-line)] p-4"
    >
      <h3 className="text-sm font-semibold">{title}</h3>
      <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-3 text-xs">
        <div>
          <dt>Optional section answered</dt>
          <dd className="mt-1 font-medium">{data.answered_count}</dd>
        </div>
        <div>
          <dt>No comparison saved</dt>
          <dd className="mt-1 font-medium">{data.skipped_count}</dd>
        </div>
        <div>
          <dt>Rated comparisons</dt>
          <dd className="mt-1 font-medium">{data.compared_count}</dd>
        </div>
        <div>
          <dt>Other tools rated better</dt>
          <dd className="mt-1 font-medium">
            {data.preference.other_tools_better} / {data.compared_count} ·{" "}
            {rateLabel}
          </dd>
        </div>
      </dl>
      <p className="mt-3 text-xs text-[var(--color-muted)]">
        The rate uses {data.compared_count} rated comparisons; unable-to-judge
        and blank preferences are excluded. No comparison saved counts submitted
        check-ins without this optional response, including older responses.
      </p>
      <p className="mt-3 text-xs font-medium">
        Prior use of other tools (count)
      </p>
      <ul className="mt-2 flex flex-wrap gap-2 text-xs">
        {[
          ["Yes", data.prior_use.yes],
          ["No", data.prior_use.no],
          ["Prefer not to say", data.prior_use.prefer_not_to_say],
        ].map(([label, count]) => (
          <li
            key={label}
            className="rounded bg-[var(--color-panel-2)] px-3 py-2"
          >
            {label}: {count}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs font-medium">Comparison responses (count)</p>
      <ul className="mt-2 flex flex-wrap gap-2 text-xs">
        {[
          ["mockinterview.live better", data.preference.mockinterview_better],
          ["About the same", data.preference.about_same],
          ["Other tools better", data.preference.other_tools_better],
          ["Unable to judge", data.preference.unable_to_judge],
        ].map(([label, count]) => (
          <li
            key={label}
            className="rounded bg-[var(--color-panel-2)] px-3 py-2"
          >
            {label}: {count}
          </li>
        ))}
      </ul>
    </section>
  );
}
