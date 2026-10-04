"use client";
import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/api";
import { IS_DESKTOP } from "@/lib/desktop";
import { sendProjectCopy } from "@/lib/analytics";
import { AppShell } from "@/components/AppShell";
import { Button, ErrorNotice, Field, Input, Panel } from "@/components/ui";
import { communityApi } from "@/lib/features/community";
import { ApiError, errorMessage } from "@/lib/http";
export default function TemplateRequestPage() {
  const [form, setForm] = useState({
    profession: "",
    goal: "",
    level: "",
    description: "",
  });
  const [projectCopy, setProjectCopy] = useState(false);
  const [delivery, setDelivery] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [signIn, setSignIn] = useState(false);
  return (
    <AppShell active="public">
      <div className="mx-auto max-w-2xl">
        <p className="eyebrow">A practice library for everyone</p>
        <h1 className="page-title mt-3">Request a template</h1>
        <p className="mt-4 text-[var(--color-muted)]">
          {IS_DESKTOP
            ? "Keep an idea for a new template locally, or choose to send it privately to the project. You can also build a custom interview today."
            : "Tell us which interview is missing. Your request goes privately to the maintainer. You can also build a custom interview today."}
        </p>
        <Panel className="mt-8 p-6 sm:p-8">
          {sent ? (
            <>
              <h2 className="text-xl font-semibold">Request received</h2>
              <p className="mt-3 text-sm">
                {IS_DESKTOP
                  ? delivery
                  : "Thank you. We’ll use your request to help prioritize new templates."}
              </p>
              <Button href="/setup?custom=1" className="mt-5">
                Create a custom interview
              </Button>
            </>
          ) : (
            <form
              className="space-y-5"
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setError("");
                setSignIn(false);
                try {
                  if (IS_DESKTOP) await api.me();
                  await communityApi.requestTemplate(form);
                  if (IS_DESKTOP && projectCopy) {
                    try {
                      await sendProjectCopy(
                        "/api/v1/community/templates",
                        form,
                      );
                      setDelivery(
                        "Saved locally and delivered privately to the project admin.",
                      );
                    } catch {
                      setDelivery(
                        "Saved locally. The project copy was not delivered. Connect sharing in Settings and try again when online.",
                      );
                    }
                  } else if (IS_DESKTOP)
                    setDelivery(
                      "Saved on this computer. No copy was sent to the project.",
                    );
                  setSent(true);
                } catch (e) {
                  setError(errorMessage(e));
                  setSignIn(e instanceof ApiError && e.status === 401);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {error && <ErrorNotice message={error} />}
              {signIn && (
                <Button href="/login?next=/requests" variant="ghost">
                  Sign in to send your request
                </Button>
              )}
              <Field label="Profession">
                <Input
                  value={form.profession}
                  onChange={(e) =>
                    setForm({ ...form, profession: e.target.value })
                  }
                  placeholder="Nurse, teacher, designer…"
                  maxLength={160}
                  required
                />
              </Field>
              <Field label="Goal">
                <Input
                  value={form.goal}
                  onChange={(e) => setForm({ ...form, goal: e.target.value })}
                  placeholder="Prepare for an emergency department interview"
                  maxLength={500}
                  required
                />
              </Field>
              <Field label="Experience level">
                <Input
                  value={form.level}
                  onChange={(e) => setForm({ ...form, level: e.target.value })}
                  placeholder="Early career, senior, returning to work…"
                  maxLength={120}
                  required
                />
              </Field>
              <Field label="What should this template cover?">
                <textarea
                  className="field-select min-h-36"
                  value={form.description}
                  onChange={(e) =>
                    setForm({ ...form, description: e.target.value })
                  }
                  minLength={10}
                  maxLength={3000}
                  required
                />
              </Field>
              <p className="text-xs text-[var(--color-muted)]">
                {IS_DESKTOP
                  ? "Please leave out confidential employer or client information."
                  : "A verified account is required. Please leave out confidential employer or client information."}
              </p>
              {IS_DESKTOP && (
                <label className="flex items-start gap-3 text-sm">
                  <input
                    type="checkbox"
                    checked={projectCopy}
                    onChange={(e) => setProjectCopy(e.target.checked)}
                    className="mt-1"
                  />
                  <span>
                    Send this request to the project admin.{" "}
                    <Link href="/settings" className="underline">
                      Connect sharing
                    </Link>{" "}
                    first.
                  </span>
                </label>
              )}
              <Button type="submit" disabled={busy}>
                {busy
                  ? "Saving…"
                  : IS_DESKTOP
                    ? "Save template request"
                    : "Send template request"}
              </Button>
            </form>
          )}
        </Panel>
      </div>
    </AppShell>
  );
}
