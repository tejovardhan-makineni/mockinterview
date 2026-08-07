import type { MutableRefObject } from "react";
import type { AvatarDrive } from "@/components/studio/Avatar3D";
import { api } from "./api";

// Preview the interviewer's voice+face. Prefers the ACTUAL Gemini voice (fetched
// as WAV from the backend), driving the avatar's lips from real audio amplitude.
// Falls back to the browser's speech synthesis only if the real voice is
// unavailable (offline / no key).
// Two lip-sync animation drivers are used depending on the path: a
// requestAnimationFrame loop for the real-audio analyser, and a setInterval for
// the browser-TTS fallback. Track them separately so stopPreview can clear
// whichever is active (a rAF id and an interval id must not be cross-cancelled).
let ampRaf: number | undefined;
let ampInterval: number | undefined;
let audioCtx: AudioContext | undefined;
let current: HTMLAudioElement | undefined;

let onEndCb: (() => void) | undefined;

function clearAmp() {
  if (ampRaf !== undefined) { cancelAnimationFrame(ampRaf); ampRaf = undefined; }
  if (ampInterval !== undefined) { clearInterval(ampInterval); ampInterval = undefined; }
}

export async function previewVoiceSample(voiceId: string, drive: MutableRefObject<AvatarDrive>, onEnd?: () => void, line?: string) {
  stopPreview(drive);
  onEndCb = onEnd;
  const blob = await api.voicePreview(voiceId);
  if (blob) { playReal(blob, drive); return; } // real Gemini WAV already speaks the per-voice line
  fallbackTTS(voiceId, drive, line);            // browser-TTS fallback uses the same line
}

export function stopPreview(drive: MutableRefObject<AvatarDrive>) {
  clearAmp();
  if (current) { current.pause(); current = undefined; }
  if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
  drive.current.speaking = false; drive.current.amplitude = 0;
  const cb = onEndCb; onEndCb = undefined; cb?.();
}

// Play the real Gemini WAV through an analyser and drive lips from its RMS.
function playReal(blob: Blob, drive: MutableRefObject<AvatarDrive>) {
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  current = audio;
  audioCtx = audioCtx ?? new AudioContext();
  const ctx = audioCtx;
  const src = ctx.createMediaElementSource(audio);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 256;
  src.connect(analyser); analyser.connect(ctx.destination);
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
  audio.onended = () => { drive.current.speaking = false; drive.current.amplitude = 0; drive.current.level = 0; clearAmp(); URL.revokeObjectURL(url); const cb = onEndCb; onEndCb = undefined; cb?.(); };
  void audio.play().catch(() => { /* autoplay blocked; ignore */ });
}

// Fallback: browser TTS with a gender-matched voice (robotic but always works).
function fallbackTTS(voiceId: string, drive: MutableRefObject<AvatarDrive>, line?: string) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  const u = new SpeechSynthesisUtterance(line || "Hi, I'm your interviewer. Let's start — tell me a bit about yourself and a project you're proud of.");
  const female = ["aoede", "kore", "leda"].includes(voiceId);
  const fem = /(female|woman|samantha|victoria|karen|moira|tessa|fiona|serena|zira|susan|allison|ava|jenny|aria)/i;
  const male = /(male|\bman\b|daniel|alex|fred|thomas|oliver|arthur|george|david|mark|guy|ryan)/i;
  const all = window.speechSynthesis.getVoices();
  const en = all.filter((v) => /^en/i.test(v.lang));
  const pool = en.length ? en : all;
  const v = pool.find((x) => (female ? fem : male).test(x.name)) ?? pool[0];
  if (v) u.voice = v;
  u.onstart = () => { drive.current.speaking = true; ampInterval = window.setInterval(() => { drive.current.amplitude = 0.25 + Math.abs(Math.sin(Date.now() / 90)) * 0.6; }, 60); };
  u.onend = () => { drive.current.speaking = false; drive.current.amplitude = 0; clearAmp(); const cb = onEndCb; onEndCb = undefined; cb?.(); };
  window.speechSynthesis.speak(u);
}
