import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DeviceCheck } from "../components/studio/DeviceCheck";

let root: Root | undefined;
let inputLevel: number;
let contexts: FakeAudioContext[];

class FakeAudioContext {
  state = "suspended";
  resume = vi.fn(async () => {
    this.state = "running";
  });
  close = vi.fn(async () => {});
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

function Setup({ mode = "voice" }: { mode?: "voice" | "text" }) {
  const [ready, setReady] = useState(false);
  return (
    <>
      <DeviceCheck mode={mode} onReady={setReady} onDevice={() => {}} />
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
    expect(document.querySelector('[role="status"]')!.textContent).toContain(
      "Microphone is working — input detected",
    );
    expect(button("Start interview").disabled).toBe(false);
    expect(button("Play speaker test (optional)")).toBeDefined();
    expect(document.querySelector('input[type="checkbox"]')).toBeNull();
  });

  it("resumes browser audio and allows a connected quiet microphone", async () => {
    inputLevel = 0;
    await render();
    await click("Check microphone");
    expect(contexts[0].resume).toHaveBeenCalledOnce();
    expect(document.querySelector("meter")!.value).toBe(0);
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
    await click("Check microphone again");
    expect(button("Start interview").disabled).toBe(true);
    expect(mic.track.stop).toHaveBeenCalledOnce();
    expect(contexts[0].close).toHaveBeenCalledOnce();
    expect(document.body.textContent).not.toContain("Microphone is working");
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
    expect(document.body.textContent).toContain("Permission check cancelled");
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
    expect(document.body.textContent).toContain("Microphone is working");
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
});
