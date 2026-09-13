import type { MutableRefObject } from "react";
import type { AvatarDrive } from "@/components/studio/Avatar3D";
import type { PreviewReq } from "./features/profile";
import { api } from "./api";

// Preview the interviewer's voice+face. Prefers the ACTUAL Gemini voice (fetched
// as WAV from the backend, whose words + tone reflect the whole config), driving
// the avatar's lips from real audio amplitude. Falls back to the browser's
// speech synthesis only if the real voice is unavailable (offline / no key).
//
// INSTANT PLAYBACK: the WAV for a combo is fetched once and memoised as an
// in-flight promise. Call prefetchPreview(req) the moment the user changes the
// voice/face/personality/intensity, and by the time they hit "Hear" the clip is
// already in hand — no spinner. Repeat plays are served straight from the cache.
let ampRaf: number | undefined;
let ampInterval: number | undefined;
let audioCtx: AudioContext | undefined;
let current: HTMLAudioElement | undefined;
let currentUrl: string | undefined;                 // object URL to revoke on stop/end
let currentSrc: MediaElementAudioSourceNode | undefined;
let currentAnalyser: AnalyserNode | undefined;
let onEndCb: (() => void) | undefined;

// Combo -> in-flight/settled blob fetch. A promise (not a blob) so concurrent
// callers for the same combo share one request and a prefetch is awaited, not
// duplicated. Backed by a PERSISTENT IndexedDB store so a given interviewer
// preview is fetched from the server at most once per browser, ever — reloads
// and later visits replay it instantly with no network call.
const blobCache = new Map<string, Promise<Blob | null>>();
const keyOf = (r: PreviewReq) => `${r.voiceId}|${r.faceId}|${r.personality}|${r.intensity}`;

