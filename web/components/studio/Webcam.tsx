"use client";

// The candidate's self-view: a draggable picture-in-picture webcam tile that can
// be moved anywhere within the tab. Exposes the underlying <video> element (once
// the stream is live) so the behavioral tracker can sample it.
import { useEffect, useRef, useState } from "react";

export function Webcam({ onReady }: { onReady: (v: HTMLVideoElement) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [pos, setPos] = useState({ x: 24, y: 24 });
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    // cancelled guards the late resolve: if we unmount during getUserMedia, stop
    // the stream the moment it arrives (otherwise the camera light stays on).
    let cancelled = false;
    let stream: MediaStream | null = null;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { width: 480, height: 360 }, audio: false });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        const v = videoRef.current!;
        v.srcObject = stream;
        await v.play();
        onReady(v);
      } catch {
        if (!cancelled) setErr("Camera blocked");
      }
    })();
    return () => { cancelled = true; stream?.getTracks().forEach((t) => t.stop()); };
  }, [onReady]);

  useEffect(() => {
    // Clamp within the viewport so the tile can't be dragged off-screen and lost.
    const clamp = (x: number, y: number) => {
      const w = 220, h = 180;
      return {
        x: Math.min(Math.max(8, x), Math.max(8, window.innerWidth - w)),
        y: Math.min(Math.max(8, y), Math.max(8, window.innerHeight - h)),
      };
    };
    const move = (e: PointerEvent) => {
      if (!drag.current) return;
      setPos(clamp(e.clientX - drag.current.dx, e.clientY - drag.current.dy));
    };
    const up = () => { drag.current = null; };
    const onResize = () => setPos((p) => clamp(p.x, p.y)); // keep it on-screen when the window shrinks
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("resize", onResize);
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.removeEventListener("resize", onResize); };
  }, []);

  return (
    <div
      className="fixed z-50 select-none overflow-hidden rounded-xl border-2 border-[var(--color-line)] bg-black shadow-2xl"
      style={{ left: pos.x, top: pos.y, width: 220, cursor: "grab" }}
      onPointerDown={(e) => { drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y }; }}
    >
      <div className="flex items-center justify-between bg-[var(--color-panel)] px-2 py-1 text-[10px] text-[var(--color-faint)]">
        <span>You</span><span>drag ⠿</span>
      </div>
      {err ? (
        <div className="flex h-[150px] items-center justify-center text-xs text-[var(--color-bad)]">{err}</div>
      ) : (
        <video ref={videoRef} muted playsInline className="block w-full" style={{ transform: "scaleX(-1)" }} />
      )}
    </div>
  );
}
