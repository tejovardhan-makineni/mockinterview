"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui";
import { Webcam, type CameraStatus } from "./Webcam";
import { preferredSpeakerVoice } from "@/lib/speakerVoice";

const RECORDING_SECONDS = 5;
const SPEAKER_SAMPLE =
  "Hi there. Welcome to your practice interview. Take a breath, and make yourself comfortable. If you can hear me clearly, your speakers are ready.";

type CheckPhase = "idle" | "permission" | "recording" | "playback";

export function DeviceCheck({
  mode,
  onReady,
  onDevice,
  camera = false,
  onCamera,
}: {
  mode: "voice" | "text";
  onReady: (ready: boolean) => void;
  onDevice: (id: string) => void;
  camera?: boolean;
  onCamera?: (enabled: boolean) => void;
}) {
  const [message, setMessage] = useState("");
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [device, setDevice] = useState("");
  const [mic, setMic] = useState(false);
  const [inputDetected, setInputDetected] = useState(false);
  const [phase, setPhase] = useState<CheckPhase>("idle");
  const [recordingUrl, setRecordingUrl] = useState("");
  const [speakerPlaying, setSpeakerPlaying] = useState(false);
  const [speakerHeard, setSpeakerHeard] = useState(false);
  const [speakerAttempted, setSpeakerAttempted] = useState(false);
  const [cameraStatus, setCameraStatus] = useState<CameraStatus>("checking");
  const [speakerMessage, setSpeakerMessage] = useState("");
  const meter = useRef<HTMLMeterElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const context = useRef<AudioContext | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const player = useRef<HTMLAudioElement>(null);
  const clipUrl = useRef("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const raf = useRef(0);
  const generation = useRef(0);
  const speakerContext = useRef<AudioContext | null>(null);
  const speakerGeneration = useRef(0);
  const speakerUtterance = useRef<SpeechSynthesisUtterance | null>(null);

  const releaseCapture = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (recorder.current) {
      recorder.current.ondataavailable = null;
      recorder.current.onstop = null;
      recorder.current.onerror = null;
      if (recorder.current.state !== "inactive") recorder.current.stop();
      recorder.current = null;
    }
    stream.current?.getTracks().forEach((track) => {
      track.onended = null;
      track.stop();
    });
    stream.current = null;
    void context.current?.close().catch(() => {});
    context.current = null;
    cancelAnimationFrame(raf.current);
    if (meter.current) meter.current.value = 0;
  }, []);

  const stopCheck = useCallback(() => {
    generation.current++;
    releaseCapture();
    player.current?.pause();
    if (clipUrl.current) URL.revokeObjectURL(clipUrl.current);
    clipUrl.current = "";
  }, [releaseCapture]);

  const stopSpeaker = useCallback(() => {
    speakerGeneration.current++;
    if (speakerUtterance.current) {
      speakerUtterance.current.onend = null;
      speakerUtterance.current.onerror = null;
      window.speechSynthesis.cancel();
      speakerUtterance.current = null;
    }
    void speakerContext.current?.close().catch(() => {});
    speakerContext.current = null;
  }, []);

  useEffect(() => {
    // Some browsers load their installed voices asynchronously. Request the
    // list now so a natural voice is ready when the user presses play.
    window.speechSynthesis?.getVoices?.();
  }, []);

  useEffect(() => {
    onReady(mode === "text" || mic);
  }, [mode, mic, onReady]);
  useEffect(
    () => () => {
      stopCheck();
      stopSpeaker();
    },
    [stopCheck, stopSpeaker],
  );
  useEffect(() => {
    if (!recordingUrl || !player.current) return;
    const own = generation.current;
    const element = player.current;
    void element.play().catch(() => {
      if (own === generation.current) {
        setPhase("idle");
        setMessage(
          "Your recording is ready. Press play below to hear what you said.",
        );
      }
    });
    return () => element.pause();
  }, [recordingUrl]);

  async function check(id = device) {
    stopCheck();
    stopSpeaker();
    setSpeakerPlaying(false);
    setRecordingUrl("");
    const own = generation.current;
    setPhase("permission");
    setMessage("");
    setMic(false);
    setInputDetected(false);
    try {
      // Resume audio during the check-button gesture, before permissions wait.
      const ctx = new AudioContext();
      context.current = ctx;
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
        media.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.current = media;
      const track = media.getAudioTracks()[0];
      if (!track || track.readyState !== "live")
        throw new Error("No live microphone track");
      track.onended = () => {
        if (own !== generation.current) return;
        stopCheck();
        setPhase("idle");
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
      void Promise.resolve()
        .then(() => navigator.mediaDevices.enumerateDevices())
        .then((available) => {
          if (own === generation.current)
            setDevices(available.filter((item) => item.kind === "audioinput"));
        })
        .catch(() => {});
      if (typeof MediaRecorder === "undefined") {
        releaseCapture();
        setPhase("idle");
        setMessage(
          "Microphone access checked. This browser does not support recording playback; try a current browser to hear your microphone test.",
        );
        return;
      }
      const capture = new MediaRecorder(media);
      recorder.current = capture;
      const chunks: BlobPart[] = [];
      capture.ondataavailable = (event) => {
        if (own === generation.current && event.data.size)
          chunks.push(event.data);
      };
      capture.onerror = () => {
        if (own !== generation.current) return;
        releaseCapture();
        setPhase("idle");
        setMessage(
          "Microphone access checked, but the recording failed. Check your microphone again to try playback.",
        );
      };
      capture.onstop = () => {
        if (own !== generation.current) return;
        const clip = new Blob(chunks, {
          type: capture.mimeType || "audio/webm",
        });
        releaseCapture();
        if (!clip.size) {
          setPhase("idle");
          setMessage(
            "No recording was captured. Check your microphone again and say a few words.",
          );
          return;
        }
        clipUrl.current = URL.createObjectURL(clip);
        setRecordingUrl(clipUrl.current);
        setPhase("playback");
        setMessage(
          "Listen back to what you just said. You can replay the recording below.",
        );
      };
      capture.start();
      setPhase("recording");
      setMessage(
        `Microphone connected and ready. Speak for ${RECORDING_SECONDS} seconds, then we’ll play your words back.`,
      );
      timer.current = setTimeout(() => {
        if (own === generation.current && capture.state === "recording")
          capture.stop();
      }, RECORDING_SECONDS * 1000);
    } catch {
      if (own !== generation.current) return;
      stopCheck();
      setPhase("idle");
      setMic(false);
      setInputDetected(false);
      setMessage(
        "Microphone unavailable. Check your browser permissions, try another device, or choose text.",
      );
    }
  }

  function finishSpeaker() {
    setSpeakerPlaying(false);
    setSpeakerMessage(
      "Select “I heard it” if the sound was clear, or play it again.",
    );
  }

  async function playChime() {
    const own = speakerGeneration.current;
    try {
      const ctx = new AudioContext();
      speakerContext.current = ctx;
      if (ctx.state === "suspended") await ctx.resume();
      if (speakerContext.current !== ctx) return;
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = "sine";
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      const at = ctx.currentTime;
      gain.gain.setValueAtTime(0, at);
      [392, 494, 587].forEach((frequency, index) => {
        const start = at + index * 0.6;
        oscillator.frequency.setValueAtTime(frequency, start);
        gain.gain.linearRampToValueAtTime(0.08, start + 0.04);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.5);
      });
      oscillator.start();
      oscillator.stop(at + 1.8);
      setSpeakerMessage(
        "Listen for three soft notes, then confirm you heard them.",
      );
      oscillator.onended = () => {
        if (speakerContext.current !== ctx) return;
        speakerContext.current = null;
        void ctx.close().catch(() => {});
        finishSpeaker();
      };
    } catch {
      if (own !== speakerGeneration.current) return;
      stopSpeaker();
      setSpeakerPlaying(false);
      setSpeakerMessage(
        "Audio could not play. Check your output device and volume, then retry.",
      );
    }
  }

  function speakerTest() {
    stopSpeaker();
    player.current?.pause();
    setSpeakerPlaying(true);
    setSpeakerAttempted(true);
    setSpeakerHeard(false);
    setSpeakerMessage(
      "Listen to the sample. Adjust your volume until it feels comfortable.",
    );
    try {
      if (
        "speechSynthesis" in window &&
        typeof SpeechSynthesisUtterance !== "undefined"
      ) {
        const voice = preferredSpeakerVoice(
          window.speechSynthesis.getVoices?.() ?? [],
        );
        // A brief musical sample is clearer than a robotic system fallback.
        if (!voice) {
          void playChime();
          return;
        }
        const utterance = new SpeechSynthesisUtterance(SPEAKER_SAMPLE);
        utterance.voice = voice;
        utterance.lang = voice.lang;
        utterance.rate = 1;
        speakerUtterance.current = utterance;
        utterance.onend = () => {
          if (speakerUtterance.current !== utterance) return;
          speakerUtterance.current = null;
          finishSpeaker();
        };
        utterance.onerror = () => {
          if (speakerUtterance.current !== utterance) return;
          speakerUtterance.current = null;
          void playChime();
        };
        window.speechSynthesis.speak(utterance);
        return;
      }
      void playChime();
    } catch {
      stopSpeaker();
      void playChime();
    }
  }

  const micStatus = !mic
    ? phase === "permission"
      ? "Allow access"
      : "Needs check"
    : phase === "recording"
      ? inputDetected
        ? "Verified · sound detected"
        : "Connected · quiet"
      : inputDetected
        ? "Verified · microphone test"
        : "Permission checked · no sound detected";

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--color-line)]">
      {mode === "text" ? (
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 p-3 sm:p-4">
          <div>
            <p className="text-sm font-semibold">Text conversation</p>
            <p className="mt-1 text-xs text-[var(--color-muted)]">
              Read questions and type your answers. No microphone needed.
            </p>
          </div>
          <CheckStatus good>Ready</CheckStatus>
        </div>
      ) : (
        <>
          <section aria-label="Microphone check" className="p-3 sm:p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <DeviceIcon kind="microphone" />
                <h3 className="text-sm font-semibold">Microphone</h3>
                <span className="text-xs text-[var(--color-muted)]">
                  Required
                </span>
              </div>
              <CheckStatus good={mic && inputDetected}>{micStatus}</CheckStatus>
            </div>
            <p className="mt-2 text-xs text-[var(--color-muted)]">
              {mic
                ? phase === "recording"
                  ? inputDetected
                    ? "Your microphone is working. Permission and sound are verified."
                    : "Permission is verified. Speak a few words to check your input level."
                  : inputDetected
                    ? "Your microphone test passed. We’ll reconnect it when your interview starts."
                    : "Permission is checked, but this test detected no sound. Check your mute switch and test again."
                : "Allow microphone access and say a few words. We’ll play them back to you."}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void check()}
                disabled={phase !== "idle"}
              >
                {phase === "permission"
                  ? "Waiting for permission…"
                  : phase === "recording"
                    ? "Recording…"
                    : phase === "playback"
                      ? "Playing back…"
                      : mic
                        ? "Check microphone again"
                        : "Check microphone"}
              </Button>
              {phase === "recording" && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    if (recorder.current?.state === "recording")
                      recorder.current.stop();
                  }}
                >
                  Stop & play back
                </Button>
              )}
              {phase !== "idle" && (
                <button
                  type="button"
                  className="px-2 text-xs text-[var(--color-muted)] underline underline-offset-4"
                  onClick={() => {
                    stopCheck();
                    setRecordingUrl("");
                    setPhase("idle");
                    setMic(false);
                    setInputDetected(false);
                    setMessage(
                      "Microphone check cancelled. You can check again or choose text.",
                    );
                  }}
                >
                  Cancel check
                </button>
              )}
              <meter
                ref={meter}
                min={0}
                max={1}
                value={0}
                aria-label="Microphone input level"
                className="ml-auto h-3 w-24 shrink-0"
              />
            </div>
            {message && (
              <p
                role="status"
                className="mt-2 text-xs text-[var(--color-muted)]"
              >
                {message}
              </p>
            )}
            {recordingUrl && (
              <div className="mt-3 space-y-1">
                <audio
                  ref={player}
                  src={recordingUrl}
                  controls
                  aria-label="Your microphone test recording"
                  className="h-9 w-full min-w-0 max-w-full"
                  onPlay={() => setPhase("playback")}
                  onPause={() => setPhase("idle")}
                  onEnded={() => {
                    setPhase("idle");
                    setMessage(
                      "Microphone check complete. Replay your recording or start your interview.",
                    );
                  }}
                />
                <p className="text-[11px] text-[var(--color-muted)]">
                  Test recording stays on this device and is discarded when you
                  leave.
                </p>
              </div>
            )}
            {devices.length > 1 && (
              <label className="mt-3 block text-xs text-[var(--color-muted)]">
                Input device
                <select
                  value={device}
                  onChange={(event) => {
                    setDevice(event.target.value);
                    onDevice(event.target.value);
                    void check(event.target.value);
                  }}
                  className="field-select mt-1 text-xs"
                >
                  <option value="">System default</option>
                  {devices.map((item) => (
                    <option key={item.deviceId} value={item.deviceId}>
                      {item.label || "Microphone"}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </section>
          <section
            aria-label="Speaker check"
            className="border-t border-[var(--color-line)] p-3 sm:p-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <DeviceIcon kind="speaker" />
                <h3 className="text-sm font-semibold">Speaker</h3>
                <span className="text-xs text-[var(--color-muted)]">
                  Optional check
                </span>
              </div>
              <CheckStatus good={speakerHeard}>
                {speakerHeard
                  ? "Verified by you"
                  : speakerPlaying
                    ? "Playing sample"
                    : "Not checked"}
              </CheckStatus>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={
                  speakerPlaying
                    ? () => {
                        stopSpeaker();
                        setSpeakerPlaying(false);
                        setSpeakerMessage(
                          "Speaker test stopped. You can replay it any time.",
                        );
                      }
                    : speakerTest
                }
                disabled={phase === "permission" || phase === "recording"}
              >
                {speakerPlaying ? "Stop speaker test" : "Play speaker test"}
              </Button>
              {speakerAttempted && !speakerHeard && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    stopSpeaker();
                    setSpeakerPlaying(false);
                    setSpeakerHeard(true);
                    setSpeakerMessage(
                      "Speaker confirmed. You’re ready to hear your interviewer.",
                    );
                  }}
                >
                  I heard it
                </Button>
              )}
              {!speakerAttempted && (
                <span className="text-xs text-[var(--color-muted)]">
                  A short sample to check your volume.
                </span>
              )}
            </div>
            {speakerMessage && (
              <p
                role="status"
                className="mt-2 text-xs text-[var(--color-muted)]"
              >
                {speakerMessage}
              </p>
            )}
          </section>
        </>
      )}
      {onCamera && (
        <section
          aria-label="Camera check"
          className="border-t border-[var(--color-line)] p-3 sm:p-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <DeviceIcon kind="camera" />
              <h3 className="text-sm font-semibold">Camera</h3>
              <span className="text-xs text-[var(--color-muted)]">
                Optional
              </span>
            </div>
            <CheckStatus good={camera && cameraStatus === "verified"}>
              {!camera
                ? "Off"
                : cameraStatus === "verified"
                  ? "Verified · preview ready"
                  : cameraStatus === "unavailable"
                    ? "Unavailable · optional"
                    : "Checking access…"}
            </CheckStatus>
          </div>
          <label className="mt-3 flex items-start gap-2 text-xs">
            <input
              type="checkbox"
              checked={camera}
              onChange={(event) => {
                setCameraStatus("checking");
                onCamera(event.target.checked);
              }}
              className="h-4 w-4 shrink-0"
            />
            Show my private camera preview
          </label>
          <p className="mt-1 text-xs text-[var(--color-muted)]">
            Only you see it. Camera access never blocks your interview.
          </p>
          {camera && (
            <div className="mt-3 max-w-48">
              <Webcam compact onStatus={setCameraStatus} />
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function CheckStatus({
  good = false,
  children,
}: {
  good?: boolean;
  children: React.ReactNode;
}) {
  return (
    <span
      role="status"
      className={
        "inline-flex min-w-0 max-w-full items-start gap-1.5 text-xs font-medium " +
        (good ? "text-[var(--color-good)]" : "text-[var(--color-muted)]")
      }
    >
      <span className="shrink-0" aria-hidden="true">
        {good ? "✓" : "○"}
      </span>
      <span className="min-w-0">{children}</span>
    </span>
  );
}

function DeviceIcon({ kind }: { kind: "microphone" | "speaker" | "camera" }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4 shrink-0 text-[var(--color-muted)]"
    >
      {kind === "microphone" ? (
        <>
          <rect x="9" y="3" width="6" height="12" rx="3" />
          <path d="M6 11v1a6 6 0 0012 0v-1M12 18v3M9 21h6" />
        </>
      ) : kind === "speaker" ? (
        <>
          <path d="M11 5L6 9H3v6h3l5 4V5zM15 8a6 6 0 010 8M18 5a10 10 0 010 14" />
        </>
      ) : (
        <>
          <rect x="3" y="6" width="12" height="12" rx="2" />
          <path d="M15 10l6-3v10l-6-3" />
        </>
      )}
    </svg>
  );
}
