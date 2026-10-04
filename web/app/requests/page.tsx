"use client";
import { useState } from "react";
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
          Tell us which interview is missing. Your request goes privately to the
          maintainer. You can also build a custom interview today.
        </p>
        <Panel className="mt-8 p-6 sm:p-8">
          {sent ? (
            <>
              <h2 className="text-xl font-semibold">Request received</h2>
              <p className="mt-3 text-sm">
                Thank you. We’ll use your request to help prioritize new
                templates.
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
                  await communityApi.requestTemplate(form);
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
                A verified account is required. Please leave out confidential
                employer or client information.
              </p>
              <Button type="submit" disabled={busy}>
                {busy ? "Sending…" : "Send template request"}
              </Button>
            </form>
          )}
        </Panel>
      </div>
    </AppShell>
  );
}
