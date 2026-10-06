import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DeviceCheck } from "../components/studio/DeviceCheck";

let root: Root | undefined;
let inputLevel: number;
let contexts: FakeAudioContext[];
let recordings: FakeMediaRecorder[];

class FakeMediaRecorder {
  state: RecordingState = "inactive";
  mimeType = "audio/webm";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  start = vi.fn(() => {
    this.state = "recording";
  });
  stop = vi.fn(() => {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["the candidate’s own voice"]) });
    this.onstop?.();
  });
  constructor() {
    recordings.push(this);
  }
}

class FakeAudioContext {
  state = "suspended";
  resume = vi.fn(async () => {
    this.state = "running";
  });
  close = vi.fn(async () => {});
  currentTime = 0;
  destination = {};
  createOscillator = vi.fn(() => ({
    type: "sine",
    frequency: { setValueAtTime: vi.fn() },
    connect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    onended: null,
  }));
  createGain = vi.fn(() => ({
    gain: {
      setValueAtTime: vi.fn(),
      linearRampToValueAtTime: vi.fn(),
      exponentialRampToValueAtTime: vi.fn(),
    },
    connect: vi.fn(),
  }));
  createMediaStreamSource = vi.fn(() => ({ connect: vi.fn() }));
  createAnalyser = vi.fn(() => ({
    fftSize: 256,
    getFloatTimeDomainData(data: Float32Array) {
      data.fill(inputLevel);
    },
  }));
  constructor() {
    contexts.push(this);
  }
}

function microphone() {
  const track = {
    readyState: "live",
    stop: vi.fn(),
    onended: null as (() => void) | null,
  };
  const stream = {
    getTracks: () => [track],
    getAudioTracks: () => [track],
  } as unknown as MediaStream;
  return { track, stream };
}

function Setup({
  mode = "voice",
  cameraOption = false,
}: {
  mode?: "voice" | "text";
  cameraOption?: boolean;
}) {
  const [ready, setReady] = useState(false);
  const [camera, setCamera] = useState(false);
  return (
    <>
      <DeviceCheck
        mode={mode}
        onReady={setReady}
        onDevice={() => {}}
        camera={camera}
        onCamera={cameraOption ? setCamera : undefined}
      />
      <button disabled={!ready}>Start interview</button>
    </>
  );
}

function button(label: string) {
  const found = Array.from(document.querySelectorAll("button")).find(
    (element) => element.textContent === label,
  );
  if (!found) throw new Error("Missing button: " + label);
  return found;
}

async function render(mode: "voice" | "text" = "voice") {
  root = createRoot(document.querySelector("#device-check-test")!);
  await act(async () => root!.render(<Setup mode={mode} />));
}

async function click(label: string) {
  await act(async () => button(label).click());
}

