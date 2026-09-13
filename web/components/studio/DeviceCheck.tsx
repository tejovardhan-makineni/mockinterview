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
  const [inputDetected, setInputDetected] = useState(false);
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
    if (meter.current) meter.current.value = 0;
  };
  useEffect(() => {
    // The speaker test is optional. A working microphone must not be blocked
    // by the separate confirmation that only appears after playing a tone.
    onReady(mode === "text" || mic);
  }, [mode, mic, onReady]);
  useEffect(() => () => stop(), []);
  async function check(id = device) {
    stop();
    const own = generation.current;
    setBusy(true);
    setMessage("");
    setMic(false);
    setInputDetected(false);
    try {
      // Start browser audio within the check-button gesture, before waiting
      // for microphone permission (which can outlast that gesture).
      const ctx = new AudioContext();
      audio.current = ctx;
      if (ctx.state === "suspended") await ctx.resume();
      if (own !== generation.current) return;
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
      const track = media.getAudioTracks()[0];
      if (!track || track.readyState !== "live")
        throw new Error("No live microphone track");
      track.onended = () => {
        if (own !== generation.current) return;
        stop();
        setBusy(false);
        setMic(false);
        setInputDetected(false);
        setMessage(
          "Microphone disconnected. Check your microphone again or choose text.",
        );
      };
      const source = ctx.createMediaStreamSource(media);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      const data = new Float32Array(256);
      let detected = false;
      const draw = () => {
        if (own !== generation.current) return;
        analyser.getFloatTimeDomainData(data);
        let n = 0;
        for (const value of data) n += value * value;
        const level = Math.sqrt(n / data.length);
        if (meter.current) meter.current.value = Math.min(1, level * 5);
        if (!detected && level > 0.002) {
          detected = true;
          setInputDetected(true);
        }
        raf.current = requestAnimationFrame(draw);
      };
      draw();
      setMic(true);
      // Device labels are helpful, but a browser that cannot list them must
      // still accept the microphone it has already opened successfully.
      void Promise.resolve()
        .then(() => navigator.mediaDevices.enumerateDevices())
        .then((available) => {
          if (own === generation.current)
            setDevices(available.filter((d) => d.kind === "audioinput"));
        })
        .catch(() => {});
      setMessage(
        "Microphone connected and ready. Say a few words to check the input meter.",
      );
    } catch {
      if (own !== generation.current) return;
      stop();
      setBusy(false);
      setMic(false);
      setInputDetected(false);
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
          Play speaker test (optional)
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
      {(message || inputDetected) && (
        <p role="status" className="text-sm text-[var(--color-muted)]">
          {mic && inputDetected
            ? "Microphone is working — input detected. You’re ready for a voice interview."
            : message}
        </p>
      )}
      <p className="text-xs text-[var(--color-muted)]">
        Camera starts off. You can enable a local self-view in the room.
      </p>
    </div>
  );
}
