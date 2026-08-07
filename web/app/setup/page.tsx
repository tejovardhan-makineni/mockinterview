"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import type { Face, InterviewConfig, Personality, Resume, Voice } from "@/lib/types";
import { Badge, Button, Field, Panel } from "@/components/ui";
import { Avatar3D, type AvatarDrive } from "@/components/studio/Avatar3D";
import { previewVoiceSample, stopPreview } from "@/lib/voicePreview";
import { IconPlay, IconStop } from "@/components/icons";

const PERSONAS: { id: Personality; label: string; desc: string }[] = [
  { id: "supportive", label: "Supportive", desc: "Warm, encouraging, gives hints." },
  { id: "neutral", label: "Neutral", desc: "Balanced, professional." },
  { id: "interruptive", label: "Interruptive", desc: "Cuts in with probing follow-ups." },
  { id: "annoying", label: "Annoying", desc: "Impatient, skeptical, high pressure." },
];

function SetupInner() {
  const router = useRouter();
  const params = useSearchParams();
  const questionId = params.get("q") || "";

  const [resume, setResume] = useState<Resume | null>(null);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [faces, setFaces] = useState<Face[]>([]);
  const [cfg, setCfg] = useState<InterviewConfig>({ voice_id: "aoede", face_id: "ava", personality: "neutral", intensity: 3 });
  const [uploading, setUploading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startErr, setStartErr] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const pv = useRef<AvatarDrive>({ speaking: false, amplitude: 0, mood: "neutral" });
  const [previewing, setPreviewing] = useState(false);
  const toggleVoice = (voiceId: string) => {
    if (previewing) { stopPreview(pv); setPreviewing(false); return; }
    setPreviewing(true);
    void previewVoiceSample(voiceId, pv, () => setPreviewing(false), voices.find((v) => v.id === voiceId)?.sample);
  };

  useEffect(() => {
    (async () => {
      const u = await api.me();
      if (!u) { router.replace("/login"); return; }
      const [r, v, f, c] = await Promise.all([api.getResume(), api.listVoices(), api.listFaces(), api.getConfig()]);
      setResume(r); setVoices(v); setFaces(f); setCfg(c);
    })();
  }, [router]);

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
      await api.saveConfig(cfg);
      const s = await api.createSession(questionId, cfg);
      router.push(`/interview?s=${s.id}`);
    } catch (e) {
      setStartErr(e instanceof Error ? e.message : "Could not start the interview.");
      setStarting(false);
    }
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <div className="flex items-center justify-between">
        <Button href="/dashboard" variant="ghost">← Dashboard</Button>
        {questionId && <Badge tone="accent">Question: {questionId}</Badge>}
      </div>
      <h1 className="mt-6 text-3xl font-bold">Set up your interview</h1>
      <p className="mt-2 text-[var(--color-muted)]">Upload your resume and shape your interviewer. You can change these anytime.</p>

      {/* Resume */}
      <Panel className="mt-8 p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Resume</h2>
          {resume && <Button href="/resume-review" variant="ghost">Review my resume →</Button>}
        </div>
        <div className="mt-4 flex items-center gap-4">
          <Button onClick={() => fileRef.current?.click()} disabled={uploading}>
            {uploading ? "Uploading…" : resume ? "Replace file" : "Upload PDF / DOCX / .txt"}
          </Button>
          <input ref={fileRef} type="file" accept=".pdf,.docx,.txt,.md" hidden onChange={onFile} />
          <span className="text-sm text-[var(--color-muted)]">{resume ? resume.filename : "No resume yet"}</span>
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
        <h2 className="text-lg font-semibold">Your interviewer</h2>
        {/* live preview of who's interviewing */}
        <div className="mt-4 flex items-center gap-4 rounded-xl border border-[var(--color-line)] bg-[var(--color-panel-2)] p-4">
          <div className="h-24 w-24 shrink-0 overflow-hidden rounded-xl bg-[var(--color-panel)]">
            <Avatar3D faceId={cfg.face_id} drive={pv} />
          </div>
          <div className="text-sm">
            <div className="font-semibold">{faces.find((f) => f.id === cfg.face_id)?.label ?? cfg.face_id}</div>
            <div className="text-[var(--color-muted)]">Voice: {voices.find((v) => v.id === cfg.voice_id)?.label ?? cfg.voice_id} · {cfg.personality}, intensity {cfg.intensity}/5</div>
            <button onClick={() => toggleVoice(cfg.voice_id)} className="mt-1 inline-flex items-center gap-1.5 rounded-md border border-[var(--color-line)] px-2 py-1 text-xs font-medium text-[var(--color-accent)] transition hover:bg-[var(--color-panel)]">
              {previewing ? <IconStop className="h-3.5 w-3.5" /> : <IconPlay className="h-3.5 w-3.5" />}
              {previewing ? "Stop" : "Hear this interviewer"}
            </button>
          </div>
        </div>
        <div className="mt-5 grid gap-6 md:grid-cols-2">
          <Field label="Voice">
            <div className="grid grid-cols-3 gap-2">
              {voices.map((v) => (
                <button key={v.id} onClick={() => { if (previewing) { stopPreview(pv); setPreviewing(false); } setCfg({ ...cfg, voice_id: v.id }); }}
                  className={`rounded-xl border px-3 py-2 text-sm transition ${cfg.voice_id === v.id ? "border-[var(--color-accent)] bg-[var(--color-panel-2)]" : "border-[var(--color-line)] hover:bg-[var(--color-panel-2)]"}`}>
                  {v.label}<span className="block text-xs text-[var(--color-faint)]">{v.gender}</span>
                </button>
              ))}
            </div>
          </Field>
          <Field label="Face">
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

        <Field label="Temperament">
          <div className="grid gap-2 md:grid-cols-4">
            {PERSONAS.map((p) => (
              <button key={p.id} onClick={() => setCfg({ ...cfg, personality: p.id })}
                className={`rounded-xl border p-3 text-left transition ${cfg.personality === p.id ? "border-[var(--color-accent)] bg-[var(--color-panel-2)]" : "border-[var(--color-line)] hover:bg-[var(--color-panel-2)]"}`}>
                <div className="text-sm font-semibold">{p.label}</div>
                <div className="mt-1 text-xs text-[var(--color-faint)]">{p.desc}</div>
              </button>
            ))}
          </div>
        </Field>

        <div className="mt-5">
          <Field label={`Intensity — ${cfg.intensity}/5`}>
            <input type="range" min={1} max={5} value={cfg.intensity}
              onChange={(e) => setCfg({ ...cfg, intensity: Number(e.target.value) })}
              className="w-full accent-[var(--color-accent)]" />
          </Field>
        </div>
      </Panel>

      <div className="mt-6 flex items-center justify-between">
        <Button variant="ghost" onClick={save}>Save settings</Button>
        {questionId
          ? <Button onClick={start} disabled={starting} className="px-6">{starting ? "Starting…" : "Start interview →"}</Button>
          : <Button href="/dashboard">Pick a question →</Button>}
      </div>
      {startErr && <p className="mt-3 text-right text-sm text-[var(--color-bad)]">{startErr}</p>}
    </main>
  );
}

export default function SetupPage() {
  return <Suspense fallback={<div className="p-10 text-[var(--color-muted)]">Loading…</div>}><SetupInner /></Suspense>;
}