beforeEach(() => {
  inputLevel = 0.03;
  contexts = [];
  recordings = [];
  vi.useFakeTimers();
  vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = vi.fn(() => "blob:microphone-test");
      static revokeObjectURL = vi.fn();
    },
  );
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("AudioContext", FakeAudioContext);
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn(() => 1),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  document.body.innerHTML = '<div id="device-check-test"></div>';
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: vi.fn().mockResolvedValue(microphone().stream),
      enumerateDevices: vi.fn().mockResolvedValue([]),
    },
  });
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("interview microphone readiness", () => {
  it("accepts a moving microphone meter without requiring a speaker test", async () => {
    inputLevel = 0;
    await render();
    expect(button("Start interview").disabled).toBe(true);
    await click("Check microphone");
    inputLevel = 0.03;
    await act(async () => {
      vi.mocked(requestAnimationFrame).mock.calls.at(-1)![0](performance.now());
    });
    expect(document.querySelector("meter")!.value).toBeGreaterThan(0);
    expect(document.body.textContent).toContain("Verified · sound detected");
    expect(button("Start interview").disabled).toBe(false);
    expect(button("Play speaker test")).toBeDefined();
    expect(document.querySelector('input[type="checkbox"]')).toBeNull();
  });

  it("resumes browser audio and allows a connected quiet microphone", async () => {
    inputLevel = 0;
    await render();
    await click("Check microphone");
    expect(contexts[0].resume).toHaveBeenCalledOnce();
    expect(document.querySelector("meter")!.value).toBe(0);
    expect(document.body.textContent).toContain("Connected · quiet");
    expect(document.body.textContent).not.toContain(
      "Verified · sound detected",
    );
    expect(document.body.textContent).toContain(
      "Microphone connected and ready",
    );
    expect(button("Start interview").disabled).toBe(false);
  });

  it("keeps a working microphone ready if listing devices fails", async () => {
    vi.mocked(navigator.mediaDevices.enumerateDevices).mockRejectedValue(
      new Error("Device labels unavailable"),
    );
    await render();
    await click("Check microphone");
    expect(button("Start interview").disabled).toBe(false);
    expect(document.body.textContent).not.toContain("Microphone unavailable");
  });

  it("keeps voice disabled when microphone permission is denied", async () => {
    vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValue(
      new DOMException("Permission denied", "NotAllowedError"),
    );
    await render();
    await click("Check microphone");
    expect(button("Start interview").disabled).toBe(true);
    expect(button("Check microphone").disabled).toBe(false);
    expect(document.body.textContent).toContain("Microphone unavailable");
  });

  it("revokes readiness and releases resources when the microphone disconnects", async () => {
    const mic = microphone();
    vi.mocked(navigator.mediaDevices.getUserMedia).mockResolvedValue(
      mic.stream,
    );
    await render();
    await click("Check microphone");
    await act(async () => mic.track.onended?.());
    expect(button("Start interview").disabled).toBe(true);
    expect(mic.track.stop).toHaveBeenCalledOnce();
    expect(contexts[0].close).toHaveBeenCalledOnce();
    expect(document.querySelector("meter")!.value).toBe(0);
    expect(document.body.textContent).toContain("Microphone disconnected");
  });

  it("resets readiness when a new microphone check fails", async () => {
    const mic = microphone();
    vi.mocked(navigator.mediaDevices.getUserMedia)
      .mockResolvedValueOnce(mic.stream)
      .mockRejectedValueOnce(new Error("Microphone unavailable"));
    await render();
    await click("Check microphone");
    await click("Stop & play back");
    await act(async () =>
      document.querySelector("audio")!.dispatchEvent(new Event("ended")),
    );
    await click("Check microphone again");
    expect(button("Start interview").disabled).toBe(true);
    expect(mic.track.stop).toHaveBeenCalledOnce();
    expect(contexts[0].close).toHaveBeenCalledOnce();
    expect(document.body.textContent).not.toContain(
      "Verified · sound detected",
    );
  });

  it("releases microphone permission granted after cancellation", async () => {
    const mic = microphone();
    let grant!: (stream: MediaStream) => void;
    vi.mocked(navigator.mediaDevices.getUserMedia).mockImplementation(
      () =>
        new Promise((resolve) => {
          grant = resolve;
        }),
    );
    await render();
    await click("Check microphone");
    await click("Cancel check");
    await act(async () => grant(mic.stream));
    expect(mic.track.stop).toHaveBeenCalledOnce();
    expect(button("Start interview").disabled).toBe(true);
    expect(document.body.textContent).toContain("Microphone check cancelled");
    expect(contexts[0].close).toHaveBeenCalledOnce();
  });

  it("ignores a stale permission failure after a successful retry", async () => {
    let deny!: (reason: Error) => void;
    const mic = microphone();
    vi.mocked(navigator.mediaDevices.getUserMedia)
      .mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            deny = reject;
          }),
      )
      .mockResolvedValueOnce(mic.stream);
    await render();
    await click("Check microphone");
    await click("Cancel check");
    await click("Check microphone");
    await act(async () => deny(new Error("Cancelled permission request")));
    expect(button("Start interview").disabled).toBe(false);
    expect(mic.track.stop).not.toHaveBeenCalled();
    expect(contexts[1].close).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Verified · sound detected");
  });

  it("allows text interviews without microphone permission", async () => {
    await render("text");
    expect(button("Start interview").disabled).toBe(false);
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
  });

  it("releases the microphone and audio context when leaving setup", async () => {
    const mic = microphone();
    vi.mocked(navigator.mediaDevices.getUserMedia).mockResolvedValue(
      mic.stream,
    );
    await render();
    await click("Check microphone");
    await act(async () => root!.unmount());
    root = undefined;
    expect(mic.track.stop).toHaveBeenCalledOnce();
    expect(contexts[0].close).toHaveBeenCalledOnce();
    expect(cancelAnimationFrame).toHaveBeenCalled();
  });
  it("records a short local clip and plays back the candidate’s own voice", async () => {
    const mic = microphone();
    vi.mocked(navigator.mediaDevices.getUserMedia).mockResolvedValue(
      mic.stream,
    );
    await render();
    await click("Check microphone");
    expect(recordings[0].start).toHaveBeenCalledOnce();
    expect(button("Cancel check")).toBeDefined();
    await act(async () => vi.advanceTimersByTime(5000));
    const player = document.querySelector("audio")!;
    expect(player.getAttribute("src")).toBe("blob:microphone-test");
    expect(player.controls).toBe(true);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledOnce();
    expect(mic.track.stop).toHaveBeenCalledOnce();
    expect(contexts[0].close).toHaveBeenCalledOnce();
    expect(document.body.textContent).toContain(
      "Listen back to what you just said",
    );
    expect(button("Start interview").disabled).toBe(false);
    await act(async () => player.dispatchEvent(new Event("ended")));
    expect(button("Check microphone again").disabled).toBe(false);
  });

  it("allows an early playback and cancels either recording or playback", async () => {
    await render();
    await click("Check microphone");
    await click("Cancel check");
    expect(recordings[0].stop).toHaveBeenCalledOnce();
    expect(document.querySelector("audio")).toBeNull();
    await act(async () => vi.advanceTimersByTime(5000));
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    await click("Check microphone");
    await click("Stop & play back");
    expect(document.querySelector("audio")).not.toBeNull();
    await click("Cancel check");
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:microphone-test");
    expect(document.querySelector("audio")).toBeNull();
  });

  it("keeps playback controls when autoplay is blocked", async () => {
    vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValue(
      new Error("User gesture required"),
    );
    await render();
    await click("Check microphone");
    await click("Stop & play back");
    expect(document.body.textContent).toContain("Press play below");
    expect(document.querySelector("audio")!.controls).toBe(true);
    expect(button("Check microphone again").disabled).toBe(false);
  });

  it("discards the local recording when leaving setup", async () => {
    await render();
    await click("Check microphone");
    await click("Stop & play back");
    await act(async () => root!.unmount());
    root = undefined;
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:microphone-test");
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
  });

  it("plays a spoken sentence and allows the speaker sample to stop", async () => {
    const speak = vi.fn();
    const cancel = vi.fn();
    class Utterance {
      constructor(public text: string) {}
      onend = null;
      onerror = null;
    }
    vi.stubGlobal("speechSynthesis", {
      speak,
      cancel,
      getVoices: () => [{ name: "Samantha", lang: "en-US", default: false }],
    });
    vi.stubGlobal("SpeechSynthesisUtterance", Utterance);
    await render();
    await click("Play speaker test");
    expect(speak).toHaveBeenCalledOnce();
    expect(speak.mock.calls[0][0].text).toContain(
      "Welcome to your practice interview",
    );
    expect(speak.mock.calls[0][0].text.split(" ").length).toBeGreaterThan(20);
    await click("Stop speaker test");
    expect(cancel).toHaveBeenCalledOnce();
    expect(button("Play speaker test").disabled).toBe(false);
  });

  it("requests camera access only after the setup self-view is selected", async () => {
    const track = { readyState: "live", stop: vi.fn(), onended: null };
    vi.mocked(navigator.mediaDevices.getUserMedia).mockResolvedValue({
      getTracks: () => [track],
      getVideoTracks: () => [track],
    } as unknown as MediaStream);
    root = createRoot(document.querySelector("#device-check-test")!);
    await act(async () => root!.render(<Setup mode="text" cameraOption />));
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
    await act(async () =>
      (
        document.querySelector('input[type="checkbox"]') as HTMLInputElement
      ).click(),
    );
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({
      video: { width: 480, height: 360 },
      audio: false,
    });
    expect(document.querySelector("video")).not.toBeNull();
    expect(document.body.textContent).toContain("Verified · preview ready");
    expect(button("Start interview").disabled).toBe(false);
  });
  it("never marks a speaker verified until the user confirms hearing it", async () => {
    vi.stubGlobal("speechSynthesis", {
      speak: vi.fn(),
      cancel: vi.fn(),
      getVoices: () => [{ name: "Samantha", lang: "en-US" }],
    });
    vi.stubGlobal(
      "SpeechSynthesisUtterance",
      class {
        constructor(public text: string) {}
      },
    );
    await render();
    await click("Play speaker test");
    expect(document.body.textContent).not.toContain("Verified by you");
    await click("I heard it");
    expect(document.body.textContent).toContain("Verified by you");
    expect(button("Start interview").disabled).toBe(true);
  });

  it("uses a soft chime when no natural voice is available", async () => {
    const speak = vi.fn();
    vi.stubGlobal("speechSynthesis", {
      speak,
      cancel: vi.fn(),
      getVoices: () => [],
    });
    vi.stubGlobal("SpeechSynthesisUtterance", class {});
    await render();
    await click("Play speaker test");
    expect(speak).not.toHaveBeenCalled();
    expect(contexts[0].createOscillator).toHaveBeenCalledOnce();
    expect(contexts[0].resume).toHaveBeenCalledOnce();
    expect(document.body.textContent).toContain("three soft notes");
    await click("Stop speaker test");
    expect(contexts[0].close).toHaveBeenCalledOnce();
  });

  it("keeps text ready when optional camera permission is denied", async () => {
    vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValue(
      new DOMException("Denied", "NotAllowedError"),
    );
    root = createRoot(document.querySelector("#device-check-test")!);
    await act(async () => root!.render(<Setup mode="text" cameraOption />));
    await act(async () =>
      (
        document.querySelector('input[type="checkbox"]') as HTMLInputElement
      ).click(),
    );
    expect(document.body.textContent).toContain("Unavailable · optional");
    expect(button("Start interview").disabled).toBe(false);
  });
  it.each([0, 0.03])(
    "labels the completed mic test as historical verification (level=%s)",
    async (level) => {
      inputLevel = level;
      const mic = microphone();
      vi.mocked(navigator.mediaDevices.getUserMedia).mockResolvedValue(
        mic.stream,
      );
      await render();
      await click("Check microphone");
      await act(async () => vi.advanceTimersByTime(5000));
      expect(mic.track.stop).toHaveBeenCalledOnce();
      expect(document.body.textContent).not.toContain("Connected · quiet");
      expect(document.body.textContent).not.toContain(
        "Speak a few words to check your input level",
      );
      expect(document.body.textContent).toContain(
        level
          ? "Verified · microphone test"
          : "Permission checked · no sound detected",
      );
      expect(document.body.textContent).toContain(
        level
          ? "reconnect it when your interview starts"
          : "Check your mute switch and test again",
      );
      expect(button("Start interview").disabled).toBe(false);
    },
  );
});
