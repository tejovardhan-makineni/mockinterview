import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Avatar3D, type AvatarDrive } from "../components/studio/Avatar3D";

let root: Root | undefined;
let clock: number;
let reducedMotion: boolean;

async function frames(count = 1) {
  await act(async () => {
    for (let frame = 0; frame < count; frame++) {
      clock += 16;
      vi.mocked(requestAnimationFrame).mock.calls.at(-1)![0](clock);
    }
  });
}

function mouth() {
  return document.querySelector<SVGPathElement>("[data-avatar-mouth] > path")!;
}

async function render(faceId = "alex") {
  const drive = {
    current: {
      speaking: false,
      amplitude: 0,
      mood: "listening",
    } as AvatarDrive,
  };
  root = createRoot(document.querySelector("#avatar-test")!);
  await act(async () =>
    root!.render(<Avatar3D faceId={faceId} drive={drive} />),
  );
  return drive;
}

beforeEach(() => {
  clock = 1000;
  reducedMotion = false;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn(() => 1),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal("matchMedia", () => ({
    get matches() {
      return reducedMotion;
    },
  }));
  document.body.innerHTML = '<div id="avatar-test"></div>';
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("interviewer mouth motion", () => {
  it.each(["alex", "jordan", "sam"])(
    "%s opens one anchored mouth and returns to its resting smile during silence",
    async (faceId) => {
      const drive = await render(faceId);
      const closed = mouth().getAttribute("d");
      expect(
        document.querySelectorAll("[data-avatar-mouth] ellipse"),
      ).toHaveLength(0);
      drive.current = { speaking: true, amplitude: 0.8, mood: "speaking" };
      await frames(20);
      const open = mouth().getAttribute("d")!;
      expect(open).not.toBe(closed);
      // The corners and upper lip stay fixed while the bottom contour opens.
      expect(open.split("Q161 ")[0]).toBe(closed!.split("Q161 ")[0]);
      expect(open).toMatch(
        /^M148 184 Q161 188 174 184 Q161 19\d\.\d+ 148 184 Z$/,
      );
      expect(document.querySelector("clipPath path")!.getAttribute("d")).toBe(
        open,
      );
      const teeth = document.querySelector(
        "[data-avatar-mouth] > path + path",
      )!;
      expect(Number(teeth.getAttribute("opacity"))).toBeGreaterThan(0);

      // Playback remains active between words; zero audio must still close it.
      drive.current.amplitude = 0;
      await frames(20);
      expect(mouth().getAttribute("d")).toBe(closed);
      expect(teeth.getAttribute("opacity")).toBe("0");
    },
  );

  it("smooths an audio spike and closes after speech ends despite a stale audio level", async () => {
    const drive = await render();
    const closed = mouth().getAttribute("d");
    drive.current = {
      speaking: true,
      amplitude: 1,
      level: 1,
      mood: "speaking",
    };
    await frames();
    const firstFrame = mouth().getAttribute("d");
    await frames(20);
    expect(mouth().getAttribute("d")).not.toBe(firstFrame);
    drive.current.speaking = false;
    await frames(20);
    expect(mouth().getAttribute("d")).toBe(closed);
  });

  it("honors a changed reduced-motion preference while speech is active", async () => {
    const drive = await render();
    const closed = mouth().getAttribute("d");
    drive.current = { speaking: true, amplitude: 1, mood: "speaking" };
    await frames(20);
    expect(mouth().getAttribute("d")).not.toBe(closed);
    reducedMotion = true;
    await frames();
    expect(mouth().getAttribute("d")).toBe(closed);
    expect(
      mouth().parentElement!.parentElement!.getAttribute("transform"),
    ).toBe("");
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1])(
    "ignores invalid audio level %s",
    async (level) => {
      const drive = await render();
      const closed = mouth().getAttribute("d");
      drive.current = { speaking: true, amplitude: level, mood: "speaking" };
      await frames(20);
      expect(mouth().getAttribute("d")).toBe(closed);
    },
  );
});