// ---- IndexedDB blob store (best-effort; degrades to memory-only) ----
const IDB_NAME = "mi_media", IDB_STORE = "voice_previews";
let idbPromise: Promise<IDBDatabase | null> | undefined;
function idb(): Promise<IDBDatabase | null> {
  if (idbPromise) return idbPromise;
  idbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(IDB_STORE)) req.result.createObjectStore(IDB_STORE); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
  return idbPromise;
}
async function idbGet(key: string): Promise<Blob | null> {
  const db = await idb(); if (!db) return null;
  return new Promise((resolve) => {
    try {
      const r = db.transaction(IDB_STORE, "readonly").objectStore(IDB_STORE).get(key);
      r.onsuccess = () => resolve(r.result instanceof Blob ? r.result : null);
      r.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}
async function idbPut(key: string, blob: Blob): Promise<void> {
  const db = await idb(); if (!db) return;
  try { db.transaction(IDB_STORE, "readwrite").objectStore(IDB_STORE).put(blob, key); } catch { /* ignore */ }
}

function clearAmp() {
  if (ampRaf !== undefined) { cancelAnimationFrame(ampRaf); ampRaf = undefined; }
  if (ampInterval !== undefined) { clearInterval(ampInterval); ampInterval = undefined; }
}

// prefetchPreview warms the cache for a combo without playing anything. Safe to
// call on every selection change — it dedups by combo and checks the persistent
// store before ever hitting the network.
export function prefetchPreview(req: PreviewReq): Promise<Blob | null> {
  const key = keyOf(req);
  let p = blobCache.get(key);
  if (!p) {
    p = (async () => {
      const cached = await idbGet(key);
      if (cached) return cached;
      const fresh = await api.voicePreview(req).catch(() => null);
      if (fresh) void idbPut(key, fresh); // persist for future sessions
      return fresh;
    })();
    blobCache.set(key, p);
    // Drop a failed fetch so a later attempt can retry (transient offline, etc.).
    void p.then((b) => { if (!b) blobCache.delete(key); });
  }
  return p;
}

export async function previewVoiceSample(req: PreviewReq, drive: MutableRefObject<AvatarDrive>, onEnd?: () => void) {
  stopPreview(drive);
  onEndCb = onEnd;
  const blob = await prefetchPreview(req); // resolves instantly if already warmed
  // A newer stop may have run while awaiting; only proceed if we're still wanted.
  if (onEndCb !== onEnd) return;
  if (blob) { playReal(blob, drive); return; }
  fallbackTTS(req, drive); // browser-TTS fallback (offline / mock)
}

export function stopPreview(drive: MutableRefObject<AvatarDrive>) {
  clearAmp();
  if (current) { current.pause(); current = undefined; }
  // Release audio-graph nodes and the object URL — pause() never fires onended,
  // so without this each stopped/switched preview leaks a node + a blob URL.
  currentSrc?.disconnect(); currentSrc = undefined;
  currentAnalyser?.disconnect(); currentAnalyser = undefined;
  if (currentUrl) { URL.revokeObjectURL(currentUrl); currentUrl = undefined; }
  if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
  drive.current.speaking = false; drive.current.amplitude = 0; drive.current.level = 0;
  const cb = onEndCb; onEndCb = undefined; cb?.();
}

// Play the real Gemini WAV through an analyser and drive lips from its RMS.
function playReal(blob: Blob, drive: MutableRefObject<AvatarDrive>) {
  const url = URL.createObjectURL(blob);
  currentUrl = url;
  const audio = new Audio(url);
  current = audio;
  audioCtx = audioCtx ?? new AudioContext();
  const ctx = audioCtx;
  const src = ctx.createMediaElementSource(audio);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 256;
  src.connect(analyser); analyser.connect(ctx.destination);
  currentSrc = src; currentAnalyser = analyser;
  const data = new Uint8Array(analyser.frequencyBinCount);
  const tick = () => {
    analyser.getByteTimeDomainData(data);
    let sum = 0, zc = 0, prev = 0;
    for (let i = 0; i < data.length; i++) { const v = (data[i] - 128) / 128; sum += v * v; if ((v >= 0) !== (prev >= 0)) zc++; prev = v; }
    const amp = Math.min(1, Math.sqrt(sum / data.length) * 3);
    drive.current.amplitude = amp;
    drive.current.level = amp;                                  // glTF viseme openness
    drive.current.bright = Math.min(1, (zc / data.length) * 10); // vowel color
    ampRaf = requestAnimationFrame(tick);
  };
  audio.onplay = () => { drive.current.speaking = true; void ctx.resume(); tick(); };
  audio.onended = () => {
    drive.current.speaking = false; drive.current.amplitude = 0; drive.current.level = 0; clearAmp();
    src.disconnect(); analyser.disconnect(); currentSrc = undefined; currentAnalyser = undefined;
    if (currentUrl === url) { URL.revokeObjectURL(url); currentUrl = undefined; }
    const cb = onEndCb; onEndCb = undefined; cb?.();
  };
  void audio.play().catch(() => { /* autoplay blocked; ignore */ });
}

// Fallback: browser TTS with a gender-matched voice (robotic but always works).
// The spoken line mirrors the server's delivery so mock/offline still varies by
// personality + intensity.
function fallbackTTS(req: PreviewReq, drive: MutableRefObject<AvatarDrive>) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  const u = new SpeechSynthesisUtterance(fallbackLine(req));
  const female = ["aoede", "kore", "leda"].includes(req.voiceId);
  const fem = /(female|woman|samantha|victoria|karen|moira|tessa|fiona|serena|zira|susan|allison|ava|jenny|aria)/i;
  const male = /(male|\bman\b|daniel|alex|fred|thomas|oliver|arthur|george|david|mark|guy|ryan)/i;
  const all = window.speechSynthesis.getVoices();
  const en = all.filter((v) => /^en/i.test(v.lang));
  const pool = en.length ? en : all;
  const v = pool.find((x) => (female ? fem : male).test(x.name)) ?? pool[0];
  if (v) u.voice = v;
  u.rate = 0.9 + (req.intensity - 3) * 0.09; // intensity nudges pace, like the real path
  u.onstart = () => { drive.current.speaking = true; ampInterval = window.setInterval(() => { const level = 0.25 + Math.abs(Math.sin(Date.now() / 90)) * 0.6; drive.current.amplitude = level; drive.current.level = level; }, 60); };
  u.onend = () => { drive.current.speaking = false; drive.current.amplitude = 0; drive.current.level = 0; clearAmp(); const cb = onEndCb; onEndCb = undefined; cb?.(); };
  window.speechSynthesis.speak(u);
}

// fallbackLine is a compact client mirror of persona.PreviewDelivery, used only
// for the browser-TTS fallback (the real path speaks the server-composed line).
// TODO(ARCH-11): derive these names from the fetched face catalog (api.listFaces)
// instead of duplicating the ids here. Left static for now because this runs in a
// synchronous, non-React fallback path where an async catalog fetch isn't wired;
// an unknown id already degrades to "your interviewer", so the duplication is
// cosmetic-only (offline TTS greeting) and low-risk.
const FACE_NAMES: Record<string, string> = { sophia: "Sophia", marcus: "Marcus", richard: "Richard" };
function fallbackLine(r: PreviewReq): string {
  const name = FACE_NAMES[r.faceId] ?? "your interviewer";
  const hi = r.intensity >= 4;
  switch (r.personality) {
    case "supportive":
      return `Hi there — I'm ${name}. I'm really glad you're here${hi ? ", and we've got a fair bit to cover, so let's dive in." : ". There's no rush at all; let's just have a good conversation."}`;
    case "interruptive":
      return `I'm ${name}. Heads-up: I run a tight interview and I'll jump in the moment something's worth digging into.${hi ? " Keep it sharp — ready?" : " Let's get started."}`;
    case "annoying":
      return `${name} here. Let's be efficient — I've little patience for hand-waving.${hi ? " No fluff; show me you know your stuff." : " Give me specifics and we'll get along fine."}`;
    default:
      return `Hello, I'm ${name}. I'll be running your interview today.${hi ? " Let's get straight into it." : " I'll let your answers speak for themselves."}`;
  }
}
