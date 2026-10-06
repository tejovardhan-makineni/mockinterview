"use client";
import { useEffect, useRef, useState } from "react";

export type CameraStatus = "checking" | "verified" | "unavailable";

export function Webcam({
  onReady,
  onStatus,
  compact = false,
}: {
  onReady?: (video: HTMLVideoElement) => void;
  onStatus?: (status: CameraStatus) => void;
  compact?: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | undefined;
    const release = () => {
      stream?.getTracks().forEach((track) => {
        track.onended = null;
        track.stop();
      });
      stream = undefined;
    };
    const unavailable = () => {
      release();
      if (ref.current) ref.current.srcObject = null;
      if (!cancelled) {
        setError("Camera unavailable. The interview continues without it.");
        onStatus?.("unavailable");
      }
    };
    onStatus?.("checking");
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 480, height: 360 },
          audio: false,
        });
        if (cancelled) {
          release();
          return;
        }
        const track = stream.getVideoTracks()[0];
        if (!track || track.readyState !== "live")
          throw new Error("No live camera track");
        track.onended = unavailable;
        if (ref.current) {
          ref.current.srcObject = stream;
          await ref.current.play();
          if (!cancelled && stream && track.readyState === "live") {
            onStatus?.("verified");
            onReady?.(ref.current);
          }
        }
      } catch {
        unavailable();
      }
    })();
    return () => {
      cancelled = true;
      release();
    };
  }, [onReady, onStatus]);
  return (
    <div className="overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-panel-2)]">
      <p className={compact ? "px-2 py-1 text-[10px]" : "px-3 py-2 text-xs"}>
        {compact ? "You · private" : "Your self-view · visible only to you"}
      </p>
      {error ? (
        <p
          role="status"
          title={error}
          className={compact ? "p-2 text-[10px]" : "p-4 text-xs"}
        >
          {compact ? "Camera unavailable" : error}
        </p>
      ) : (
        <video
          ref={ref}
          muted
          playsInline
          aria-label="Your local camera preview"
          className={
            "w-full -scale-x-100 object-cover " +
            (compact ? "aspect-video max-h-28" : "aspect-[4/3]")
          }
        />
      )}
    </div>
  );
}
