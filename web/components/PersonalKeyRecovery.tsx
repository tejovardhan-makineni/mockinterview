"use client";
import { useState } from "react";
import { req, errorMessage } from "@/lib/http";
import { Button, Field, Input } from "./ui";
export function PersonalKeyRecovery({
  sessionId,
  provider,
  onSaved,
}: {
  sessionId: string;
  provider?: string;
  onSaved: () => void | Promise<void>;
}) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [paidBilling, setPaidBilling] = useState(false);
  return (
    <details className="notice">
      <summary className="font-semibold">
        Restore your personal model key
      </summary>
      <p className="my-3 text-sm">
        If the temporary key expired or was rejected, enter a working key for
        the same provider. The key stays out of browser storage and your saved
        report.
      </p>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            await req("/api/v1/sessions/" + sessionId + "/credentials", {
              method: "PUT",
              body: JSON.stringify({
                api_key: key,
                paid_billing_confirmed: paidBilling,
              }),
            });
            setKey("");
            await onSaved();
          } catch (error) {
            setError(errorMessage(error));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Personal API key">
          <Input
            type="password"
            value={key}
            onChange={(e) => {
              setKey(e.target.value);
              setPaidBilling(false);
            }}
            autoComplete="off"
            required
          />
        </Field>
        {provider === "gemini" && (
          <label className="flex items-start gap-3 text-xs">
            <input
              className="mt-1"
              type="checkbox"
              checked={paidBilling}
              onChange={(e) => setPaidBilling(e.target.checked)}
            />
            <span>
              This Gemini key belongs to a project with paid billing enabled. A
              connection check does not verify billing.{" "}
              <a
                className="underline"
                href="https://ai.google.dev/gemini-api/docs/billing"
                target="_blank"
                rel="noopener"
              >
                Check billing
              </a>
            </span>
          </label>
        )}
        {error && (
          <p role="alert" className="text-sm text-[var(--color-bad)]">
            {error}
          </p>
        )}
        <Button
          type="submit"
          variant="ghost"
          disabled={busy || !key || (provider === "gemini" && !paidBilling)}
        >
          {busy ? "Checking connection…" : "Save key & retry"}
        </Button>
      </form>
    </details>
  );
}
