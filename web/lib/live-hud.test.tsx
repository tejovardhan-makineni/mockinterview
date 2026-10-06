import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LiveHUD } from "../components/studio/LiveHUD";
import type { ComponentProps } from "react";

function render(overrides: Partial<ComponentProps<typeof LiveHUD>> = {}) {
  const markup = renderToStaticMarkup(
    <LiveHUD
      micRef={{ current: 0 }}
      microphone="live"
      audio="ready"
      conn="connected"
      mode="voice"
      onReconnect={() => {}}
      onRetryMicrophone={() => {}}
      onResumeAudio={() => {}}
      {...overrides}
    />,
  );
  const node = document.createElement("div");
  node.innerHTML = markup;
  return node;
}

describe("interview health and recovery", () => {
  it("shows microphone input and connection without an unnecessary audio action", () => {
    const node = render();
    expect(node.textContent).toContain("Connected");
    expect(node.textContent).toContain("Microphone on");
    expect(node.textContent).toContain("Sound on");
    expect(
      node.querySelector('meter[aria-label="Live microphone input level"]'),
    ).not.toBeNull();
    expect(node.querySelector("button")).toBeNull();
  });

  it("explains blocked playback and offers a specific recovery action", () => {
    const node = render({ audio: "blocked" });
    expect(node.textContent).toContain("Your browser paused playback");
    expect(node.querySelector("button")?.textContent).toBe("Resume sound");
  });

  it("keeps text mode free of misleading microphone or sound controls", () => {
    const node = render({ mode: "text", microphone: "off", audio: "idle" });
    expect(node.textContent).toContain("Text interview · microphone off");
    expect(node.querySelector("meter")).toBeNull();
    expect(node.querySelector("button")).toBeNull();
  });

  it("offers microphone recovery while preserving typed-answer guidance", () => {
    const node = render({ microphone: "unavailable" });
    expect(node.textContent).toContain("You can still type an answer");
    expect(node.querySelector("button")?.textContent).toBe("Retry microphone");
  });

  it("explains automatic reconnection and exposes manual recovery only after failure", () => {
    const reconnecting = render({ conn: "reconnecting", microphone: "off" });
    expect(reconnecting.textContent).toContain("Typed answers stay queued");
    expect(reconnecting.querySelector("button")).toBeNull();
    const failed = render({ conn: "failed", microphone: "off" });
    expect(failed.querySelector("button")?.textContent).toContain(
      "Connection lost · Retry",
    );
  });
});
