"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui";
export function DeviceCheck({
  mode,
  onReady,
  onDevice,
}: {
  mode: "voice" | "text";
  onReady: (ready: boolean) => void;
  onDevice: (id: string) => void;
}) {
  const [message, setMessage] = useState("");
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [device, setDevice] = useState("");
  const [mic, setMic] = useState(false);
  const [heard, setHeard] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tonePlayed, setTonePlayed] = useState(false);
  const meter = useRef<HTMLMeterElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const audio = useRef<AudioContext | null>(null);
  const raf = useRef(0);
  const generation = useRef(0);
  const stop = () => {
    generation.current++;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    void audio.current?.close().catch(() => {});
    audio.current = null;
    cancelAnimationFrame(raf.current);
  };
  useEffect(() => {
    onReady(mode === "text" || (mic && heard));
  }, [mode, mic, heard, onReady]);
  useEffect(() => () => stop(), []);
  async function check(id = device) {
    const own = ++generation.current;
    setBusy(true);
    setMessage("");
    setMic(false);
    stream.current?.getTracks().forEach((t) => t.stop());
    void audio.current?.close().catch(() => {});
    cancelAnimationFrame(raf.current);
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          ...(id ? { deviceId: { exact: id } } : {}),
        },
        video: false,
      });
      if (own !== generation.current) {
        media.getTracks().forEach((t) => t.stop());
        return;
      }
      stream.current = media;
      const ctx = new AudioContext();
      audio.current = ctx;
      const source = ctx.createMediaStreamSource(media);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      const data = new Float32Array(256);
      const draw = () => {
        analyser.getFloatTimeDomainData(data);
        let n = 0;
        for (const value of data) n += value * value;
        if (meter.current)
          meter.current.value = Math.min(1, Math.sqrt(n / data.length) * 5);
        raf.current = requestAnimationFrame(draw);
      };
      draw();
      setMic(true);
      setDevices(
        (await navigator.mediaDevices.enumerateDevices()).filter(
          (d) => d.kind === "audioinput",
        ),
      );
      setMessage(
        "Microphone permission is ready. Say a few words and check the meter.",
      );
    } catch {
      stream.current?.getTracks().forEach((track) => track.stop());
      stream.current = null;
      void audio.current?.close().catch(() => {});
      audio.current = null;
      setMessage(
        "Microphone unavailable. Check your browser permissions, try another device, or choose text.",
      );
    } finally {
      if (own === generation.current) setBusy(false);
    }
  }
  function tone() {
    const ctx = new AudioContext();
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    gain.gain.value = 0.08;
    oscillator.frequency.value = 440;
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    void ctx.resume();
    oscillator.start();
    oscillator.stop(ctx.currentTime + 0.4);
    oscillator.onended = () => {
      void ctx.close();
    };
    setTonePlayed(true);
  }
  if (mode === "text")
    return (
      <div className="notice">
        <strong>Text is ready.</strong>
        <p className="mt-1 text-sm">
          Read your interviewer’s questions and type your answers. No microphone
          or camera permission is needed.
        </p>
      </div>
    );
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" onClick={() => void check()} disabled={busy}>
          {busy
            ? "Waiting for permission…"
            : mic
              ? "Check microphone again"
              : "Check microphone"}
        </Button>
        {busy && (
          <Button
            variant="ghost"
            onClick={() => {
              stop();
              setBusy(false);
              setMessage(
                "Permission check cancelled. You can choose text instead.",
              );
            }}
          >
            Cancel check
          </Button>
        )}
        <meter
          ref={meter}
          min={0}
          max={1}
          value={0}
          aria-label="Microphone input level"
          className="h-5 w-32"
        />
      </div>
      {devices.length > 0 && (
        <label className="block text-sm">
          Microphone
          <select
            value={device}
            onChange={(e) => {
              setDevice(e.target.value);
              onDevice(e.target.value);
              void check(e.target.value);
            }}
            className="field-select mt-2"
          >
            <option value="">System default</option>
            {devices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || "Microphone"}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" onClick={tone}>
          Play speaker test
        </Button>
        {tonePlayed && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={heard}
              onChange={(e) => setHeard(e.target.checked)}
            />
            I heard the tone
          </label>
        )}
      </div>
      {message && (
        <p role="status" className="text-sm text-[var(--color-muted)]">
          {message}
        </p>
      )}
      <p className="text-xs text-[var(--color-muted)]">
        Camera starts off. You can enable a local self-view in the room.
      </p>
    </div>
  );
}
