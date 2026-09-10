import type { WorkspaceSnapshot } from "./features/interview";

// One writer per editor. Acknowledgement advances the revision only after the
// server has committed the full artifact. Finish awaits flush, including edits
// made while a previous save was in flight.
export class WorkspaceSaver {
  private revision: number;
  private pending?: WorkspaceSnapshot;
  private saving?: Promise<void>;
  private timer?: ReturnType<typeof setTimeout>;
  private disposed = false;
  constructor(
    initial: WorkspaceSnapshot,
    private write: (
      snapshot: WorkspaceSnapshot,
    ) => Promise<WorkspaceSnapshot | void>,
    private state: (
      state: "saved" | "saving" | "unsaved",
      error?: unknown,
    ) => void,
    private draftKey?: string,
  ) {
    this.revision = initial.revision || 0;
  }
  update(snapshot: WorkspaceSnapshot) {
    if (this.disposed) return;
    this.pending = snapshot;
    if (this.draftKey) {
      try {
        sessionStorage.setItem(this.draftKey, JSON.stringify(snapshot));
      } catch {}
    }
    this.state("unsaved");
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.flush().catch(() => {});
    }, 800);
  }
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    if (this.saving) {
      await this.saving;
      if (this.pending) return this.flush();
      return;
    }
    if (!this.pending) return;
    const snapshot = this.pending;
    this.pending = undefined;
    const next = { ...snapshot, revision: this.revision + 1 };
    this.state("saving");
    this.saving = (async () => {
      try {
        const result = await this.write(next);
        this.revision = result?.revision ?? next.revision;
        if (!this.pending) {
          if (this.draftKey) {
            try {
              sessionStorage.removeItem(this.draftKey);
            } catch {}
          }
          this.state("saved");
        }
      } catch (error) {
        this.pending = this.pending ?? snapshot;
        this.state("unsaved", error);
        throw error;
      } finally {
        this.saving = undefined;
      }
    })();
    await this.saving;
    if (this.pending) await this.flush();
  }
  dispose() {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
  }
}
export function readWorkspaceDraft(key: string): WorkspaceSnapshot | null {
  try {
    const data = JSON.parse(sessionStorage.getItem(key) ?? "null");
    return data &&
      typeof data.content === "string" &&
      typeof data.kind === "string"
      ? data
      : null;
  } catch {
    return null;
  }
}
