import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceSaver, readWorkspaceDraft } from "./workspaceSave";
import type { WorkspaceSnapshot } from "./features/interview";
const initial: WorkspaceSnapshot = { kind: "code", content: "", revision: 4 };
beforeEach(() => {
  vi.useFakeTimers();
  sessionStorage.clear();
});
afterEach(() => vi.useRealTimers());
describe("workspace finish durability", () => {
  it("serializes edits made while a save is in flight and waits for the latest", async () => {
    const writes: WorkspaceSnapshot[] = [];
    let release!: () => void;
    const writer = new WorkspaceSaver(
      initial,
      async (snapshot) => {
        writes.push(snapshot);
        if (writes.length === 1)
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        return snapshot;
      },
      vi.fn(),
      "draft",
    );
    writer.update({ ...initial, content: "first" });
    const finish = writer.flush();
    writer.update({
      ...initial,
      content: "final exact\n  indentation",
      data: { language: "go" },
    });
    expect(writes).toHaveLength(1);
    release();
    await finish;
    expect(writes.map((w) => [w.content, w.revision])).toEqual([
      ["first", 5],
      ["final exact\n  indentation", 6],
    ]);
    expect(writes[1].data).toEqual({ language: "go" });
    expect(readWorkspaceDraft("draft")).toBeNull();
  });
  it("keeps the draft and same revision after a failed save, then retries", async () => {
    const write = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockImplementation(async (snapshot) => snapshot);
    const writer = new WorkspaceSaver(initial, write, vi.fn(), "draft");
    writer.update({
      ...initial,
      content: "do not lose me",
      data: { elements: [{ id: "box", x: 15 }] },
    });
    await expect(writer.flush()).rejects.toThrow("offline");
    expect(readWorkspaceDraft("draft")?.data).toEqual({
      elements: [{ id: "box", x: 15 }],
    });
    await writer.flush();
    expect(write.mock.calls.map((call) => call[0].revision)).toEqual([5, 5]);
    expect(readWorkspaceDraft("draft")).toBeNull();
  });
  it("preserves a pending draft on navigation and cancels delayed requests", async () => {
    const write = vi.fn();
    const writer = new WorkspaceSaver(initial, write, vi.fn(), "draft");
    writer.update({ ...initial, content: "resume this" });
    writer.dispose();
    await vi.advanceTimersByTimeAsync(1000);
    expect(write).not.toHaveBeenCalled();
    expect(readWorkspaceDraft("draft")?.content).toBe("resume this");
  });
});
