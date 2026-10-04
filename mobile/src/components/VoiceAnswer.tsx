import { useEffect, useRef, useState } from "react";
import {
  AppState,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import { Directory, File, Paths } from "expo-file-system";

export interface VoiceAnswerProps {
  uri?: string;
  durationSeconds?: number;
  onRecorded: (uri: string, durationSeconds: number) => void | Promise<void>;
  onRemove: () => void | Promise<void>;
  onBusyChange?: (busy: boolean) => void;
  disabled?: boolean;
}

const LIMIT = 90;
const formatTime = (seconds: number) => {
  const value = Math.max(0, Math.floor(seconds || 0));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
};
const recordingsDirectory = () =>
  new Directory(Paths.document, "voice-answers");

/** Delete only this companion's own recordings, never an arbitrary file URI. */
export async function removeRecording(uri: string): Promise<void> {
  const directory = recordingsDirectory();
  if (!uri.startsWith(`${directory.uri.replace(/\/$/, "")}/`)) return;
  const file = new File(uri);
  if (file.exists) file.delete();
}

function discardTemporary(uri: string | null) {
  if (!uri || !uri.startsWith(Paths.cache.uri)) return;
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // The operating system also owns cleanup of the temporary cache.
  }
}

function Action({
  label,
  icon,
  onPress,
  disabled = false,
  primary = false,
}: {
  label: string;
  icon: React.ComponentProps<typeof Feather>["name"];
  onPress: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        primary && styles.primary,
        { opacity: disabled ? 0.45 : pressed ? 0.7 : 1 },
      ]}
    >
      <Feather name={icon} size={19} color={primary ? "#fff" : "#2d6445"} />
      <Text style={[styles.actionText, primary && styles.primaryText]}>
        {label}
      </Text>
    </Pressable>
  );
}

export function AudioPlayback({
  uri,
  durationSeconds,
}: {
  uri: string;
  durationSeconds?: number;
}) {
  let exists = false;
  try {
    exists = new File(uri).exists;
  } catch {
    /* Invalid or unavailable local file. */
  }
  if (!exists)
    return (
      <Text accessibilityRole="alert" style={styles.error}>
        This recording is no longer on this device. Any saved text is still
        available.
      </Text>
    );
  return (
    <LocalPlayback key={uri} uri={uri} durationSeconds={durationSeconds} />
  );
}

function LocalPlayback({
  uri,
  durationSeconds,
}: {
  uri: string;
  durationSeconds?: number;
}) {
  const player = useAudioPlayer(uri, { updateInterval: 250 });
  const status = useAudioPlayerStatus(player);
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false);
  const mounted = useRef(true);
  const failure =
    error || (status.error ? "This recording could not play. Try again." : "");

  useEffect(() => {
    mounted.current = true;
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") {
        try {
          player.pause();
        } catch {
          /* Player may already be released. */
        }
      }
    });
    return () => {
      mounted.current = false;
      subscription.remove();
      try {
        player.pause();
      } catch {
        /* The hook also releases the player. */
      }
    };
  }, [player]);

  async function toggle() {
    if (starting) return;
    setStarting(true);
    setError("");
    try {
      if (status.playing) {
        player.pause();
        return;
      }
      if (failure) player.replace(uri);
      await setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
        shouldPlayInBackground: false,
      });
      if (!mounted.current || AppState.currentState !== "active") return;
      if (
        status.didJustFinish ||
        (status.duration > 0 && status.currentTime >= status.duration - 0.1)
      )
        await player.seekTo(0);
      if (mounted.current) player.play();
    } catch {
      if (mounted.current)
        setError("This recording could not play. Try again.");
    } finally {
      if (mounted.current) setStarting(false);
    }
  }

  return (
    <View style={styles.playback}>
      <View style={styles.row}>
        <Action
          icon={status.playing ? "pause" : failure ? "rotate-cw" : "play"}
          label={
            status.playing
              ? "Pause answer"
              : failure
                ? "Retry playback"
                : "Play answer"
          }
          onPress={() => void toggle()}
          disabled={starting || (!status.isLoaded && !failure)}
        />
        <Text style={styles.time}>
          {formatTime(status.currentTime)} /{" "}
          {formatTime(status.duration || durationSeconds || 0)}
        </Text>
      </View>
      {!status.isLoaded && !failure && (
        <Text style={styles.note}>Loading your recording…</Text>
      )}
      {!!failure && (
        <Text accessibilityRole="alert" style={styles.error}>
          {failure}
        </Text>
      )}
    </View>
  );
}

