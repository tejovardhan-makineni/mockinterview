import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Webcam } from "../components/studio/Webcam";
let root: Root | undefined;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  document.body.innerHTML = '<div id="camera-test"></div>';
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: vi.fn() },
  });
});
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe("camera preview cleanup", () => {
  it("releases camera tracks immediately when preview playback fails", async () => {
    const stop = vi.fn();
    vi.mocked(navigator.mediaDevices.getUserMedia).mockResolvedValue({
      getTracks: () => [{ stop }],
    } as unknown as MediaStream);
    vi.spyOn(HTMLMediaElement.prototype, "play").mockRejectedValue(
      new Error("playback unavailable"),
    );
    root = createRoot(document.querySelector("#camera-test")!);
    await act(async () => root!.render(<Webcam />));
    expect(stop).toHaveBeenCalledOnce();
    expect(document.body.textContent).toContain("Camera unavailable");
  });
  it("releases a permission grant that arrives after the camera was closed", async () => {
    let grant!: (stream: MediaStream) => void;
    const stop = vi.fn();
    vi.mocked(navigator.mediaDevices.getUserMedia).mockImplementation(
      () =>
        new Promise((resolve) => {
          grant = resolve;
        }),
    );
    root = createRoot(document.querySelector("#camera-test")!);
    await act(async () => root!.render(<Webcam />));
    await act(async () => root!.unmount());
    root = undefined;
    grant({ getTracks: () => [{ stop }] } as unknown as MediaStream);
    await Promise.resolve();
    expect(stop).toHaveBeenCalledOnce();
  });
});
