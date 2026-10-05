import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ScoreRing } from "@/components/results/ScoreRing";

vi.mock("@/components/results/ScoreRing.module.css", () => ({ default: {} }));

describe("practice score display", () => {
  it("uses the reported 0–4 scale without converting it to a pass percentage", () => {
    const markup = renderToStaticMarkup(<ScoreRing score={2.9} />);
    expect(markup).toContain('aria-label="Practice score: 2.9 out of 4"');
    expect(markup).toContain('stroke-dasharray="72.5 100"');
    expect(markup).not.toContain("72.5%");
  });

  it("preserves an assessed zero without drawing a positive score arc", () => {
    const markup = renderToStaticMarkup(<ScoreRing score={0} />);
    expect(markup).toContain('aria-label="Practice score: 0.0 out of 4"');
    expect(markup).not.toContain("stroke-dasharray");
  });

  it.each([0, 3])(
    "does not display a score for an unscored attempt (%s)",
    (score) => {
      const markup = renderToStaticMarkup(
        <ScoreRing score={score} assessed={false} />,
      );
      expect(markup).toContain('aria-label="No score available"');
      expect(markup).not.toContain("stroke-dasharray");
      expect(markup).not.toContain("out of 4");
    },
  );

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1, 5])(
    "does not fabricate a score from invalid data (%s)",
    (score) => {
      const markup = renderToStaticMarkup(<ScoreRing score={score} />);
      expect(markup).toContain('aria-label="No score available"');
      expect(markup).not.toContain("stroke-dasharray");
    },
  );
});