type Phase = "idle" | "starting" | "recording" | "saving";

export function VoiceAnswer(props: VoiceAnswerProps) {
  const currentProps = useRef(props);
  currentProps.current = props;
  const mounted = useRef(true);
  const phaseRef = useRef<Phase>("idle");
  const getPhase = (): Phase => phaseRef.current;
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");
  const [needsSettings, setNeedsSettings] = useState(false);
  const [retryPending, setRetryPending] = useState(false);
  const pending = useRef<{ uri: string; seconds: number } | null>(null);
  const startedAt = useRef(0);
  const finishRef = useRef<(completedUri?: string | null) => Promise<void>>(
    async () => {},
  );
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY, (status) => {
    if (!mounted.current || phaseRef.current !== "recording") return;
    if (status.hasError || status.mediaServicesDidReset) {
      setError(
        "Recording was interrupted. Review any saved audio, or record your answer again.",
      );
      void finishRef.current(status.isFinished ? status.url : undefined);
    } else if (status.isFinished) {
      void finishRef.current(status.url);
    }
  });
  const recorderState = useAudioRecorderState(recorder, 250);

  function updatePhase(next: Phase) {
    phaseRef.current = next;
    if (!mounted.current) return;
    setPhase(next);
    currentProps.current.onBusyChange?.(next !== "idle");
  }

  async function savePending(keepBusy = false) {
    const recording = pending.current;
    if (!recording || !mounted.current) return;
    updatePhase("saving");
    let destination: File | null = null;
    try {
      const directory = recordingsDirectory();
      directory.create({ idempotent: true, intermediates: true });
      destination = new File(
        directory,
        `answer-${Date.now()}-${Math.random().toString(36).slice(2, 10)}.m4a`,
      );
      const source = new File(recording.uri);
      if (!source.exists || source.size === 0)
        throw new Error("empty recording");
      source.copy(destination);
      const previous = currentProps.current.uri;
      await currentProps.current.onRecorded(
        destination.uri,
        Math.min(LIMIT, Math.round(recording.seconds)),
      );
      pending.current = null;
      if (mounted.current) setRetryPending(false);
      discardTemporary(recording.uri);
      if (previous && previous !== destination.uri) {
        try {
          await removeRecording(previous);
        } catch {
          /* New answer has already been saved. */
        }
      }
    } catch {
      if (destination?.exists) {
        try {
          destination.delete();
        } catch {
          /* Retry keeps the source. */
        }
      }
      if (mounted.current) {
        setRetryPending(true);
        setError(
          "Your recording could not be saved. Free some device storage and retry, or record again.",
        );
      }
    } finally {
      if (mounted.current && !keepBusy) updatePhase("idle");
    }
  }

  async function finish(completedUri?: string | null) {
    if (phaseRef.current !== "recording") return;
    updatePhase("saving");
    try {
      const beforeStop = recorder.getStatus();
      const seconds = Math.max(
        beforeStop.durationMillis / 1000,
        (Date.now() - startedAt.current) / 1000,
      );
      if (completedUri === undefined) await recorder.stop();
      const uri = completedUri || recorder.uri;
      if (!mounted.current) {
        discardTemporary(uri);
        return;
      }
      if (!uri || seconds < 0.5) {
        discardTemporary(uri);
        throw new Error("no audio");
      }
      pending.current = { uri, seconds };
      await savePending(true);
    } catch {
      if (mounted.current)
        setError(
          "No usable audio was saved. Try recording for at least a second, or type your answer.",
        );
    } finally {
      await setAudioModeAsync({
        allowsRecording: false,
        shouldPlayInBackground: false,
      }).catch(() => {});
      if (mounted.current && getPhase() === "saving") updatePhase("idle");
    }
  }
  finishRef.current = finish;

  useEffect(() => {
    mounted.current = true;
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active" && phaseRef.current === "recording")
        void finishRef.current();
    });
    return () => {
      mounted.current = false;
      subscription.remove();
      currentProps.current.onBusyChange?.(false);
      discardTemporary(pending.current?.uri ?? null);
      pending.current = null;
      // useAudioRecorder releases its native object on unmount as well. Stop
      // explicitly for an in-flight recording; a released object is harmless.
      try {
        const temporaryUri = recorder.uri;
        void recorder
          .stop()
          .catch(() => {})
          .finally(() => {
            discardTemporary(temporaryUri);
            void setAudioModeAsync({
              allowsRecording: false,
              shouldPlayInBackground: false,
            }).catch(() => {});
          });
      } catch {
        /* Hook cleanup may have released it first. */
      }
    };
  }, [recorder]);

  useEffect(() => {
    if (phase !== "recording" || recorderState.durationMillis < LIMIT * 1000)
      return;
    void finishRef.current();
  }, [phase, recorderState.durationMillis]);

  async function start() {
    if (phaseRef.current !== "idle" || currentProps.current.disabled) return;
    updatePhase("starting");
    setError("");
    setNeedsSettings(false);
    try {
      const permission = await AudioModule.requestRecordingPermissionsAsync();
      if (!mounted.current) return;
      if (!permission.granted) {
        setNeedsSettings(!permission.canAskAgain);
        setError(
          "Microphone access is off. Enable it to record, or type your answer instead.",
        );
        return;
      }
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
        shouldPlayInBackground: false,
        allowsBackgroundRecording: false,
      });
      if (!mounted.current || AppState.currentState !== "active") return;
      await recorder.prepareToRecordAsync();
      if (!mounted.current || AppState.currentState !== "active") {
        await recorder.stop().catch(() => {});
        return;
      }
      discardTemporary(pending.current?.uri ?? null);
      pending.current = null;
      setRetryPending(false);
      startedAt.current = Date.now();
      recorder.record({ forDuration: LIMIT });
      updatePhase("recording");
    } catch {
      if (mounted.current)
        setError(
          "The microphone could not start. Close other recording apps and retry, or type your answer.",
        );
    } finally {
      if (getPhase() === "starting") {
        await setAudioModeAsync({
          allowsRecording: false,
          shouldPlayInBackground: false,
        }).catch(() => {});
        if (mounted.current) updatePhase("idle");
      }
    }
  }

  async function remove() {
    if (!props.uri || phaseRef.current !== "idle" || props.disabled) return;
    updatePhase("saving");
    setError("");
    try {
      await currentProps.current.onRemove();
      await removeRecording(props.uri);
    } catch {
      if (mounted.current)
        setError("The recording could not be removed. Please try again.");
    } finally {
      if (mounted.current) updatePhase("idle");
    }
  }

  return (
    <View style={styles.container}>
      {props.uri && phase === "idle" && (
        <AudioPlayback
          uri={props.uri}
          durationSeconds={props.durationSeconds}
        />
      )}
      {phase === "recording" ? (
        <View style={styles.row}>
          <Action
            primary
            icon="square"
            label="Stop recording"
            onPress={() => void finish()}
          />
          <Text style={styles.time}>
            {formatTime(Math.min(LIMIT, recorderState.durationMillis / 1000))} /
            1:30
          </Text>
        </View>
      ) : (
        <View style={styles.row}>
          <Action
            icon="mic"
            label={
              phase === "starting"
                ? "Opening microphone…"
                : phase === "saving"
                  ? "Saving recording…"
                  : props.uri
                    ? "Record again"
                    : "Record answer"
            }
            onPress={() => void start()}
            disabled={phase !== "idle" || props.disabled}
          />
          {props.uri && (
            <Action
              icon="trash-2"
              label="Remove"
              onPress={() => void remove()}
              disabled={phase !== "idle" || props.disabled}
            />
          )}
        </View>
      )}
      <Text style={styles.note}>
        {phase === "recording"
          ? "Recording on this device. Stops at 90 seconds or when you leave the app."
          : "Up to 90 seconds · saved on this device · no transcription"}
      </Text>
      {!!error && (
        <Text
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          style={styles.error}
        >
          {error}
        </Text>
      )}
      {retryPending && (
        <Action
          icon="save"
          label="Retry saving audio"
          disabled={phase !== "idle" || props.disabled}
          onPress={() => {
            setError("");
            void savePending();
          }}
        />
      )}
      {needsSettings && (
        <Action
          icon="settings"
          label="Open device settings"
          onPress={() => {
            void Linking.openSettings().catch(() =>
              setError("Open your device Settings to allow microphone access."),
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 10 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 10,
  },
  playback: {
    padding: 10,
    backgroundColor: "#edf2eb",
    borderRadius: 14,
    gap: 7,
  },
  action: {
    minHeight: 48,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 9,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 12,
    backgroundColor: "#edf2eb",
  },
  primary: { backgroundColor: "#2d6445" },
  actionText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#2d6445",
    flexShrink: 1,
  },
  primaryText: { color: "#fff" },
  time: { color: "#22372c", fontSize: 13, fontVariant: ["tabular-nums"] },
  note: { color: "#526356", fontSize: 12, lineHeight: 18 },
  error: { color: "#a13732", fontSize: 13, lineHeight: 19 },
});
