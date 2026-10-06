"use client";

import { useEffect, useRef, type RefObject } from "react";
import type { AudioState, ConnState, MicState, SectionInfo } from "@/lib/live";
import {
  IconMic,
  IconMicOff,
  IconSpeaker,
  IconConnected,
  IconReconnect,
  IconDisconnected,
} from "@/components/icons";

export type AiState = "idle" | "listening" | "thinking" | "speaking";

const microphoneLabels: Record<MicState, string> = {
  off: "Microphone off",
  starting: "Opening microphone…",
  live: "Microphone on",
  muted: "Microphone muted",
  interrupted: "Microphone paused",
  unavailable: "Microphone unavailable",
};

export function LiveHUD({
  micRef,
  microphone,
  audio,
  conn,
  mode,
  section,
  onReconnect,
  onRetryMicrophone,
  onResumeAudio,
}: {
  micRef: RefObject<number>;
  microphone: MicState;
  audio: AudioState;
  conn: ConnState;
  mode: "voice" | "text";
  section?: SectionInfo | null;
  onReconnect: () => void;
  onRetryMicrophone: () => void;
  onResumeAudio: () => void;
}) {
  const meter = useRef<HTMLMeterElement>(null);
  const levelBar = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let raf = 0;
    const update = () => {
      const value =
        microphone === "live" ? Math.max(0, Math.min(1, micRef.current)) : 0;
      if (meter.current) meter.current.value = value;
      if (levelBar.current)
        levelBar.current.style.transform = `scaleX(${value})`;
      raf = requestAnimationFrame(update);
    };
    update();
    return () => cancelAnimationFrame(raf);
  }, [micRef, microphone]);

  const micNeedsHelp =
    mode === "voice" &&
    conn === "connected" &&
    (microphone === "unavailable" || microphone === "interrupted");
  const audioNeedsHelp =
    mode === "voice" && (audio === "blocked" || audio === "unavailable");
  return (
    <section
      aria-label="Interview connection and device health"
      className="room-health mb-4 rounded-xl border border-[var(--color-line)] bg-[var(--color-panel)] px-4 py-3"
    >
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3 text-xs">
        <ConnChip conn={conn} onReconnect={onReconnect} />
        {mode === "voice" ? (
          <>
            <div
              className="room-mic-health flex items-center gap-2"
              title="The meter shows local input. Your microphone is sent to the interviewer while connected and unmuted."
            >
              {microphone === "live" ? (
                <IconMic className="h-4 w-4 text-[var(--color-good)]" />
              ) : (
                <IconMicOff className="h-4 w-4 text-[var(--color-muted)]" />
              )}
              <span role="status">{microphoneLabels[microphone]}</span>
              <meter
                ref={meter}
                min={0}
                max={1}
                value={0}
                className="sr-only"
                aria-label="Live microphone input level"
              />
              <span
                className="h-1.5 w-14 overflow-hidden rounded-full bg-[var(--color-panel-2)]"
                aria-hidden="true"
              >
                <span
                  ref={levelBar}
                  className="block h-full w-full origin-left rounded-full bg-[var(--color-good)]"
                  style={{ transform: "scaleX(0)" }}
                />
              </span>
            </div>
            <div className="room-speaker-health flex items-center gap-2">
              <IconSpeaker className="h-4 w-4 text-[var(--color-muted)]" />
              <span role="status">
                {audio === "ready"
                  ? "Sound on"
                  : audioNeedsHelp
                    ? "Sound paused"
                    : "Preparing sound…"}
              </span>
            </div>
          </>
        ) : (
          <span className="text-[var(--color-muted)]">
            Text interview · microphone off
          </span>
        )}
        {section && section.total > 0 && (
          <span
            className="room-stage-health text-[var(--color-muted)] lg:ml-auto"
            role="status"
          >
            <span className="font-medium text-[var(--color-ink)]">
              {section.title}
            </span>
            {" · "}
            {Math.min(section.index + 1, section.total)} of {section.total}
          </span>
        )}
      </div>
      {(micNeedsHelp || audioNeedsHelp || conn === "reconnecting") && (
        <div className="mt-3 space-y-2 border-t border-[var(--color-line)] pt-3 text-xs text-[var(--color-muted)]">
          {conn === "reconnecting" && (
            <p role="status">
              Restoring your connection. Typed answers stay queued until you
              reconnect.
            </p>
          )}
          {micNeedsHelp && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p role="status">
                {microphone === "unavailable"
                  ? "Check microphone permission or reconnect your device. You can still type an answer."
                  : "Your microphone was paused by your device or browser."}
              </p>
              <button
                type="button"
                className="min-h-9 rounded-md border border-[var(--color-line)] px-3 font-semibold text-[var(--color-ink)] hover:bg-[var(--color-panel-2)]"
                onClick={onRetryMicrophone}
              >
                Retry microphone
              </button>
            </div>
          )}
          {audioNeedsHelp && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p role="status">
                {audio === "blocked"
                  ? "Your browser paused playback. Resume to hear the interviewer."
                  : "Audio playback is unavailable. The conversation is also shown below."}
              </p>
              <button
                type="button"
                className="min-h-9 rounded-md border border-[var(--color-line)] px-3 font-semibold text-[var(--color-ink)] hover:bg-[var(--color-panel-2)]"
                onClick={onResumeAudio}
              >
                Resume sound
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export function ConnChip({
  conn,
  onReconnect,
}: {
  conn: ConnState;
  onReconnect: () => void;
}) {
  if (conn === "connected") {
    return (
      <span
        role="status"
        className="flex items-center gap-1.5 text-[var(--color-good)]"
      >
        <IconConnected className="h-4 w-4" />
        Connected
      </span>
    );
  }
  if (conn === "connecting" || conn === "reconnecting") {
    return (
      <span
        role="status"
        className="flex items-center gap-1.5 text-[var(--color-warn)]"
      >
        <IconReconnect className="h-4 w-4" />
        {conn === "reconnecting" ? "Reconnecting…" : "Connecting…"}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onReconnect}
      className="flex min-h-9 items-center gap-1.5 rounded-md border border-[var(--color-bad)] px-3 font-medium text-[var(--color-bad)] hover:bg-[var(--color-panel-2)]"
    >
      <IconDisconnected className="h-4 w-4" />
      Connection lost · Retry
    </button>
  );
}
