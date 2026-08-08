"use client";

// LiveHUD is the interview room's status HUD: it proves the candidate's mic is
// being heard (a live waveform meter), shows what the interviewer is doing
// (listening / thinking / speaking), and shows connection health with a manual
// Reconnect. The fast-changing mic level is read from a ref via rAF so it never
// re-renders React; the coarse states are props.
import { useEffect, useRef, type MutableRefObject } from "react";
import type { ConnState } from "@/lib/live";
import { useT } from "@/lib/i18n";
import { IconMic, IconMicOff, IconWave, IconThinking, IconSpeaker, IconConnected, IconReconnect, IconDisconnected } from "@/components/icons";

export type AiState = "idle" | "listening" | "thinking" | "speaking";

const BARS = 7;

export function LiveHUD({
  micRef, aiState, conn, mode,
}: {
  micRef: MutableRefObject<number>;
  aiState: AiState;
  conn: ConnState;
  mode: "voice" | "text" | "local";
}) {
  const barRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const labelRef = useRef<HTMLSpanElement>(null);
  const t = useT();

  // Animate the meter bars from the live mic level without re-rendering.
  useEffect(() => {
    // Resolve the label strings ONCE per effect run — never inside the rAF loop.
    const hearing = t("Hearing you…"), demoMic = t("Demo mic"), listening = t("Listening");
    let raf = 0;
    const loop = () => {
      const lvl = micRef.current;
      for (let i = 0; i < BARS; i++) {
        const el = barRefs.current[i];
        if (!el) continue;
        // Center bars react more; add a subtle traveling wave so it feels alive.
        const weight = 0.5 + 0.5 * Math.sin((i / BARS) * Math.PI);
        const wave = 0.15 * Math.abs(Math.sin(Date.now() / 180 + i));
        const h = 12 + Math.min(1, lvl * weight + (lvl > 0.02 ? wave : 0)) * 88;
        el.style.height = `${h}%`;
        el.style.opacity = String(0.35 + Math.min(1, lvl * 2) * 0.65);
      }
      if (labelRef.current) {
        labelRef.current.textContent = lvl > 0.04 ? hearing : mode === "local" ? demoMic : listening;
      }
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [micRef, mode, t]);

  const ai = AI_STATES[aiState];

  return (
    <div className="mi-panel flex flex-col gap-2 rounded-xl border border-[var(--color-line)] bg-[var(--color-panel)] px-3 py-2.5">
      {/* Mic meter — proof the candidate is being heard */}
      <div className="flex items-center gap-2" title="Your microphone level">
        <span className="text-[var(--color-accent)]" aria-hidden>
          {conn === "connected" || mode === "local" ? <IconMic className="h-4 w-4" /> : <IconMicOff className="h-4 w-4" />}
        </span>
        <div className="flex h-6 items-end gap-[3px]" role="img" aria-label="Live microphone input level">
          {Array.from({ length: BARS }).map((_, i) => (
            <span
              key={i}
              ref={(el) => { barRefs.current[i] = el; }}
              className="w-[3px] rounded-full bg-gradient-to-t from-[var(--color-accent)] to-[var(--color-accent-2)]"
              style={{ height: "12%" }}
            />
          ))}
        </div>
        <span ref={labelRef} className="text-[11px] font-medium text-[var(--color-muted)]">{t("Listening")}</span>
      </div>

      <span className="h-px w-full bg-[var(--color-line)]" />

      {/* Interviewer state */}
      <div className="flex min-w-0 items-center gap-1.5" aria-live="polite">
        <span className={ai.color}>{ai.icon}</span>
        <span className={`truncate text-[11px] font-medium ${ai.color}`}>{t(ai.label)}</span>
        {aiState === "thinking" && <ThinkingDots />}
      </div>
    </div>
  );
}

const AI_STATES: Record<AiState, { label: string; icon: React.ReactNode; color: string }> = {
  idle: { label: "Ready", icon: <IconThinking className="h-4 w-4" />, color: "text-[var(--color-faint)]" },
  listening: { label: "Interviewer listening", icon: <IconWave className="h-4 w-4" />, color: "text-[var(--color-muted)]" },
  thinking: { label: "Thinking", icon: <IconThinking className="h-4 w-4" />, color: "text-[var(--color-warn)]" },
  speaking: { label: "Interviewer speaking", icon: <IconSpeaker className="h-4 w-4" />, color: "text-[var(--color-accent)]" },
};

function ThinkingDots() {
  return (
    <span className="flex items-center gap-0.5" aria-hidden>
      {[0, 1, 2].map((i) => (
        <span key={i} className="h-1 w-1 rounded-full bg-[var(--color-warn)] mi-blink" style={{ animationDelay: `${i * 160}ms` }} />
      ))}
    </span>
  );
}

export function ConnChip({ conn, onReconnect }: { conn: ConnState; onReconnect: () => void }) {
  const t = useT();
  if (conn === "connected") {
    return (
      <span className="flex items-center gap-1.5 rounded-full border border-[color-mix(in_srgb,var(--color-good)_40%,transparent)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-good)]" title="Connected to the interviewer">
        <IconConnected className="h-3.5 w-3.5" /> <span className="hidden sm:inline">{t("Connected")}</span>
      </span>
    );
  }
  if (conn === "connecting" || conn === "reconnecting") {
    return (
      <span className="flex items-center gap-1.5 rounded-full border border-[color-mix(in_srgb,var(--color-warn)_40%,transparent)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-warn)]">
        <IconReconnect className="h-3.5 w-3.5 mi-spin" /> {conn === "reconnecting" ? t("Reconnecting…") : t("Connecting…")}
      </span>
    );
  }
  // failed / closed → offer manual reconnect
  return (
    <button
      onClick={onReconnect}
      className="flex items-center gap-1.5 rounded-full border border-[var(--color-bad)] px-2.5 py-0.5 text-[11px] font-semibold text-[var(--color-bad)] transition hover:bg-[color-mix(in_srgb,var(--color-bad)_12%,transparent)]"
      title="Connection lost — click to reconnect"
    >
      <IconDisconnected className="h-3.5 w-3.5" /> {t("Reconnect")}
    </button>
  );
}
