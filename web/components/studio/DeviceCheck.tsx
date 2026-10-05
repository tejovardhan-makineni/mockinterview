"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui";
import { Webcam } from "./Webcam";

const RECORDING_SECONDS = 5;
const SPEAKER_SAMPLE =
  "Welcome to your practice interview. You should hear this sentence clearly in both ears. Take a moment to adjust your speaker or headphone volume before we begin.";

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
          "Microphone connected and ready. This browser does not support recording playback; try a current browser to hear your microphone test.",
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
          "Microphone connected, but the recording failed. Check your microphone again to try playback.",
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

  function speakerTest() {
    stopSpeaker();
    player.current?.pause();
    setSpeakerPlaying(true);
    setSpeakerMessage(
      "Playing a longer speaker sample. Adjust your volume until it sounds comfortable.",
    );
    try {
      if (
        "speechSynthesis" in window &&
        typeof SpeechSynthesisUtterance !== "undefined"
      ) {
        const utterance = new SpeechSynthesisUtterance(SPEAKER_SAMPLE);
        utterance.lang = "en-US";
        utterance.rate = 0.95;
        speakerUtterance.current = utterance;
        utterance.onend = () => {
          speakerUtterance.current = null;
          setSpeakerPlaying(false);
          setSpeakerMessage(
            "Speaker sample finished. You can play it again to adjust the volume.",
          );
        };
        utterance.onerror = () => {
          speakerUtterance.current = null;
          setSpeakerPlaying(false);
          setSpeakerMessage(
            "The speaker sample could not play. Check your output device and try again.",
          );
        };
        window.speechSynthesis.speak(utterance);
        return;
      }
      // Keep a multi-second fallback for browsers without speech synthesis.
      const ctx = new AudioContext();
      speakerContext.current = ctx;
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      gain.gain.value = 0.06;
      [330, 440, 523, 440, 330, 392].forEach((frequency, index) =>
        oscillator.frequency.setValueAtTime(
          frequency,
          ctx.currentTime + index * 0.75,
        ),
      );
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      void ctx.resume();
      oscillator.start();
      oscillator.stop(ctx.currentTime + 4.5);
      oscillator.onended = () => {
        void ctx.close().catch(() => {});
        if (speakerContext.current !== ctx) return;
        speakerContext.current = null;
        setSpeakerPlaying(false);
        setSpeakerMessage(
          "Speaker sample finished. You can play it again to adjust the volume.",
        );
      };
    } catch {
      stopSpeaker();
      setSpeakerPlaying(false);
      setSpeakerMessage(
        "The speaker sample could not play. Check your output device and try again.",
      );
    }
  }

  return (
    <div className="space-y-4">
      {mode === "text" ? (
        <div className="notice">
          <strong>Text is ready.</strong>
          <p className="mt-1 text-sm">
            Read your interviewer’s questions and type your answers. No
            microphone is needed.
          </p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="ghost"
              onClick={() => void check()}
              disabled={phase !== "idle"}
            >
              {phase === "permission"
                ? "Waiting for permission…"
                : phase === "recording"
                  ? "Recording your voice…"
                  : phase === "playback"
                    ? "Playing your recording…"
                    : mic
                      ? "Check microphone again"
                      : "Check microphone"}
            </Button>
            {phase === "recording" && (
              <Button
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
              <Button
                variant="ghost"
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
          {message && (
            <p role="status" className="text-sm text-[var(--color-muted)]">
              {message}
            </p>
          )}
          {phase === "recording" && inputDetected && (
            <p className="text-xs text-[var(--color-muted)]">
              Microphone is working — input detected.
            </p>
          )}
          {recordingUrl && (
            <div className="space-y-2">
              <audio
                ref={player}
                src={recordingUrl}
                controls
                aria-label="Your microphone test recording"
                className="w-full"
                onPlay={() => setPhase("playback")}
                onPause={() => setPhase("idle")}
                onEnded={() => {
                  setPhase("idle");
                  setMessage(
                    "Microphone check complete. Replay your recording or start your interview.",
                  );
                }}
              />
              <p className="text-xs text-[var(--color-muted)]">
                This test recording stays in your browser and is discarded when
                you leave.
              </p>
            </div>
          )}
          {devices.length > 0 && (
            <label className="block text-sm">
              Microphone
              <select
                value={device}
                onChange={(event) => {
                  setDevice(event.target.value);
                  onDevice(event.target.value);
                  void check(event.target.value);
                }}
                className="field-select mt-2"
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
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="ghost"
              onClick={speakerTest}
              disabled={
                speakerPlaying ||
                phase === "permission" ||
                phase === "recording"
              }
            >
              Play speaker test
            </Button>
            {speakerPlaying && (
              <Button
                variant="ghost"
                onClick={() => {
                  stopSpeaker();
                  setSpeakerPlaying(false);
                  setSpeakerMessage("Speaker test stopped.");
                }}
              >
                Stop speaker test
              </Button>
            )}
          </div>
          {speakerMessage && (
            <p role="status" className="text-sm text-[var(--color-muted)]">
              {speakerMessage}
            </p>
          )}
        </>
      )}
      {onCamera && (
        <div className="space-y-3 border-t border-[var(--color-line)] pt-4">
          <label className="flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={camera}
              onChange={(event) => onCamera(event.target.checked)}
              className="h-4 w-4 shrink-0"
            />
            Start with camera self-view on
          </label>
          <p className="text-xs text-[var(--color-muted)]">
            Your camera preview is visible only to you.
          </p>
          {camera && (
            <div className="max-w-64">
              <Webcam />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
