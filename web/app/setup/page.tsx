"use client";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api, IS_MOCK } from "@/lib/api";
import { readSetupDraft, writeSetupDraft } from "@/lib/setupDraft";
import type { QuestionSummary } from "@/lib/features/catalog";
import { DEFAULT_CONFIG, type InterviewConfig } from "@/lib/features/profile";
import type { SessionOptions, Usage } from "@/lib/features/interview";
import { account, type User } from "@/lib/features/auth";
import { errorMessage } from "@/lib/http";
import { AppShell } from "@/components/AppShell";
import {
  Badge,
  Button,
  Field,
  Input,
  Panel,
  ErrorNotice,
} from "@/components/ui";
import {
  Avatar3D,
  INTERVIEWERS,
  interviewerName,
  type AvatarDrive,
} from "@/components/studio/Avatar3D";
import { DeviceCheck } from "@/components/studio/DeviceCheck";
import { policyDestination } from "@/lib/policyNavigation";
import { ResumeNotice } from "@/components/ResumeNotice";
const pretty = (value: string) =>
  value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const date = (value?: string) =>
  value
    ? new Date(value).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "";
function Setup() {
  const router = useRouter();
  const params = useSearchParams();
  const qid = params.get("q") ?? "";
  const packId = params.get("pack") ?? "";
  const roundId = params.get("round") ?? "";
  const draftKey = "mi_setup_draft_" + (packId ? packId + "/" + roundId : qid);
  const [question, setQuestion] = useState<QuestionSummary | null>(null);
  const [cfg, setCfg] = useState<InterviewConfig>(DEFAULT_CONFIG);
  const [minutes, setMinutes] = useState(30);
  const [now, setNow] = useState(() => Date.now());
  const [stage, setStage] = useState<"setup" | "check">("setup");
  const [user, setUser] = useState<User | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [deviceReady, setDeviceReady] = useState(false);
  const [device, setDevice] = useState("");
  const [mode, setMode] = useState<"voice" | "text">(
    IS_MOCK ? "text" : "voice",
  );
  const [funding, setFunding] = useState<"platform" | "byok">("platform");
  const [provider, setProvider] = useState("gemini");
  const [model, setModel] = useState("");
  const [key, setKey] = useState("");
  const [keyValid, setKeyValid] = useState(false);
  const [paidBilling, setPaidBilling] = useState(false);
  const [voiceAcknowledged, setVoiceAcknowledged] = useState(false);
  const [notice, setNotice] = useState("");
  const [resumeName, setResumeName] = useState("");
  const drive = useRef<AvatarDrive>({
    speaking: false,
    amplitude: 0,
    mood: "listening",
  });
  const file = useRef<HTMLInputElement>(null);
  const ready = useCallback((value: boolean) => setDeviceReady(value), []);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const draft = readSetupDraft(draftKey);
        const q: QuestionSummary = await (async () => {
          if (!packId) return api.getQuestion(qid);
          const pack = await api.getPack(packId);
          const round = pack.rounds.find((r) => r.id === roundId);
          if (!round) throw new Error("This round was not found.");
          return {
            id: "",
            title: round.title,
            track: pack.track,
            domain: round.domain,
            areas: pack.areas,
            modality: round.modality,
            difficulty: round.difficulty as QuestionSummary["difficulty"],
            tags: [],
            prompt: round.focus,
            blurb: pack.blurb,
            minutes: round.minutes,
            review_status: "preview",
          };
        })();
        if (!alive) return;
        setQuestion(q);
        setMinutes(
          draft?.minutes ??
            q.minutes ??
            (q.modality === "conversational" ? 20 : 30),
        );
        if (draft) {
          setMode(draft.mode);
          setFunding(draft.funding);
          setProvider(draft.provider);
          setModel(draft.model);
          if (draft.funding === "byok")
            setNotice(
              "Your interview options were kept. Enter your personal key again after signing in.",
            );
        }
        setCfg((c) => ({
          ...c,
          target_level: q.difficulty,
          ...draft?.config,
          include_resume: false,
        }));
        const u = await api.me();
        if (!alive) return;
        setUser(u);
        if (u) {
          const [saved, available, resume] = await Promise.all([
            api.getConfig(),
            api.getUsage(),
            api.getResume(),
          ]);
          if (!alive) return;
          setCfg({
            ...DEFAULT_CONFIG,
            ...saved,
            face_id: ["alex", "jordan", "sam"].includes(saved.face_id)
              ? saved.face_id
              : "alex",
            target_level: q.difficulty,
            ...draft?.config,
            include_resume: false,
          });
          if (resume) setResumeName(resume.filename);
          setUsage(available);
          setNow(Date.now());
        }
        if (alive) {
          try {
            sessionStorage.removeItem(draftKey);
          } catch {}
        }
      } catch (e) {
        if (alive) setError(errorMessage(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [qid, packId, roundId, draftKey]);
  useEffect(() => {
    if (!usage?.next_start_at && !usage?.next_funded_at) return;
    let cancelled = false;
    let refreshed = false;
    const timer = window.setInterval(() => {
      const time = Date.now();
      setNow(time);
      const dates = [usage.next_start_at, usage.next_funded_at].filter(
        Boolean,
      ) as string[];
      if (
        !refreshed &&
        dates.some((value) => new Date(value).getTime() <= time)
      ) {
        refreshed = true;
        void api
          .getUsage()
          .then((value) => {
            if (!cancelled) setUsage(value);
          })
          .catch(() => {
            refreshed = false;
          });
      }
    }, 30000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [usage?.next_start_at, usage?.next_funded_at]);
  const dailyBlocked =
    !!usage?.next_start_at && new Date(usage.next_start_at).getTime() > now;
  const blocked =
    !usage?.local_unlimited &&
    (dailyBlocked ||
      (funding === "platform" && usage?.funded_available === false));
  const availableAt = Math.max(
    new Date(usage?.next_start_at ?? 0).getTime() || 0,
    funding === "platform"
      ? new Date(usage?.next_funded_at ?? 0).getTime() || 0
      : 0,
  );
  async function check() {
    if (!user || user.policies_required) {
      writeSetupDraft(draftKey, {
        config: cfg,
        minutes,
        mode,
        funding,
        provider,
        model,
      });
      const returnTo = packId
        ? "/setup?pack=" + packId + "&round=" + roundId
        : "/setup?q=" + qid;
      router.push(
        user?.policies_required
          ? policyDestination(returnTo)
          : "/login?next=" +
              encodeURIComponent(
                packId
                  ? "/setup?pack=" + packId + "&round=" + roundId
                  : "/setup?q=" + qid,
              ),
      );
      return;
    }
    setBusy(true);
    setError("");
    try {
      setUsage(await api.getUsage());
      setNow(Date.now());
      setStage("check");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function validate() {
    setBusy(true);
    setError("");
    try {
      const r = await api.validateProvider({
        provider,
        model: model || undefined,
        api_key: key,
        mode,
        paid_billing_confirmed: paidBilling,
      });
      setKeyValid(r.valid);
      setNotice(
        r.valid
          ? mode === "voice"
            ? "Key and reasoning model verified. Voice connection is checked when the interview starts."
            : "Key and reasoning model verified for a text interview."
          : "The connection could not be verified.",
      );
    } catch (e) {
      setKeyValid(false);
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function start() {
    if (!question) return;
    setBusy(true);
    setError("");
    try {
      const options: SessionOptions = {
        minutes,
        mode,
        funding,
        voice_processing_acknowledged: mode === "voice" && voiceAcknowledged,
        ...(funding === "byok"
          ? {
              provider,
              model: model || undefined,
              api_key: key,
              paid_billing_confirmed: paidBilling,
            }
          : {}),
      };
      const session = await api.createSession(
        question.id,
        cfg,
        packId ? { packId, roundId } : undefined,
        options,
      );
      setKey("");
      sessionStorage.setItem("mi_device_" + session.id, device);
      router.push("/interview?s=" + encodeURIComponent(session.id));
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }
  if (!question)
    return (
      <AppShell active="interview">
        {error ? (
          <ErrorNotice
            message={error}
            onRetry={() => window.location.reload()}
          />
        ) : (
          <p role="status">Preparing the interview brief…</p>
        )}
        <Button href="/interviews" variant="ghost" className="mt-5">
          Back to interviews
        </Button>
      </AppShell>
    );
  return (
    <AppShell active="interview">
      <a href="/interviews" className="text-sm text-[var(--color-muted)]">
        ← All interviews
      </a>
      <div className="mt-7 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="eyebrow">
            {stage === "setup" ? "01 · Make it yours" : "02 · A quick check"}
          </p>
          <h1 className="page-title mt-3">
            {stage === "setup"
              ? "A little preparation goes a long way."
              : "Ready when you are."}
          </h1>
          <p className="mt-3 text-[var(--color-muted)]">
            {stage === "setup"
              ? "Choose your level and pace. Everything else is optional."
              : "Check your connection and devices before the interview begins."}
          </p>
        </div>
        <Badge>
          {question.review_status === "reviewed"
            ? "Reviewed scenario"
            : "Community preview"}
        </Badge>
      </div>
      <div className="mt-8 grid gap-6 lg:grid-cols-[1.7fr_1fr]">
        <div className="space-y-5">
          <Panel className="p-6 sm:p-7">
            <p className="eyebrow">
              {pretty(question.areas?.[0] ?? question.track)} ·{" "}
              {pretty(question.domain)}
            </p>
            <h2 className="mt-3 text-xl font-semibold">{question.title}</h2>
            <p className="mt-3 whitespace-pre-wrap text-sm text-[var(--color-muted)]">
              {question.prompt}
            </p>
            {stage === "setup" ? (
              <>
                <div className="mt-7 grid gap-5 sm:grid-cols-2">
                  <Field label="Target level">
                    <select
                      className="field-select"
                      value={cfg.target_level}
                      onChange={(e) =>
                        setCfg({
                          ...cfg,
                          target_level: e.target
                            .value as InterviewConfig["target_level"],
                        })
                      }
                    >
                      {["entry", "junior", "mid", "senior", "staff"].map(
                        (l) => (
                          <option key={l} value={l}>
                            {pretty(l)}
                          </option>
                        ),
                      )}
                    </select>
                  </Field>
                  <Field label="Time available">
                    <select
                      className="field-select"
                      value={minutes}
                      onChange={(e) => setMinutes(Number(e.target.value))}
                    >
                      {[...new Set([8, 15, 20, 30, 45, 60, minutes])]
                        .sort((a, b) => a - b)
                        .map((m) => (
                          <option key={m} value={m}>
                            {m} minutes
                          </option>
                        ))}
                    </select>
                  </Field>
                </div>
                <details className="mt-7 border-t border-[var(--color-line)] pt-5">
                  <summary className="text-sm font-semibold">
                    Your interviewer & other options
                  </summary>
                  <div className="mt-5 grid gap-5 sm:grid-cols-2">
                    <Field label="Challenge">
                      <select
                        className="field-select"
                        value={cfg.challenge}
                        onChange={(e) =>
                          setCfg({
                            ...cfg,
                            challenge: e.target
                              .value as InterviewConfig["challenge"],
                          })
                        }
                      >
                        {["foundation", "standard", "stretch"].map((x) => (
                          <option key={x} value={x}>
                            {pretty(x)}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Interviewer style">
                      <select
                        className="field-select"
                        value={cfg.personality}
                        onChange={(e) =>
                          setCfg({
                            ...cfg,
                            personality: e.target
                              .value as InterviewConfig["personality"],
                          })
                        }
                      >
                        <option value="neutral">Balanced</option>
                        <option value="supportive">Warm</option>
                        <option value="interruptive">Direct probing</option>
                      </select>
                    </Field>
                    <Field label="Practice mode">
                      <select
                        className="field-select"
                        value={cfg.practice_mode}
                        onChange={(e) =>
                          setCfg({
                            ...cfg,
                            practice_mode: e.target
                              .value as InterviewConfig["practice_mode"],
                          })
                        }
                      >
                        <option value="simulation">Interview simulation</option>
                        <option value="coaching">
                          Coaching · hints allowed
                        </option>
                      </select>
                    </Field>
                    <Field label="Interviewer">
                      <select
                        className="field-select"
                        value={cfg.face_id}
                        onChange={(e) =>
                          setCfg({ ...cfg, face_id: e.target.value })
                        }
                      >
                        {INTERVIEWERS.map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Language">
                      <select
                        className="field-select"
                        value={cfg.language ?? "en"}
                        onChange={(e) =>
                          setCfg({ ...cfg, language: e.target.value })
                        }
                      >
                        {[
                          { id: "en", label: "English" },
                          { id: "es", label: "Spanish" },
                          { id: "fr", label: "French" },
                          { id: "de", label: "German" },
                          { id: "hi", label: "Hindi" },
                          { id: "ja", label: "Japanese" },
                          { id: "zh", label: "Chinese" },
                        ].map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.label}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Voice">
                      <select
                        className="field-select"
                        value={cfg.voice_id}
                        onChange={(e) =>
                          setCfg({ ...cfg, voice_id: e.target.value })
                        }
                      >
                        {[
                          "aoede",
                          "kore",
                          "leda",
                          "charon",
                          "fenrir",
                          "orus",
                        ].map((x) => (
                          <option key={x} value={x}>
                            {pretty(x)}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  <div className="mt-5">
                    <ResumeNotice />
                    <Button
                      variant="ghost"
                      onClick={() => file.current?.click()}
                      disabled={!user || busy || user.policies_required}
                    >
                      {resumeName
                        ? "Replace optional resume"
                        : "Add a resume · optional"}
                    </Button>
                    <input
                      ref={file}
                      type="file"
                      hidden
                      accept=".pdf,.docx,.txt,.md"
                      onChange={async (e) => {
                        const f = e.target.files?.[0];
                        if (!f) return;
                        setBusy(true);
                        try {
                          const r = await api.uploadResume(f);
                          setResumeName(r.filename);
                          setCfg((c) => ({ ...c, include_resume: true }));
                        } catch (e) {
                          setError(errorMessage(e));
                        } finally {
                          setBusy(false);
                        }
                      }}
                    />
                    {resumeName && (
                      <label className="mt-4 flex items-center gap-3 text-sm">
                        <input
                          type="checkbox"
                          checked={cfg.include_resume === true}
                          onChange={(e) =>
                            setCfg({ ...cfg, include_resume: e.target.checked })
                          }
                        />
                        Use {resumeName} for this interview
                      </label>
                    )}
                    <p className="mt-2 text-xs text-[var(--color-muted)]">
                      {!user
                        ? "Sign in to attach a resume. You can practice without one."
                        : "Use a resume you are permitted to share with the model provider."}
                    </p>
                  </div>
                </details>
              </>
            ) : (
              <>
                <div className="my-6">
                  <Field label="How would you like to answer?">
                    <select
                      value={mode}
                      onChange={(e) => {
                        setMode(e.target.value as "voice" | "text");
                        setVoiceAcknowledged(false);
                        setKeyValid(false);
                      }}
                      className="field-select"
                    >
                      <option
                        value="voice"
                        disabled={
                          IS_MOCK ||
                          (funding === "byok" && provider !== "gemini")
                        }
                      >
                        Voice conversation
                      </option>
                      <option value="text">
                        Text conversation · no microphone
                      </option>
                    </select>
                  </Field>
                </div>
                <DeviceCheck
                  key={mode}
                  mode={mode}
                  onReady={ready}
                  onDevice={setDevice}
                />
                {mode === "voice" && (
                  <label className="mt-5 flex items-start gap-3 text-sm">
                    <input
                      className="mt-1"
                      type="checkbox"
                      checked={voiceAcknowledged}
                      onChange={(e) => setVoiceAcknowledged(e.target.checked)}
                    />
                    <span>
                      When I start, my microphone audio will stream to
                      mockinterview and Google Gemini for this AI conversation,
                      and my transcript will be saved. I will speak in a private
                      space without recording other people. I can choose text
                      above instead.{" "}
                      <a
                        href="/privacy"
                        className="underline"
                        target="_blank"
                        rel="noopener"
                      >
                        Privacy details
                      </a>
                    </span>
                  </label>
                )}
                <Button
                  className="mt-6"
                  variant="ghost"
                  onClick={() => setStage("setup")}
                >
                  Back to options
                </Button>
              </>
            )}
          </Panel>
          {error && <ErrorNotice message={error} />}
          <p className="text-xs text-[var(--color-muted)]">
            This is AI practice, not a hiring decision or professional
            certification.{" "}
            <a href="/privacy" className="underline">
              How your data is used
            </a>
          </p>
        </div>
        <aside className="space-y-5">
          <Panel className="p-6">
            <div className="flex items-center gap-4">
              <div className="h-20 w-20 shrink-0">
                <Avatar3D faceId={cfg.face_id} drive={drive} />
              </div>
              <div>
                <h2 className="font-semibold">
                  {interviewerName(cfg.face_id)}
                </h2>
                <p className="mt-1 text-xs text-[var(--color-muted)]">
                  Your AI interviewer
                  <br />
                  {pretty(cfg.target_level ?? "mid")} · {minutes} minutes
                </p>
              </div>
            </div>
            <div className="mt-6 space-y-4 border-t border-[var(--color-line)] pt-5">
              <Field label="Practice access">
                <select
                  value={funding}
                  onChange={(e) => {
                    setFunding(e.target.value as "platform" | "byok");
                    setKeyValid(false);
                  }}
                  className="field-select"
                >
                  <option value="platform">Platform-funded interview</option>
                  <option value="byok">Use my model & API key</option>
                </select>
              </Field>
              {funding === "byok" && (
                <div className="space-y-4">
                  <Field label="Provider">
                    <select
                      value={provider}
                      onChange={(e) => {
                        setProvider(e.target.value);
                        setPaidBilling(false);
                        setKeyValid(false);
                        if (e.target.value !== "gemini") setMode("text");
                      }}
                      className="field-select"
                    >
                      {["gemini", "openai", "anthropic", "deepseek", "xai"].map(
                        (p) => (
                          <option key={p} value={p}>
                            {pretty(p)}
                          </option>
                        ),
                      )}
                    </select>
                  </Field>
                  <Field label="API key">
                    <Input
                      type="password"
                      autoComplete="off"
                      value={key}
                      onChange={(e) => {
                        setKey(e.target.value);
                        setPaidBilling(false);
                        setKeyValid(false);
                      }}
                      placeholder="Used only for this attempt"
                    />
                  </Field>
                  <Field label="Text / feedback model · optional">
                    <Input
                      value={model}
                      onChange={(e) => {
                        setModel(e.target.value);
                        setKeyValid(false);
                      }}
                      placeholder="Provider default"
                    />
                  </Field>
                  <p className="text-xs text-[var(--color-muted)]">
                    {provider !== "gemini"
                      ? "This provider supports text interviews in this release. "
                      : ""}
                    Gemini voice uses the service’s configured Live model. Your
                    provider may charge for use. One hosted attempt per 24
                    hours.
                  </p>
                  {provider === "gemini" && (
                    <label className="flex items-start gap-3 text-xs">
                      <input
                        className="mt-1"
                        type="checkbox"
                        checked={paidBilling}
                        onChange={(e) => {
                          setPaidBilling(e.target.checked);
                          setKeyValid(false);
                        }}
                      />
                      <span>
                        This key belongs to a Google project with paid billing
                        enabled. Free-tier Gemini keys are unsuitable for
                        personal interview data.{" "}
                        <a
                          className="underline"
                          href="https://ai.google.dev/gemini-api/docs/billing"
                          target="_blank"
                          rel="noopener"
                        >
                          Check billing in Google AI Studio
                        </a>
                        . Connection validation does not verify billing.
                      </span>
                    </label>
                  )}
                  <Button
                    variant="ghost"
                    onClick={() => void validate()}
                    disabled={
                      !key ||
                      busy ||
                      !user ||
                      user.policies_required ||
                      (provider === "gemini" && !paidBilling)
                    }
                  >
                    {keyValid
                      ? "Connection verified"
                      : "Check model connection"}
                  </Button>
                  {notice && (
                    <p role="status" className="text-xs">
                      {notice}
                    </p>
                  )}
                </div>
              )}
              <div className="notice">
                {!user
                  ? "Sign in to see your practice allowance."
                  : !usage
                    ? "Checking your practice allowance…"
                    : usage?.local_unlimited
                      ? "Local installation · no product practice limit."
                      : blocked
                        ? "Next available: " +
                          date(
                            availableAt
                              ? new Date(availableAt).toISOString()
                              : undefined,
                          )
                        : funding === "platform"
                          ? "Your weekly interview is available."
                          : "Your daily personal-key interview is available."}
              </div>
              {user?.email_verified === false && !usage?.local_unlimited && (
                <div className="notice">
                  <p>Verify your email before starting.</p>
                  <Button
                    variant="ghost"
                    className="mt-3"
                    onClick={() => {
                      void account
                        .resend()
                        .then(() =>
                          setNotice(
                            "Verification requested. Check your inbox.",
                          ),
                        )
                        .catch((e) => setError(errorMessage(e)));
                    }}
                  >
                    Resend verification
                  </Button>
                </div>
              )}
              {stage === "setup" ? (
                <Button
                  className="w-full"
                  onClick={() => void check()}
                  disabled={busy}
                >
                  {user?.policies_required
                    ? "Review terms to continue →"
                    : user
                      ? "Check devices →"
                      : "Sign in to continue →"}
                </Button>
              ) : (
                <Button
                  className="w-full"
                  onClick={() => void start()}
                  disabled={
                    busy ||
                    !usage ||
                    blocked ||
                    !deviceReady ||
                    user?.policies_required ||
                    (mode === "voice" && !voiceAcknowledged) ||
                    (funding === "byok" && !keyValid) ||
                    (user?.email_verified === false && !usage?.local_unlimited)
                  }
                >
                  {busy ? "Preparing interview…" : "Start interview →"}
                </Button>
              )}
              <p className="text-center text-xs text-[var(--color-muted)]">
                Checks do not consume your allowance.
              </p>
              {blocked && (
                <Button href="/contribute" variant="ghost" className="w-full">
                  Run locally for more practice
                </Button>
              )}
              {usage?.active_session_id && (
                <Button
                  href={"/interview?s=" + usage.active_session_id}
                  variant="ghost"
                  className="w-full"
                >
                  Resume your active interview
                </Button>
              )}
            </div>
          </Panel>
        </aside>
      </div>
    </AppShell>
  );
}
export default function SetupPage() {
  return (
    <Suspense fallback={<p className="p-10">Loading setup…</p>}>
      <Setup />
    </Suspense>
  );
}
