"use client";
import { useEffect, useRef, useState } from "react";
export function Webcam({
  onReady,
}: {
  onReady?: (video: HTMLVideoElement) => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | undefined;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 480, height: 360 },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        if (ref.current) {
          ref.current.srcObject = stream;
          await ref.current.play();
          if (!cancelled) onReady?.(ref.current);
        }
      } catch {
        stream?.getTracks().forEach((track) => track.stop());
        stream = undefined;
        if (ref.current) ref.current.srcObject = null;
        if (!cancelled)
          setError("Camera unavailable. The interview continues without it.");
      }
    })();
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onReady]);
  return (
    <div className="overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-panel-2)]">
      <p className="px-3 py-2 text-xs">Your self-view · visible only to you</p>
      {error ? (
        <p role="status" className="p-4 text-xs">
          {error}
        </p>
      ) : (
        <video
          ref={ref}
          muted
          playsInline
          aria-label="Your local camera preview"
          className="w-full -scale-x-100"
        />
      )}
    </div>
  );
}
