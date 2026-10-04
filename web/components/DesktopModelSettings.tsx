"use client";
import { useState } from "react";
import { api } from "@/lib/api";
import { getDesktopModel, setDesktopModel, errorMessage } from "@/lib/http";
import { Button, Field, Input } from "./ui";

export function DesktopModelSettings() {
  const [provider, setProvider] = useState(
    () => getDesktopModel()?.provider || "gemini",
  );
  const [model, setModel] = useState(() => getDesktopModel()?.model || "");
  const [key, setKey] = useState("");
  const [paid, setPaid] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setMessage("");
        try {
          const result = await api.validateProvider({
            provider,
            model: model || undefined,
            api_key: key,
            mode: "text",
            paid_billing_confirmed: paid,
          });
          if (!result.valid)
            throw new Error("The model connection could not be verified.");
          setDesktopModel({
            provider,
            model: result.model || model,
            apiKey: key,
          });
          setKey("");
          setMessage(
            "Model connected for this app session. You can use interview setup, resume review and other AI tools.",
          );
        } catch (error) {
          setMessage(errorMessage(error));
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2 className="text-lg font-semibold">Your AI connection</h2>
      <p className="text-sm text-[var(--color-muted)]">
        Add your own key each time you open or reload the app. It stays in
        memory; provider charges apply. Cloud AI requires internet.
      </p>
      <Field label="Provider">
        <select
          className="field-select"
          value={provider}
          onChange={(e) => {
            setProvider(e.target.value);
            setPaid(false);
            setModel("");
          }}
        >
          {["gemini", "openai", "anthropic", "deepseek", "xai"].map((p) => (
            <option key={p} value={p}>
              {p === "openai"
                ? "OpenAI"
                : p === "xai"
                  ? "xAI"
                  : p[0].toUpperCase() + p.slice(1)}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Model ID · optional">
        <Input
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder="Provider default"
        />
      </Field>
      <Field label="Personal API key">
        <Input
          type="password"
          autoComplete="off"
          value={key}
          onChange={(e) => {
            setKey(e.target.value);
            setPaid(false);
          }}
          required
        />
      </Field>
      {provider === "gemini" && (
        <label className="flex items-start gap-3 text-xs">
          <input
            type="checkbox"
            checked={paid}
            onChange={(e) => setPaid(e.target.checked)}
            className="mt-1"
          />
          This Gemini key belongs to a project with paid billing enabled.
          Connection validation does not verify billing.
        </label>
      )}
      <div className="flex flex-wrap gap-3">
        <Button
          variant="ghost"
          type="submit"
          disabled={busy || !key || (provider === "gemini" && !paid)}
        >
          {busy ? "Checking…" : "Check model connection"}
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            setDesktopModel();
            setMessage("Model key cleared from this app session.");
          }}
        >
          Forget model key
        </Button>
      </div>
      {message && (
        <p role="status" className="text-xs">
          {message}
        </p>
      )}
    </form>
  );
}
