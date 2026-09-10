"use client";
import { useState } from "react";
import { req, errorMessage } from "@/lib/http";
import { Button, Field, Input } from "./ui";
export function PersonalKeyRecovery({
  sessionId,
  onSaved,
}: {
  sessionId: string;
  onSaved: () => void | Promise<void>;
}) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
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
              body: JSON.stringify({ api_key: key }),
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
            onChange={(e) => setKey(e.target.value)}
            autoComplete="off"
            required
          />
        </Field>
        {error && (
          <p role="alert" className="text-sm text-[var(--color-bad)]">
            {error}
          </p>
        )}
        <Button type="submit" variant="ghost" disabled={busy || !key}>
          {busy ? "Checking connection…" : "Save key & retry"}
        </Button>
      </form>
    </details>
  );
}
