import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AvatarDrive } from "../components/studio/Avatar3D";
import { previewVoiceSample, stopPreview } from "./voicePreview";

vi.mock("./api", () => ({
  api: { voicePreview: vi.fn().mockResolvedValue(null) },
}));

let utterance: FakeUtterance;
const drive = {
  current: {
    speaking: false,
    amplitude: 0,
    level: 0,
    mood: "idle",
  } as AvatarDrive,
};

class FakeUtterance {
  onstart?: () => void;
  onend?: () => void;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
  vi.stubGlobal("speechSynthesis", {
    cancel: vi.fn(),
    getVoices: () => [],
    speak: (value: FakeUtterance) => {
      utterance = value;
      utterance.onstart?.();
    },
  });
  drive.current = { speaking: false, amplitude: 0, level: 0, mood: "idle" };
});

afterEach(() => {
  stopPreview(drive);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it.each(["finished", "stopped"])(
  "animates browser voice previews after a previous zero level and closes when %s",
  async (ending) => {
    await previewVoiceSample(
      {
        voiceId: "puck",
        faceId: "alex",
        personality: "supportive",
        intensity: 3,
      },
      drive,
    );
    expect(drive.current.speaking).toBe(true);
    await vi.advanceTimersByTimeAsync(120);
    expect(drive.current.level).toBeGreaterThan(0);
    expect(drive.current.level).toBe(drive.current.amplitude);
    if (ending === "finished") utterance.onend?.();
    else stopPreview(drive);
    await vi.advanceTimersByTimeAsync(120);
    expect(drive.current.speaking).toBe(false);
    expect(drive.current.amplitude).toBe(0);
    expect(drive.current.level).toBe(0);
  },
);
