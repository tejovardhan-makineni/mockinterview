"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import type { Modality, Session } from "@/lib/types";
import { LiveSession, type Caption, type ConnState } from "@/lib/live";
import { BehaviorTracker } from "@/lib/behavior";
import { Avatar3D, type AvatarDrive } from "@/components/studio/Avatar3D";
import { Workspace } from "@/components/studio/Workspace";
import { Webcam } from "@/components/studio/Webcam";
import { Button } from "@/components/ui";

function StudioInner() {
  const router = useRouter();
  const sid = useSearchParams().get("s") || "";
  const [session, setSession] = useState<Session | null>(null);
  const [captions, setCaptions] = useState<Caption[]>([]);
  const avatar = useRef<AvatarDrive>({ speaking: false, amplitude: 0, mood: "neutral" });
  const [status, setStatus] = useState("connecting…");
  const [conn, setConn] = useState<ConnState>("connecting");
  const [ending, setEnding] = useState(false);
  const [typed, setTyped] = useState("");
  const [remainingMs, setRemainingMs] = useState<number | null>(null);

  const live = useRef<LiveSession | null>(null);
  const tracker = useRef<BehaviorTracker | null>(null);
  const lastCanvas = useRef<string>("");
  const timerRef = useRef<number | undefined>(undefined);
  const endedRef = useRef(false);

  useEffect(() => {
    // cancelled guards the async setup: if we unmount (incl. React StrictMode's
    // double-invoke) before start() runs, we must NOT open a socket/mic/timer
    // that the cleanup already ran past. We also tear down the LOCAL handles we
    // created, not just the refs, so nothing is orphaned.
    let cancelled = false;
    let localTimer: number | undefined;
    let localLive: LiveSession | undefined;

    (async () => {
      const u = await api.me();
      if (cancelled) return;
      if (!u) { router.replace("/login"); return; }
      const s = await api.getSession(sid);
      if (cancelled) return;
      setSession(s);

      const ls = new LiveSession(sid, [], s.config?.voice_id ?? "aoede");
      localLive = ls;
      live.current = ls;
      ls.on("caption", (c) => setCaptions((prev) => {
        const last = prev[prev.length - 1];
        // Coalesce: while a turn streams (or when it finalizes), replace the last
        // bubble of the same role rather than adding a new one per chunk.
        if (last && last.role === c.role && last.streaming) return [...prev.slice(0, -1), c];
        return [...prev.slice(-60), c];
      }))
        .on("speaking", (on) => { avatar.current.speaking = on; avatar.current.mood = on ? "neutral" : "listening"; })
        .on("userSpeaking", (on) => { tracker.current?.setSpeaking(on); })
        .on("amplitude", (v) => { avatar.current.amplitude = v; })
        .on("mode", (m) => setStatus(m === "voice" ? "live voice" : m === "text" ? "voice (browser)" : "demo mode"))
        .on("status", setStatus)
        .on("connection", setConn)
        .on("filler", () => { tracker.current?.addEvent("filler"); avatar.current.mood = "curious"; })
        .on("pause", () => { tracker.current?.addEvent("long_pause"); })
        .on("help", () => { tracker.current?.addEvent("help_request"); })
        .on("ended", () => { void end(); });

      // Timed interview: the interviewer knows the clock and wraps up on its own.
      const minutes = pickMinutes(s.modality);
      const endAt = Date.now() + minutes * 60000;
      setRemainingMs(minutes * 60000);
      let lastTimeSent = 0;
      localTimer = window.setInterval(() => {
        const left = endAt - Date.now();
        setRemainingMs(left);
        if (Date.now() - lastTimeSent > 60000) {
          lastTimeSent = Date.now();
          const mins = Math.round(left / 60000);
          live.current?.sendTime(mins <= 0 ? "time is up" : `about ${mins} minute${mins === 1 ? "" : "s"} remain`);
        }
        // Hard safety stop ~90s past zero if the interviewer hasn't wrapped up.
        if (left < -90000) void end();
      }, 1000);
      timerRef.current = localTimer;

      if (cancelled) { ls.end(); if (localTimer) clearInterval(localTimer); return; }
      await ls.start(minutes);
    })();

    return () => {
      cancelled = true;
      localLive?.end();
      void tracker.current?.stop();
      if (localTimer) clearInterval(localTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, sid]);

  const onWebcam = useCallback((v: HTMLVideoElement) => {
    const t = new BehaviorTracker(sid, v);
    tracker.current = t;
    void t.begin();
  }, [sid]);

  // Debounced content changes already handled in Workspace; here we persist +
  // feed the interviewer.
  const onContent = useCallback((text: string) => {
    void api.saveWorkspace(sid, session?.modality === "coding" ? "code" : session?.modality === "written" ? "written" : "note", text);
    // Only feed the interviewer a MEANINGFUL, CHANGED drawing — otherwise every
    // debounced Excalidraw tick (even "empty canvas") is a new turn and the AI
    // replies each time, which reads as repeating the question.
    const t = text.trim();
    if (!t || t === "empty canvas" || t === lastCanvas.current) return;
    lastCanvas.current = t;
    live.current?.sendCanvas(t);
  }, [sid, session?.modality]);

  async function end() {
    if (endedRef.current) return; // idempotent — the AI, the timer, and the button all call this
    endedRef.current = true;
    setEnding(true);
    if (timerRef.current) clearInterval(timerRef.current);
    live.current?.end();
    await tracker.current?.stop();
    try { await api.finishSession(sid); } catch { /* ignore — still show the report */ }
    router.push(`/report?s=${sid}`);
  }

  if (!session) return <div className="flex h-screen items-center justify-center text-[var(--color-muted)]">Entering the room…</div>;

  const faceId = readFace(session);
  const modality: Modality = session.modality;

  return (
    <main className="flex h-screen flex-col bg-[var(--color-studio)]">
      {/* top bar */}
      <header className="flex items-center justify-between border-b border-[var(--color-line)] px-5 py-2.5">
        <div className="flex items-center gap-3 text-sm">
          <span className="live-dot inline-block h-2 w-2 rounded-full bg-[var(--color-live)]" />
          <span className="font-semibold">Interview in progress</span>
          <span className="rounded-full border border-[var(--color-line)] px-2 py-0.5 text-xs text-[var(--color-muted)]">{status}</span>
          <span className="text-xs text-[var(--color-faint)]">{modality.replace("_", " ")}</span>
          {(conn === "reconnecting" || conn === "failed") && (
            <span className={`flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs ${conn === "failed" ? "border-[var(--color-bad)] text-[var(--color-bad)]" : "border-[var(--color-warn)] text-[var(--color-warn)]"}`}>
              {conn === "reconnecting"
                ? <><span className="inline-block h-2 w-2 animate-pulse rounded-full bg-[var(--color-warn)]" /> Reconnecting…</>
                : <>⚠ Connection lost</>}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {remainingMs !== null && (
            <span className={`rounded-full border px-3 py-1 font-mono text-sm ${remainingMs < 120000 ? "border-[var(--color-bad)] text-[var(--color-bad)]" : "border-[var(--color-line)] text-[var(--color-muted)]"}`}>
              ⏱ {fmtTime(remainingMs)}
            </span>
          )}
          <Button variant="danger" onClick={end} disabled={ending}>{ending ? "Scoring…" : "End & get report"}</Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* interviewer panel */}
        <aside className="flex w-[340px] flex-col border-r border-[var(--color-line)] p-4">
          <div className="aspect-square w-full overflow-hidden rounded-xl bg-[var(--color-panel)]">
            <Avatar3D faceId={faceId} drive={avatar} />
          </div>
          <div className="mt-3 flex-1 overflow-y-auto rounded-xl border border-[var(--color-line)] bg-[var(--color-panel)] p-3 text-sm">
            {captions.length === 0 && <p className="text-[var(--color-faint)]">The interviewer will begin shortly…</p>}
            {captions.map((c, i) => (
              <p key={i} className={`mb-2 ${c.role === "interviewer" ? "text-[var(--color-ink)]" : "text-[var(--color-muted)]"}`}>
                <span className="text-xs font-semibold text-[var(--color-faint)]">{c.role === "interviewer" ? "Interviewer" : "You"}: </span>
                {c.text}
              </p>
            ))}
          </div>
          {/* typed answer fallback (if mic unavailable) */}
          <form
            className="mt-3 flex gap-2"
            onSubmit={(e) => { e.preventDefault(); if (typed.trim()) { live.current?.submitText(typed); setTyped(""); } }}
          >
            <input
              value={typed} onChange={(e) => setTyped(e.target.value)}
              placeholder="Type an answer…"
              className="min-w-0 flex-1 rounded-lg border border-[var(--color-line)] bg-[var(--color-studio)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
            />
            <Button type="submit" variant="ghost">Send</Button>
            {(conn === "failed" || conn === "reconnecting") && (
              <Button
                type="button"
                variant={conn === "failed" ? "danger" : "ghost"}
                onClick={() => { setConn("reconnecting"); live.current?.reconnect(); }}
                title="Reconnect to the interviewer"
              >
                {conn === "reconnecting" ? "Retry" : "Reconnect"}
              </Button>
            )}
          </form>
        </aside>

        {/* workspace */}
        <section className="min-w-0 flex-1 p-4">
          <Workspace modality={modality} onContent={onContent} />
        </section>
      </div>

      <Webcam onReady={onWebcam} />
    </main>
  );
}

// Interview length by modality + a small random buffer, so the AI paces + wraps up.
function pickMinutes(modality: string): number {
  const base = modality === "conversational" ? 18 : modality === "written" ? 22 : 30;
  return base + Math.floor(Math.random() * 6); // +0..5
}
function fmtTime(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function readFace(s: Session): string {
  try {
    const cfg = (s as unknown as { config?: { face_id?: string } }).config;
    return cfg?.face_id ?? "ava";
  } catch { return "ava"; }
}

export default function InterviewPage() {
  return <Suspense fallback={<div className="flex h-screen items-center justify-center text-[var(--color-muted)]">Loading…</div>}><StudioInner /></Suspense>;
}
