"use client";

// The interviewer's face. A canvas-rendered, expressive head that lip-syncs to
// the live audio amplitude, blinks, and shifts expression with the interview
// mood. Kept behind a simple prop API so a glTF/Ready-Player-Me 3D driver can
// replace it without touching the studio.
import { useEffect, useRef } from "react";

export type Mood = "neutral" | "listening" | "curious" | "stern";

const FACE_STYLES: Record<string, { skin: string; skin2: string; hair: string; label: string }> = {
  ava:  { skin: "#f1c9a5", skin2: "#e0a97e", hair: "#3a2a22", label: "Ava" },
  maya: { skin: "#c98c63", skin2: "#a86f4a", hair: "#1c1512", label: "Maya" },
  leo:  { skin: "#e8b48c", skin2: "#cf9366", hair: "#22262e", label: "Leo" },
  noah: { skin: "#a26d45", skin2: "#835636", hair: "#0f0c0a", label: "Noah" },
};

export function Avatar({ faceId, speaking, amplitude, mood = "neutral" }: {
  faceId: string; speaking: boolean; amplitude: number; mood?: Mood;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const state = useRef({ amp: 0, blink: 0, nextBlink: 0, t: 0, speaking: false, mood });

  useEffect(() => { state.current.speaking = speaking; }, [speaking]);
  useEffect(() => { state.current.amp = amplitude; }, [amplitude]);
  useEffect(() => { state.current.mood = mood; }, [mood]);

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext("2d")!;
    const style = FACE_STYLES[faceId] ?? FACE_STYLES.ava;
    let raf = 0;
    const dpr = Math.min(2, typeof window !== "undefined" ? window.devicePixelRatio : 1);

    const resize = () => {
      const w = canvas.clientWidth, h = canvas.clientHeight;
      canvas.width = w * dpr; canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize); ro.observe(canvas);

    const draw = () => {
      const s = state.current; s.t += 1;
      const w = canvas.clientWidth, h = canvas.clientHeight;
      const cx = w / 2, cy = h / 2;
      // Blink scheduling.
      if (s.t > s.nextBlink) { s.blink = 1; s.nextBlink = s.t + 120 + Math.floor(Math.random() * 180); }
      if (s.blink > 0) s.blink = Math.max(0, s.blink - 0.15);
      const eyeOpen = 1 - (s.blink > 0.5 ? (s.blink - 0.5) * 2 : 0);
      // Mouth open from amplitude (smoothed).
      const target = s.speaking ? 0.2 + s.amp * 0.8 : 0.04;
      s.amp = s.amp + (target - s.amp) * 0.4;
      const mouthOpen = s.speaking ? target : 0.05;
      const bob = Math.sin(s.t / 40) * 2 + (s.speaking ? Math.sin(s.t / 6) * 1.2 : 0);

      ctx.clearRect(0, 0, w, h);
      // Backdrop.
      const bg = ctx.createRadialGradient(cx, cy * 0.7, 20, cx, cy, w * 0.7);
      bg.addColorStop(0, "#1b2130"); bg.addColorStop(1, "#0b0d12");
      ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);

      const headW = w * 0.42, headH = h * 0.5;
      const hy = cy + bob;

      // Neck + shoulders.
      ctx.fillStyle = style.skin2;
      ctx.fillRect(cx - headW * 0.22, hy + headH * 0.5, headW * 0.44, headH * 0.5);
      ctx.fillStyle = "#2a3242";
      ctx.beginPath(); ctx.ellipse(cx, hy + headH * 1.05, headW * 1.1, headH * 0.6, 0, 0, Math.PI * 2); ctx.fill();

      // Head.
      const skin = ctx.createLinearGradient(cx - headW, hy - headH, cx + headW, hy + headH);
      skin.addColorStop(0, style.skin); skin.addColorStop(1, style.skin2);
      ctx.fillStyle = skin;
      ctx.beginPath(); ctx.ellipse(cx, hy, headW * 0.62, headH * 0.72, 0, 0, Math.PI * 2); ctx.fill();
      // Hair.
      ctx.fillStyle = style.hair;
      ctx.beginPath(); ctx.ellipse(cx, hy - headH * 0.42, headW * 0.66, headH * 0.42, 0, Math.PI, 0); ctx.fill();
      ctx.beginPath(); ctx.ellipse(cx, hy - headH * 0.2, headW * 0.64, headH * 0.5, 0, Math.PI * 1.05, Math.PI * 1.95); ctx.fill();

      // Eyes.
      const eyeY = hy - headH * 0.06;
      const eyeDX = headW * 0.26;
      const browRaise = s.mood === "curious" ? -4 : s.mood === "stern" ? 3 : 0;
      for (const dx of [-eyeDX, eyeDX]) {
        // socket
        ctx.fillStyle = "#fff";
        ctx.beginPath(); ctx.ellipse(cx + dx, eyeY, headW * 0.12, headH * 0.09 * eyeOpen + 0.5, 0, 0, Math.PI * 2); ctx.fill();
        // iris
        ctx.fillStyle = "#4a3b2f";
        ctx.beginPath(); ctx.arc(cx + dx, eyeY, headW * 0.055 * (0.4 + eyeOpen * 0.6), 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#111";
        ctx.beginPath(); ctx.arc(cx + dx, eyeY, headW * 0.026, 0, Math.PI * 2); ctx.fill();
        // brow
        ctx.strokeStyle = style.hair; ctx.lineWidth = 4; ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(cx + dx - headW * 0.13, eyeY - headH * 0.16 + browRaise);
        ctx.lineTo(cx + dx + headW * 0.13, eyeY - headH * 0.17 + browRaise * 0.6);
        ctx.stroke();
      }

      // Nose.
      ctx.strokeStyle = style.skin2; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(cx, eyeY + headH * 0.04); ctx.lineTo(cx - headW * 0.05, eyeY + headH * 0.2); ctx.lineTo(cx + headW * 0.03, eyeY + headH * 0.22); ctx.stroke();

      // Mouth.
      const my = hy + headH * 0.34;
      const mw = headW * 0.3;
      const mh = headH * 0.16 * mouthOpen;
      ctx.fillStyle = "#7c2b28";
      ctx.beginPath(); ctx.ellipse(cx, my, mw, Math.max(2, mh), 0, 0, Math.PI * 2); ctx.fill();
      if (mh > 6) { ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.ellipse(cx, my - mh * 0.5, mw * 0.8, mh * 0.25, 0, 0, Math.PI * 2); ctx.fill(); }
      // Smile curve when not talking much.
      if (mouthOpen < 0.12 && s.mood !== "stern") {
        ctx.strokeStyle = "#7c2b28"; ctx.lineWidth = 4; ctx.lineCap = "round";
        ctx.beginPath(); ctx.arc(cx, my - headH * 0.02, mw, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [faceId]);

  return <canvas ref={ref} className="h-full w-full" style={{ display: "block", borderRadius: 12 }} />;
}
