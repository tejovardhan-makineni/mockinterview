"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import type { Face, InterviewConfig, Personality, Profile, Voice } from "@/lib/types";
import { Badge, Button, Field, Input, Panel } from "@/components/ui";
import { AppShell } from "@/components/AppShell";
import { Avatar3D, type AvatarDrive } from "@/components/studio/Avatar3D";
import { previewVoiceSample, stopPreview, prefetchPreview } from "@/lib/voicePreview";
import { IconPlay, IconStop } from "@/components/icons";

const DOMAINS = [
  "system_design", "ml_system_design", "coding", "behavioral", "medicine", "medical_residency",
  "nursing", "law", "consulting_case", "product_management", "finance", "data_science",
  "ux_design", "sales", "marketing", "human_resources", "education", "mba_admissions",
];
const PERSONAS: Personality[] = ["supportive", "neutral", "interruptive", "annoying"];
const pretty = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export default function SettingsPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile>({});
  const [cfg, setCfg] = useState<InterviewConfig>({ voice_id: "aoede", face_id: "sophia", personality: "neutral", intensity: 3 });
  const [voices, setVoices] = useState<Voice[]>([]);
  const [faces, setFaces] = useState<Face[]>([]);
  const [saved, setSaved] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const pv = useRef<AvatarDrive>({ speaking: false, amplitude: 0, mood: "neutral" });
  const [previewing, setPreviewing] = useState(false);
  const previewReq = { voiceId: cfg.voice_id, faceId: cfg.face_id, personality: cfg.personality, intensity: cfg.intensity };
  const previewVoice = () => {
    if (previewing) { stopPreview(pv); setPreviewing(false); return; }
    setPreviewing(true);
    void previewVoiceSample(previewReq, pv, () => setPreviewing(false));
  };

  useEffect(() => {
    (async () => {
      const u = await api.me();
      if (!u) { router.replace("/login"); return; }
      const [p, c, v, f] = await Promise.all([api.getProfile(), api.getConfig(), api.listVoices(), api.listFaces()]);
      setProfile(p || {}); setCfg(c); setVoices(v); setFaces(f);
    })();
  }, [router]);

  // Warm the preview clip whenever the combo changes so "Hear this voice & face"
  // plays instantly. Debounced so dragging the intensity slider fires one fetch.
  useEffect(() => {
    if (!voices.length) return; // wait until config is loaded
    const t = setTimeout(() => { void prefetchPreview(previewReq); }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg.voice_id, cfg.face_id, cfg.personality, cfg.intensity, voices.length]);

  async function saveProfile() { await api.saveProfile(profile); flash("Profile saved"); }
  async function saveCfg() { await api.saveConfig(cfg); flash("Interviewer saved"); }
  function flash(m: string) { setSaved(m); setTimeout(() => setSaved(""), 1800); }

  async function del() {
    await api.deleteAccount();
    router.replace("/");
  }

  return (
    <AppShell active="settings">
      {saved && <div className="mb-3"><Badge tone="good">{saved}</Badge></div>}
      <h1 className="text-3xl font-extrabold tracking-tight">Settings</h1>

      {/* Profile */}
      <Panel className="mt-6 p-6">
        <h2 className="text-lg font-semibold">Your profile</h2>
        <p className="mt-1 text-sm text-[var(--color-muted)]">We use this to suggest relevant interviews.</p>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <Field label="Name"><Input value={profile.name ?? ""} onChange={(e) => setProfile({ ...profile, name: e.target.value })} placeholder="Your name" /></Field>
          <Field label="Date of birth"><Input type="date" value={profile.dob ?? ""} onChange={(e) => setProfile({ ...profile, dob: e.target.value })} /></Field>
          <Field label="Gender">
            <select value={profile.gender ?? ""} onChange={(e) => setProfile({ ...profile, gender: e.target.value })} className="w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-studio)] px-3 py-2.5 text-sm">
              <option value="">Prefer not to say</option><option value="female">Female</option><option value="male">Male</option><option value="nonbinary">Non-binary</option>
            </select>
          </Field>
          <Field label="I am a…">
            <select value={profile.status ?? ""} onChange={(e) => setProfile({ ...profile, status: e.target.value as Profile["status"] })} className="w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-studio)] px-3 py-2.5 text-sm">
              <option value="">—</option><option value="student">Student</option><option value="working">Working professional</option><option value="other">Other</option>
            </select>
          </Field>
          <Field label="Occupation"><Input value={profile.occupation ?? ""} onChange={(e) => setProfile({ ...profile, occupation: e.target.value })} placeholder="e.g. Software Engineer, Medical Resident" /></Field>
          <Field label="Target role"><Input value={profile.target_role ?? ""} onChange={(e) => setProfile({ ...profile, target_role: e.target.value })} placeholder="e.g. Senior SWE at a FAANG" /></Field>
          <Field label="Preferred interview domain">
            <select value={profile.domain ?? ""} onChange={(e) => setProfile({ ...profile, domain: e.target.value })} className="w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-studio)] px-3 py-2.5 text-sm">
              <option value="">Any</option>{DOMAINS.map((d) => <option key={d} value={d}>{pretty(d)}</option>)}
            </select>
          </Field>
          <Field label="Years of experience"><Input type="number" min={0} value={profile.years_experience ?? ""} onChange={(e) => setProfile({ ...profile, years_experience: Number(e.target.value) })} /></Field>
        </div>
        <Button className="mt-5" onClick={saveProfile}>Save profile</Button>
      </Panel>

      {/* Interviewer */}
      <Panel className="mt-4 p-6">
        <h2 className="text-lg font-semibold">Your interviewer</h2>
        <div className="mt-5 grid gap-6 md:grid-cols-[220px_1fr]">
          <div>
            <div className="aspect-square w-full overflow-hidden rounded-xl bg-[var(--color-panel-2)]">
              <Avatar3D faceId={cfg.face_id} drive={pv} />
            </div>
            <button onClick={() => previewVoice()} className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-[var(--color-line)] px-2 py-1.5 text-xs font-medium text-[var(--color-accent)] transition hover:bg-[var(--color-panel-2)]">
              {previewing ? <IconStop className="h-3.5 w-3.5" /> : <IconPlay className="h-3.5 w-3.5" />}
              {previewing ? "Stop" : "Hear this voice & face"}
            </button>
          </div>
          <div className="space-y-4">
            <Field label="Interviewer face">
              <div className="grid grid-cols-4 gap-2">
                {faces.map((f) => (
                  <button key={f.id} onClick={() => setCfg({ ...cfg, face_id: f.id })}
                    className={`rounded-xl border px-2 py-2 text-xs transition ${cfg.face_id === f.id ? "border-[var(--color-accent)] bg-[var(--color-panel-2)]" : "border-[var(--color-line)] hover:bg-[var(--color-panel-2)]"}`}>
                    {f.label}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Voice">
              <div className="grid grid-cols-3 gap-2">
                {voices.map((v) => (
                  <button key={v.id} onClick={() => { if (previewing) { stopPreview(pv); setPreviewing(false); } setCfg({ ...cfg, voice_id: v.id }); }}
                    className={`rounded-xl border px-3 py-2 text-sm transition ${cfg.voice_id === v.id ? "border-[var(--color-accent)] bg-[var(--color-panel-2)]" : "border-[var(--color-line)] hover:bg-[var(--color-panel-2)]"}`}>{v.label}</button>
                ))}
              </div>
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Temperament">
                <select value={cfg.personality} onChange={(e) => setCfg({ ...cfg, personality: e.target.value as Personality })} className="w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-studio)] px-3 py-2.5 text-sm">
                  {PERSONAS.map((p) => <option key={p} value={p}>{pretty(p)}</option>)}
                </select>
              </Field>
              <Field label={`Intensity — ${cfg.intensity}/5`}>
                <input type="range" min={1} max={5} value={cfg.intensity} onChange={(e) => setCfg({ ...cfg, intensity: Number(e.target.value) })} className="mt-3 w-full accent-[var(--color-accent)]" />
              </Field>
            </div>
            <Button onClick={saveCfg}>Save interviewer</Button>
          </div>
        </div>
      </Panel>

      {/* Danger zone */}
      <Panel className="mt-4 border-[var(--color-bad)] p-6" >
        <h2 className="text-lg font-semibold text-[var(--color-bad)]">Delete account</h2>
        <p className="mt-1 text-sm text-[var(--color-muted)]">Permanently deletes your account and all data — resumes, interviews, transcripts, and reports. This cannot be undone.</p>
        {!confirmDelete
          ? <Button variant="danger" className="mt-4" onClick={() => setConfirmDelete(true)}>Delete my account</Button>
          : <div className="mt-4 flex items-center gap-3">
              <span className="text-sm text-[var(--color-bad)]">Are you sure? This erases everything.</span>
              <Button variant="danger" onClick={del}>Yes, delete everything</Button>
              <Button variant="ghost" onClick={() => setConfirmDelete(false)}>Cancel</Button>
            </div>}
      </Panel>
    </AppShell>
  );
}
