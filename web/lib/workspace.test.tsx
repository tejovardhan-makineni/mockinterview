import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { Workspace } from "../components/studio/Workspace";

vi.mock("next/dynamic", () => ({
  default: () => () => <div>Visual editor</div>,
}));
vi.mock("@excalidraw/excalidraw/index.css", () => ({}));

afterEach(() => vi.unstubAllGlobals());

describe("restoring a workspace", () => {
  it("keeps a saved text architecture in the text editor instead of replacing it with an empty canvas", () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.createElement("div");
    const root = createRoot(container);
    const onChange = vi.fn();
    act(() =>
      root.render(
        <Workspace
          modality="system_design"
          initial={{
            kind: "canvas",
            content: "Clients → API → database",
            revision: 4,
          }}
          onChange={onChange}
        />,
      ),
    );
    expect(container.querySelector("textarea")?.value).toBe(
      "Clients → API → database",
    );
    expect(container.textContent).not.toContain("Visual editor");
    expect(onChange).not.toHaveBeenCalled();
    act(() => root.unmount());
  });
});
