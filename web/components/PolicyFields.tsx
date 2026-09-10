"use client";

export function PolicyFields({
  adult,
  accepted,
  onAdult,
  onAccepted,
}: {
  adult: boolean;
  accepted: boolean;
  onAdult: (value: boolean) => void;
  onAccepted: (value: boolean) => void;
}) {
  return (
    <fieldset className="space-y-4 text-sm">
      <legend className="mb-3 font-medium">Before using AI practice</legend>
      <label className="flex items-start gap-3">
        <input
          className="mt-1"
          type="checkbox"
          required
          checked={adult}
          onChange={(e) => onAdult(e.target.checked)}
        />
        <span>I am at least 18 years old.</span>
      </label>
      <label className="flex items-start gap-3">
        <input
          className="mt-1"
          type="checkbox"
          required
          checked={accepted}
          onChange={(e) => onAccepted(e.target.checked)}
        />
        <span>
          I agree to the{" "}
          <a className="underline" href="/terms" target="_blank" rel="noopener">
            Terms (opens in a new tab)
          </a>{" "}
          and have read the{" "}
          <a
            className="underline"
            href="/privacy"
            target="_blank"
            rel="noopener"
          >
            Privacy notice (opens in a new tab)
          </a>
          .
        </span>
      </label>
      <p className="text-xs text-[var(--color-muted)]">
        Optional resume use, camera self-view and feedback sharing have separate
        controls. This does not opt you into marketing or research.
      </p>
    </fieldset>
  );
}
