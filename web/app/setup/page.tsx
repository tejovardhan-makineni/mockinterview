"use client";
import { providerName } from "@/lib/providers";
import Link from "next/link";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api, IS_MOCK } from "@/lib/api";
import {
  ROLE_TRACKS,
  levelAfterTrackChange,
  levelLabel,
  levelsForRoleTrack,
  roleTrackLabel,
  type RoleTrack,
} from "@/lib/roleScope";
import { readSetupDraft, writeSetupDraft } from "@/lib/setupDraft";
import type { QuestionSummary } from "@/lib/features/catalog";
import { DEFAULT_CONFIG, type InterviewConfig } from "@/lib/features/profile";
import type {
  CustomInterview,
  SessionOptions,
  Usage,
} from "@/lib/features/interview";
import { account, type User } from "@/lib/features/auth";
import {
  RequiredFeedbackNotice,
  useRequiredFeedback,
} from "@/components/RequiredFeedbackNotice";
import { IS_DESKTOP } from "@/lib/desktop";
import {
  ApiError,
  errorMessage,
  getDesktopModel,
  setDesktopModel,
} from "@/lib/http";
import { AnalyticsSettings } from "@/components/AnalyticsSettings";
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
  const isCustom = params.get("custom") === "1";
  const [custom, setCustom] = useState<CustomInterview>({
    profession: "",
    goal: "",
    level: "Senior",
    questions: "",
    structure: "",
  });
  const packId = params.get("pack") ?? "";
  const roundId = params.get("round") ?? "";
  const draftKey =
    "mi_setup_draft_" +
    (isCustom ? "custom" : packId ? packId + "/" + roundId : qid);
  const [question, setQuestion] = useState<QuestionSummary | null>(null);
  const [cfg, setCfg] = useState<InterviewConfig>(DEFAULT_CONFIG);
  const [minutes, setMinutes] = useState(30);
  const [now, setNow] = useState(() => Date.now());
  const [stage, setStage] = useState<"setup" | "check">("setup");
  const stageHeading = useRef<HTMLHeadingElement>(null);
  const previousStage = useRef(stage);
  useEffect(() => {
    if (previousStage.current === stage) return;
    previousStage.current = stage;
    stageHeading.current?.focus({ preventScroll: true });
    stageHeading.current?.scrollIntoView?.({ block: "start" });
  }, [stage]);
  const [user, setUser] = useState<User | null>(null);
  const {
    pending,
    error: pendingError,
    refresh: refreshPending,
  } = useRequiredFeedback(!!user);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [deviceReady, setDeviceReady] = useState(false);
  const [device, setDevice] = useState("");
  const [camera, setCamera] = useState(false);
  const [mode, setMode] = useState<"voice" | "text">(
    IS_MOCK ? "text" : "voice",
  );
  const [funding, setFunding] = useState<"platform" | "byok">(
    IS_DESKTOP ? "byok" : "platform",
  );
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
  const validationGeneration = useRef(0);
  function invalidateKey() {
    validationGeneration.current++;
    setKeyValid(false);
    setNotice("");
  }
  const ready = useCallback((value: boolean) => setDeviceReady(value), []);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const draft = readSetupDraft(draftKey);
        const savedModel = getDesktopModel();
        if (savedModel) {
          setProvider(savedModel.provider);
          setModel(savedModel.model);
          setKey(savedModel.apiKey);
          if (savedModel.provider !== "gemini") setMode("text");
        }
        if (isCustom && draft?.custom) setCustom(draft.custom);
        const q: QuestionSummary = await (async () => {
          if (isCustom)
            return {
              id: "",
              title: "Your custom interview",
              track: "general",
              domain: "custom",
              modality: "conversational",
              difficulty: "senior",
              minutes: 20,
              tags: [],
              areas: [],
              prompt:
                "Describe the role and what you want to practice. Your AI interviewer will plan a format, questions, and follow-ups around your brief.",
              blurb: "Your brief, your practice.",
              review_status: "preview",
            };
          if (!packId) return api.getQuestion(qid);
          const pack = await api.getPack(packId);
          const round = pack.rounds.find((r) => r.id === roundId);
          if (!round) throw new Error("This round was not found.");
          if (round.question_id) {
            const scenario = await api.getQuestion(round.question_id);
            return {
              ...scenario,
              id: "", // The server still resolves and records this pack round.
              title: round.title,
              minutes: round.minutes,
              difficulty: round.difficulty || scenario.difficulty,
              role_track: round.role_track ?? scenario.role_track,
            };
          }
          return {
            id: "",
            title: round.title,
            track: pack.track,
            domain: round.domain,
            areas: pack.areas,
            modality: round.modality,
            difficulty: round.difficulty || "mid",
            role_track: round.role_track,
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
          setFunding(IS_DESKTOP ? "byok" : draft.funding);
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
          role_track: q.role_track,
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
            role_track: q.role_track,
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
  }, [qid, packId, roundId, draftKey, isCustom]);
  useEffect(() => {
    if (
      !usage?.next_start_at &&
      !usage?.next_funded_at &&
      !usage?.global_reset_at
    )
      return;
    let cancelled = false;
    let refreshed = false;
    const timer = window.setInterval(() => {
      const time = Date.now();
      setNow(time);
      const dates = [
        usage.next_start_at,
        usage.next_funded_at,
        usage.global_reset_at,
      ].filter(Boolean) as string[];
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
  }, [usage?.next_start_at, usage?.next_funded_at, usage?.global_reset_at]);
  const dailyBlocked =
    !!usage?.next_start_at && new Date(usage.next_start_at).getTime() > now;
  const projectBlocked =
    funding === "platform" && usage?.global_daily_remaining === 0;
  const freeInterviewUsed =
    !usage?.local_unlimited &&
    !usage?.tester_unlimited &&
    (usage?.free_interview_used === true ||
      (usage?.funded_available === false && !projectBlocked));
  const blocked =
    projectBlocked ||
    (!usage?.local_unlimited &&
      !usage?.tester_unlimited &&
      funding === "platform" &&
      (dailyBlocked || freeInterviewUsed || usage?.funded_available === false));
  const allowanceMessage = IS_DESKTOP
    ? "Your key · no app interview limit. Provider charges apply."
    : !user
      ? "Sign in for your one free interview."
      : !usage
        ? "Checking your practice allowance…"
        : funding === "byok"
          ? "Your key · unlimited interviews. Provider charges apply."
          : usage.local_unlimited
            ? "Local installation · no product practice limit."
            : freeInterviewUsed
              ? "Your free interview has been used. Add your own API key to keep practicing."
              : projectBlocked
                ? "Today’s free interview capacity is full." +
                  (usage.global_reset_at
                    ? " Available again " + date(usage.global_reset_at) + "."
                    : " Please try again tomorrow.")
                : usage.tester_unlimited
                  ? "Tester access · unlimited interviews within daily project capacity."
                  : dailyBlocked
                    ? "Next available: " + date(usage.next_start_at)
                    : "Your one free interview is available.";
  const startBlockers = [
    ...(!usage ? ["Wait for your practice allowance to load."] : []),
    ...(pending?.total ? ["Complete your previous interview’s check-in."] : []),
    ...(blocked ? [allowanceMessage] : []),
    ...(user?.policies_required
      ? ["Review the current terms to continue."]
      : []),
    ...(!IS_DESKTOP && user?.email_verified === false && !usage?.local_unlimited
      ? ["Verify your email before starting."]
      : []),
    ...(mode === "voice" && !deviceReady
      ? ["Check your microphone, or choose a text conversation."]
      : []),
    ...(mode === "voice" && !voiceAcknowledged
      ? ["Confirm the voice privacy checkbox below your device checks."]
      : []),
    ...(funding === "byok" && !keyValid
      ? [
          provider === "gemini" && !paidBilling
            ? "Add your API key, confirm paid billing, and check the model connection."
            : "Add your API key and check the model connection.",
        ]
      : []),
  ];
  const returnTo = isCustom
    ? "/setup?custom=1"
    : packId
      ? "/setup?pack=" +
        encodeURIComponent(packId) +
        "&round=" +
        encodeURIComponent(roundId)
      : "/setup?q=" + encodeURIComponent(qid);
  function preserveOptions() {
    writeSetupDraft(draftKey, {
      config: cfg,
      minutes,
      mode,
      funding,
      provider,
      model,
      custom: isCustom ? custom : undefined,
    });
  }
  async function check() {
    if (
      isCustom &&
      (!custom.profession.trim() || !custom.goal.trim() || !custom.level.trim())
    ) {
      setError("Add your profession, practice goal, and experience level.");
      return;
    }
    if (!user || user.policies_required) {
      preserveOptions();
      router.push(
        user?.policies_required
          ? policyDestination(returnTo)
          : "/login?next=" + encodeURIComponent(returnTo),
      );
      return;
    }
    setBusy(true);
    setError("");
    try {
      const feedback = await refreshPending();
      if (feedback?.total) return;
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
    const own = ++validationGeneration.current;
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
      if (own !== validationGeneration.current) return;
      setKeyValid(r.valid);
      if (r.valid && r.model) setModel(r.model);
      if (r.valid)
        setDesktopModel({ provider, model: r.model || model, apiKey: key });
      setNotice(
        r.valid
          ? mode === "voice"
            ? "Key and reasoning model verified. Voice connection is checked when the interview starts."
            : "Key and reasoning model verified for a text interview."
          : "The connection could not be verified.",
      );
    } catch (e) {
      if (own !== validationGeneration.current) return;
      setKeyValid(false);
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function start() {
    if (!question || busy || startBlockers.length > 0) return;
    setBusy(true);
    setError("");
    try {
      const options: SessionOptions = {
        minutes,
        mode,
        funding: IS_DESKTOP ? "byok" : funding,
        custom: isCustom ? custom : undefined,
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
      sessionStorage.setItem("mi_camera_" + session.id, camera ? "1" : "0");
      router.push("/interview?s=" + encodeURIComponent(session.id));
    } catch (e) {
      if (e instanceof ApiError && e.code === "interview_feedback_required") {
        await refreshPending().catch(() => {});
        setError(
          "Complete the required check-in for your previous interview before starting another. Your choices here are kept when you use the check-in link.",
        );
      } else {
        setError(errorMessage(e));
        if (
          e instanceof ApiError &&
          (e.code === "daily_capacity_reached" ||
            e.code === "free_interview_used")
        ) {
          // Another interview may claim the last place after the check. Show
          // the server's current allowance instead of leaving a stale start CTA.
          await api
            .getUsage()
            .then((value) => {
              setUsage(value);
              setNow(Date.now());
            })
            .catch(() => {});
        }
      }
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
      <Link href="/interviews" className="text-sm text-[var(--color-muted)]">
        ← All interviews
      </Link>
      {pending && (
        <RequiredFeedbackNotice
          pending={pending}
          next={returnTo}
          onNavigate={preserveOptions}
        />
      )}
      {pendingError && (
        <ErrorNotice
          message={"Check-in status could not load. " + pendingError}
          onRetry={() => void refreshPending().catch(() => {})}
        />
      )}
      <div className="mt-7 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="eyebrow">
            {stage === "setup" ? "01 · Make it yours" : "02 · A quick check"}
          </p>
          <h1
            ref={stageHeading}
            tabIndex={-1}
            className="page-title mt-3 scroll-mt-6"
          >
            {stage === "setup" ? "Set up your interview" : "Check your devices"}
          </h1>
          <p className="mt-3 text-[var(--color-muted)]">
            {stage === "setup"
              ? "Choose your level and time. Personalize the rest if you’d like."
              : "Verify your microphone, check your sound, and start when you’re ready."}
          </p>
        </div>
        <Badge>
          {question.review_status === "reviewed"
            ? "Reviewed scenario"
            : "Community preview"}
        </Badge>
      </div>
      <div className="mt-8 grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)] lg:gap-6">
        <div className="min-w-0 space-y-5">
          <Panel className="p-4 sm:p-6 lg:p-7">
            <p className="eyebrow">
              {pretty(question.areas?.[0] ?? question.track)} ·{" "}
              {pretty(question.domain)}
            </p>
            <h2 className="mt-3 text-xl font-semibold">{question.title}</h2>
            {stage === "setup" ? (
              <p className="mt-3 whitespace-pre-wrap text-sm text-[var(--color-muted)]">
                {question.prompt}
              </p>
            ) : (
              <details className="mt-3 text-sm text-[var(--color-muted)]">
                <summary>Review your opening brief · {minutes} minutes</summary>
                <p className="mt-2 whitespace-pre-wrap">{question.prompt}</p>
              </details>
            )}
            {question.format_name && (
              <p className="mt-4 text-xs text-[var(--color-muted)]">
                Interview format · {question.format_name}
              </p>
            )}
            {stage === "setup" ? (
              <>
                {isCustom && (
                  <div className="mt-6 space-y-5">
                    <div className="grid gap-5 sm:grid-cols-2">
                      <Field label="Profession">
                        <Input
                          required
                          maxLength={160}
                          value={custom.profession}
                          placeholder="e.g. Staff product designer"
                          onChange={(e) =>
                            setCustom({ ...custom, profession: e.target.value })
                          }
                        />
                      </Field>
                      <Field label="Experience level">
                        <Input
                          required
                          maxLength={120}
                          value={custom.level}
                          placeholder="e.g. Senior, 8 years"
                          onChange={(e) =>
                            setCustom({ ...custom, level: e.target.value })
                          }
                        />
                      </Field>
                    </div>
                    <Field label="What would you like to achieve?">
                      <textarea
                        className="field-select min-h-24"
                        required
                        maxLength={2000}
                        value={custom.goal}
                        placeholder="Practice explaining design decisions to an engineering panel."
                        onChange={(e) =>
                          setCustom({ ...custom, goal: e.target.value })
                        }
                      />
                    </Field>
                    <Field label="Your questions · optional">
                      <textarea
                        className="field-select min-h-32"
                        maxLength={12000}
                        value={custom.questions}
                        placeholder="Add questions you want to rehearse, one per line."
                        onChange={(e) =>
                          setCustom({ ...custom, questions: e.target.value })
                        }
                      />
                    </Field>
                    <Field label="Structure & instructions · optional">
                      <textarea
                        className="field-select min-h-24"
                        maxLength={4000}
                        value={custom.structure}
                        placeholder="Start with a project walkthrough, challenge my tradeoffs, then discuss leadership."
                        onChange={(e) =>
                          setCustom({ ...custom, structure: e.target.value })
                        }
                      />
                    </Field>
                    <p className="text-xs text-[var(--color-muted)]">
                      Original practice from your brief. The AI chooses a
                      suitable interview format; it is not a reviewed template.
                    </p>
                  </div>
                )}
                <div className="mt-7 grid gap-5 sm:grid-cols-2">
                  <Field
                    label="Role track"
                    hint={
                      isCustom
                        ? "Choose the responsibilities to practice; your brief defines the seniority."
                        : "This adapts the selected scenario; its task and scoring criteria stay the same."
                    }
                  >
                    <select
                      aria-label="Role track"
                      className="field-select"
                      value={cfg.role_track ?? ""}
                      onChange={(e) => {
                        const track = (e.target.value || undefined) as
                          RoleTrack | undefined;
                        setCfg({
                          ...cfg,
                          role_track: track,
                          target_level: isCustom
                            ? cfg.target_level
                            : levelAfterTrackChange(track, cfg.target_level),
                        });
                      }}
                    >
                      {!question.role_track && (
                        <option value="">Across roles / unspecified</option>
                      )}
                      {ROLE_TRACKS.map((track) => (
                        <option key={track} value={track}>
                          {roleTrackLabel(track)}
                        </option>
                      ))}
                    </select>
                  </Field>
                  {!isCustom && (
                    <Field label="Target level">
                      <select
                        aria-label="Target level"
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
                        {levelsForRoleTrack(
                          cfg.role_track,
                          cfg.target_level,
                        ).map((l) => (
                          <option key={l} value={l}>
                            {levelLabel(l)}
                          </option>
                        ))}
                      </select>
                    </Field>
                  )}
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
                      <label className="mt-4 flex min-w-0 items-start gap-3 text-sm">
                        <input
                          type="checkbox"
                          checked={cfg.include_resume === true}
                          onChange={(e) =>
                            setCfg({ ...cfg, include_resume: e.target.checked })
                          }
                        />
                        <span className="min-w-0 break-words">
                          Use {resumeName} for this interview
                        </span>
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
                        invalidateKey();
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
                  camera={camera}
                  onCamera={setCamera}
                />
                {mode === "voice" && (
                  <label className="mt-4 flex items-start gap-3 rounded-lg bg-[var(--color-panel-2)] p-3 text-xs">
                    <input
                      className="mt-1"
                      type="checkbox"
                      checked={voiceAcknowledged}
                      onChange={(e) => setVoiceAcknowledged(e.target.checked)}
                    />
                    <span className="min-w-0">
                      {IS_DESKTOP
                        ? "When I start, my microphone audio will stream through this local app to Google Gemini, and my transcript will be saved on this computer."
                        : "When I start, my microphone audio will stream to mockinterview and Google Gemini for this AI conversation, and my transcript will be saved."}{" "}
                      I will speak in a private space without recording other
                      people. I can choose text above instead.{" "}
                      <Link
                        href="/privacy"
                        className="underline"
                        target="_blank"
                        rel="noopener"
                      >
                        Privacy details
                      </Link>
                    </span>
                  </label>
                )}
                <Button
                  className="mt-4"
                  size="sm"
                  variant="ghost"
                  onClick={() => setStage("setup")}
                >
                  Back to options
                </Button>
              </>
            )}
          </Panel>
          {error && <ErrorNotice message={error} />}
          {user && stage === "setup" && (
            <Panel className="p-4 sm:p-6">
              <AnalyticsSettings userId={user.id} compact={IS_DESKTOP} />
            </Panel>
          )}
          <p className="text-xs text-[var(--color-muted)]">
            This is AI practice, not a hiring decision or professional
            certification.{" "}
            <Link href="/privacy" className="underline">
              How your data is used
            </Link>
          </p>
        </div>
        <aside className="min-w-0 space-y-5">
          <Panel className="p-4 sm:p-6">
            <div className="flex items-center gap-4">
              <div className="h-20 w-20 shrink-0">
                <Avatar3D faceId={cfg.face_id} drive={drive} />
              </div>
              <div className="min-w-0">
                <h2 className="font-semibold">
                  {interviewerName(cfg.face_id)}
                </h2>
                <p className="mt-1 text-xs text-[var(--color-muted)]">
                  Your AI interviewer
                  <br />
                  {isCustom
                    ? custom.level
                    : levelLabel(cfg.target_level ?? "mid")}{" "}
                  · {minutes} minutes
                  {cfg.role_track && <> · {roleTrackLabel(cfg.role_track)}</>}
                </p>
              </div>
            </div>
            {question.agent && (
              <div className="mt-5 border-t border-[var(--color-line)] pt-5">
                <p className="eyebrow">Specialist AI interviewer</p>
                <h3 className="mt-2 text-sm font-semibold">
                  {question.agent.name}
                </h3>
                <p className="mt-2 text-sm text-[var(--color-muted)]">
                  {question.agent.summary}
                </p>
              </div>
            )}
            <div className="mt-6 space-y-4 border-t border-[var(--color-line)] pt-5">
              {IS_DESKTOP ? (
                <div className="notice text-sm">
                  Your API key is required. Interviews and reports save on this
                  computer; cloud AI needs internet. No free interviews are
                  included in the desktop app.
                </div>
              ) : (
                <Field label="Practice access">
                  <select
                    value={funding}
                    onChange={(e) => {
                      setFunding(e.target.value as "platform" | "byok");
                      invalidateKey();
                    }}
                    className="field-select"
                  >
                    <option value="platform">
                      {usage?.local_unlimited
                        ? "Local model / demo"
                        : "Free · Gemini 3.8 Flash"}
                    </option>
                    <option value="byok">Use my model & API key</option>
                  </select>
                </Field>
              )}
              {funding === "byok" && (
                <div className="space-y-4">
                  <Field label="Provider">
                    <select
                      value={provider}
                      onChange={(e) => {
                        setProvider(e.target.value);
                        setModel("");
                        setPaidBilling(false);
                        invalidateKey();
                        if (e.target.value !== "gemini") setMode("text");
                      }}
                      className="field-select"
                    >
                      {["gemini", "openai", "anthropic", "deepseek", "xai"].map(
                        (p) => (
                          <option key={p} value={p}>
                            {providerName(p)}
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
                        invalidateKey();
                      }}
                      placeholder="Your provider API key"
                    />
                  </Field>
                  <Field label="Model ID · optional">
                    <Input
                      value={model}
                      onChange={(e) => {
                        setModel(e.target.value);
                        invalidateKey();
                      }}
                      placeholder="Provider default"
                    />
                  </Field>
                  <p className="text-xs text-[var(--color-muted)]">
                    {provider !== "gemini"
                      ? "This provider supports text interviews in this release. "
                      : ""}
                    Choose a model available to your key, including advanced
                    models. Connection checks validate access before you start.
                    Gemini voice uses the configured Live model. Unlimited
                    interviews with your key; provider charges apply.
                  </p>
                  {provider === "gemini" && (
                    <label className="flex items-start gap-3 text-xs">
                      <input
                        className="mt-1"
                        type="checkbox"
                        checked={paidBilling}
                        onChange={(e) => {
                          setPaidBilling(e.target.checked);
                          invalidateKey();
                        }}
                      />
                      <span className="min-w-0">
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
                    className="w-full sm:w-auto"
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
              <div
                className="rounded-lg bg-[var(--color-panel-2)] px-3 py-2.5 text-xs"
                role="status"
              >
                <p>{allowanceMessage}</p>
                {!IS_DESKTOP &&
                  funding === "platform" &&
                  !usage?.local_unlimited && (
                    <p className="mt-1 text-[var(--color-muted)]">
                      Beta includes one free interview per person, with up to{" "}
                      {usage?.global_daily_limit ?? 200} free interviews across
                      the project each day (UTC).
                    </p>
                  )}
              </div>
              {!IS_DESKTOP &&
                user?.email_verified === false &&
                !usage?.local_unlimited && (
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
                  disabled={busy || !!pending?.total}
                >
                  {user?.policies_required
                    ? "Review terms to continue →"
                    : user
                      ? "Check devices →"
                      : "Sign in to continue →"}
                </Button>
              ) : (
                <div className="space-y-3">
                  <div
                    id="interview-start-status"
                    className="text-xs"
                    role="status"
                    aria-live="polite"
                  >
                    {startBlockers.length ? (
                      <>
                        <p className="font-semibold">Before you start</p>
                        <ul className="mt-2 list-disc space-y-1 pl-4 text-[var(--color-muted)]">
                          {startBlockers.map((reason) => (
                            <li key={reason}>{reason}</li>
                          ))}
                        </ul>
                      </>
                    ) : (
                      <p className="font-medium text-[var(--color-good)]">
                        ✓ Ready to start ·{" "}
                        {mode === "voice"
                          ? "microphone access checked and voice privacy confirmed"
                          : "text conversation selected"}
                      </p>
                    )}
                  </div>
                  <Button
                    className="w-full"
                    onClick={() => void start()}
                    aria-describedby="interview-start-status"
                    disabled={busy || startBlockers.length > 0}
                  >
                    {busy ? "Preparing interview…" : "Start interview →"}
                  </Button>
                </div>
              )}
              <p className="text-center text-xs text-[var(--color-muted)]">
                {IS_DESKTOP
                  ? "Connection checks may make a small billable request."
                  : funding === "byok"
                    ? "Device checks are free. Model checks may incur provider charges."
                    : "Device checks do not use your free interview."}
              </p>
              {blocked && (
                <Button href="/contribute" variant="ghost" className="w-full">
                  Run locally for more practice
                </Button>
              )}
              {!IS_DESKTOP && (
                <a className="block text-center text-sm underline" href="/beta">
                  Join the beta · help improve practice
                </a>
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
