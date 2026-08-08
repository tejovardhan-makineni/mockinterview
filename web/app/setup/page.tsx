"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import type { Face, InterviewConfig, Personality, PersonalityOption, Resume, Voice } from "@/lib/types";
import { Badge, Button, Field, Panel } from "@/components/ui";
import { Avatar3D, type AvatarDrive } from "@/components/studio/Avatar3D";
import { previewVoiceSample, stopPreview, prefetchPreview } from "@/lib/voicePreview";
import { useLang, useT, labelFor } from "@/lib/i18n";
import { getCameraConsent, setCameraConsent, type CameraConsent } from "@/lib/behavior";
import { IconPlay, IconStop } from "@/components/icons";

function SetupInner() {
  const router = useRouter();
  const params = useSearchParams();
  const questionId = params.get("q") || "";

  const [resume, setResume] = useState<Resume | null>(null);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [faces, setFaces] = useState<Face[]>([]);
  const [personas, setPersonas] = useState<PersonalityOption[]>([]);
  const [cfg, setCfg] = useState<InterviewConfig>({ voice_id: "aoede", face_id: "sophia", personality: "neutral", intensity: 3 });
  const [uploading, setUploading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startErr, setStartErr] = useState("");
  const [minutes, setMinutes] = useState(30); // interview length, user-chosen
  const fileRef = useRef<HTMLInputElement>(null);
  const pv = useRef<AvatarDrive>({ speaking: false, amplitude: 0, mood: "neutral" });
  const [previewing, setPreviewing] = useState(false);
  const { lang, languages } = useLang();
  const t = useT();
  const [interviewLang, setInterviewLang] = useState(lang); // defaults to app language, overridable per interview
  // Camera/behavioral-analysis consent (opt-in, default OFF). null = undecided.
  // Read AFTER mount (not a lazy initializer) so the server/first-paint render is
  // stable and the localStorage read can't cause a hydration mismatch.
  const [consent, setConsent] = useState<CameraConsent | null>(null);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setConsent(getCameraConsent()); }, []);
  const decideConsent = (v: CameraConsent) => { setCameraConsent(v); setConsent(v); };
  const previewReq = { voiceId: cfg.voice_id, faceId: cfg.face_id, personality: cfg.personality, intensity: cfg.intensity };
  const toggleVoice = () => {
    if (previewing) { stopPreview(pv); setPreviewing(false); return; }
    setPreviewing(true);
    void previewVoiceSample(previewReq, pv, () => setPreviewing(false));
  };

  useEffect(() => {
    (async () => {
      const u = await api.me();
      if (!u) { router.replace("/login"); return; }
      const [r, v, f, p, c] = await Promise.all([api.getResume(), api.listVoices(), api.listFaces(), api.listPersonalities(), api.getConfig()]);
      setResume(r); setVoices(v); setFaces(f); setPersonas(p); setCfg(c);
    })();
  }, [router]);

  // Stop any preview audio when leaving the page (navigating away mid-preview
  // otherwise leaves the interviewer's voice playing).
  useEffect(() => () => stopPreview(pv), []);

  // Warm the preview clip when the combo changes so playback is instant.
  useEffect(() => {
    if (!voices.length) return;
    const t = setTimeout(() => { void prefetchPreview(previewReq); }, 150);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg.voice_id, cfg.face_id, cfg.personality, cfg.intensity, voices.length]);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try { setResume(await api.uploadResume(file)); } finally { setUploading(false); }
  }

  async function save() { await api.saveConfig(cfg); }

  async function start() {
    setStarting(true); setStartErr("");
    try {
      // The interviewer speaks the language chosen for THIS interview (defaults to
      // the app language, but can be overridden above); carry it into the session
      // config (it rides the per-session JSON, read by the live relay).
      const withLang = { ...cfg, language: interviewLang };
      await api.saveConfig(cfg);
      const s = await api.createSession(questionId, withLang);
      router.push(`/interview?s=${s.id}&minutes=${minutes}`);
    } catch (e) {
      setStartErr(e instanceof Error ? e.message : "Could not start the interview.");
      setStarting(false);
    }
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <div className="flex items-center justify-between">
        <Button href="/dashboard" variant="ghost">← {t("Dashboard")}</Button>
        {questionId && <Badge tone="accent">{t("Question")}: {questionId}</Badge>}
      </div>
      <h1 className="mt-6 text-3xl font-bold">{t("Set up your interview")}</h1>
      <p className="mt-2 text-[var(--color-muted)]">{t("Upload your resume and shape your interviewer. You can change these anytime.")}</p>

      {/* Resume */}
      <Panel className="mt-8 p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{t("Resume")}</h2>
          {resume && <Button href="/resume-review" variant="ghost">{t("Review my resume →")}</Button>}
        </div>
        <div className="mt-4 flex items-center gap-4">
          <Button onClick={() => fileRef.current?.click()} disabled={uploading}>
            {uploading ? t("Uploading…") : resume ? t("Replace file") : t("Upload PDF / DOCX / .txt")}
          </Button>
          <input ref={fileRef} type="file" accept=".pdf,.docx,.txt,.md" hidden onChange={onFile} />
          <span className="text-sm text-[var(--color-muted)]">{resume ? resume.filename : t("No resume yet")}</span>
        </div>
        {resume?.parsed?.name && (
          <div className="mt-4 rounded-xl border border-[var(--color-line)] bg-[var(--color-panel-2)] p-4 text-sm">
            <div className="font-semibold">{resume.parsed.name} · <span className="text-[var(--color-muted)]">{resume.parsed.headline}</span></div>
            {(() => {
              const flat = (resume.parsed.skills as unknown[] | undefined ?? []).flatMap((s) => typeof s === "string" ? [s] : ((s as { items?: string[] }).items ?? []));
              return flat.length > 0 ? <div className="mt-2 flex flex-wrap gap-1.5">{flat.slice(0, 8).map((s) => (
                <span key={s} className="rounded-md bg-[var(--color-studio)] px-2 py-0.5 text-xs text-[var(--color-faint)]">{s}</span>
              ))}</div> : null;
            })()}
          </div>
        )}
      </Panel>

      {/* Interviewer */}
      <Panel className="mt-4 p-6">
        <h2 className="text-lg font-semibold">{t("Your interviewer")}</h2>
        {/* live preview of who's interviewing */}
        <div className="mt-4 flex items-center gap-4 rounded-xl border border-[var(--color-line)] bg-[var(--color-panel-2)] p-4">
          <div className="h-24 w-24 shrink-0 overflow-hidden rounded-xl bg-[var(--color-panel)]">
            <Avatar3D faceId={cfg.face_id} drive={pv} />
          </div>
          <div className="text-sm">
            <div className="font-semibold">{faces.find((f) => f.id === cfg.face_id)?.label ?? cfg.face_id}</div>
            <div className="text-[var(--color-muted)]">{t("Voice")}: {voices.find((v) => v.id === cfg.voice_id)?.label ?? cfg.voice_id} · {t(cfg.personality)}, {t("intensity")} {cfg.intensity}/5</div>
            <button onClick={() => toggleVoice()} className="mt-1 inline-flex items-center gap-1.5 rounded-md border border-[var(--color-line)] px-2 py-1 text-xs font-medium text-[var(--color-accent)] transition hover:bg-[var(--color-panel)]">
              {previewing ? <IconStop className="h-3.5 w-3.5" /> : <IconPlay className="h-3.5 w-3.5" />}
              {previewing ? t("Stop") : t("Hear this interviewer")}
            </button>
          </div>
        </div>
        <div className="mt-5 grid gap-6 md:grid-cols-2">
          <Field label={t("Voice")}>
            <div className="grid grid-cols-3 gap-2">
              {voices.map((v) => (
                <button key={v.id} onClick={() => { if (previewing) { stopPreview(pv); setPreviewing(false); } setCfg({ ...cfg, voice_id: v.id }); }}
                  className={`rounded-xl border px-3 py-2 text-sm transition ${cfg.voice_id === v.id ? "border-[var(--color-accent)] bg-[var(--color-panel-2)]" : "border-[var(--color-line)] hover:bg-[var(--color-panel-2)]"}`}>
                  {v.label}<span className="block text-xs text-[var(--color-faint)]">{t(v.gender)}</span>
                </button>
              ))}
            </div>
          </Field>
          <Field label={t("Face")}>
            <div className="grid grid-cols-4 gap-2">
              {faces.map((f) => (
                <button key={f.id} onClick={() => setCfg({ ...cfg, face_id: f.id })}
                  className={`flex flex-col items-center gap-1.5 rounded-xl border px-2 py-3 text-sm transition ${cfg.face_id === f.id ? "border-[var(--color-accent)] bg-[var(--color-panel-2)]" : "border-[var(--color-line)] hover:bg-[var(--color-panel-2)]"}`}>
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--color-accent)] text-sm font-bold text-[#0b0d12]">{f.label[0]}</span>
                  {f.label}
                </button>
              ))}
            </div>
          </Field>
        </div>

        <Field label={t("Temperament")}>
          <div className="grid gap-2 md:grid-cols-4">
            {personas.map((p) => (
              <button key={p.id} onClick={() => setCfg({ ...cfg, personality: p.id as Personality })}
                className={`rounded-xl border p-3 text-left transition ${cfg.personality === p.id ? "border-[var(--color-accent)] bg-[var(--color-panel-2)]" : "border-[var(--color-line)] hover:bg-[var(--color-panel-2)]"}`}>
                <div className="text-sm font-semibold">{t(p.label)}</div>
                <div className="mt-1 text-xs text-[var(--color-faint)]">{t(p.blurb)}</div>
              </button>
            ))}
          </div>
        </Field>

        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <Field label={`${t("Intensity")} — ${cfg.intensity}/5`}>
            <input type="range" min={1} max={5} value={cfg.intensity}
              onChange={(e) => setCfg({ ...cfg, intensity: Number(e.target.value) })}
              className="w-full accent-[var(--color-accent)]" />
          </Field>
          <Field label={`${t("Interview length")} — ${minutes} ${t("minutes")}`}>
            <input type="range" min={10} max={60} step={5} value={minutes}
              onChange={(e) => setMinutes(Number(e.target.value))}
              className="w-full accent-[var(--color-accent)]" aria-label="Interview length in minutes" />
          </Field>
          <Field label={t("Interview language")}>
            <select value={interviewLang} onChange={(e) => setInterviewLang(e.target.value)}
              aria-label="Interview language"
              className="w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-studio)] px-3 py-2.5 text-sm">
              {languages.map((l) => <option key={l.code} value={l.code}>{labelFor(l)}</option>)}
            </select>
            <p className="mt-1 text-xs text-[var(--color-faint)]">{t("The interviewer will speak and write in this language.")}</p>
          </Field>
        </div>
      </Panel>

      {/* Camera / behavioral analysis consent — opt-in, default OFF (HR-2) */}
      <Panel className="mt-4 p-6">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">{t("Camera analysis")}</h2>
          {consent === "granted" && <Badge tone="good">{t("On")}</Badge>}
          {consent === "denied" && <Badge tone="warn">{t("Off")}</Badge>}
          {consent === null && <Badge tone="warn">{t("Off — choose below")}</Badge>}
        </div>
        <p className="mt-2 text-sm text-[var(--color-muted)]">
          {t("Optionally, your webcam can be analyzed during the interview to give you feedback on how you came across. This is OFF unless you turn it on here.")}
        </p>
        <ul className="mt-3 space-y-1.5 text-sm text-[var(--color-muted)]">
          <li>• {t("What is analyzed: a face mesh for where you're facing (gaze), plus lighting, framing, and posture.")}</li>
          <li>• {t("How: computed in your browser, then raw samples (about one every 2 seconds) are sent to and stored on our server to generate your feedback.")}</li>
          <li>• {t("Where it goes & retention: stored with your interview to build your report, and retained about 30 days.")}</li>
          <li>• {t("These signals never affect your interview score, and you can run the interview WITHOUT camera analysis.")}</li>
        </ul>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button variant={consent === "granted" ? "primary" : "ghost"} onClick={() => decideConsent("granted")}>
            {t("Enable camera analysis")}
          </Button>
          <Button variant={consent === "denied" ? "primary" : "ghost"} onClick={() => decideConsent("denied")}>
            {t("Run without camera analysis")}
          </Button>
        </div>
      </Panel>

      <div className="mt-6 flex items-center justify-between">
        <Button variant="ghost" onClick={save}>{t("Save settings")}</Button>
        {questionId
          ? <Button onClick={start} disabled={starting} className="px-6">{starting ? t("Starting…") : t("Start interview →")}</Button>
          : <Button href="/dashboard">{t("Pick a question →")}</Button>}
      </div>
      {startErr && <p className="mt-3 text-right text-sm text-[var(--color-bad)]">{startErr}</p>}
    </main>
  );
}

export default function SetupPage() {
  return <Suspense fallback={<div className="p-10 text-[var(--color-muted)]">Loading…</div>}><SetupInner /></Suspense>;
}
