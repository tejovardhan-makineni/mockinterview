"use client";
import { useState } from "react";
import dynamic from "next/dynamic";
import type { Modality } from "@/lib/types";
import type { WorkspaceSnapshot } from "@/lib/features/interview";
import "@excalidraw/excalidraw/index.css";
const Excalidraw = dynamic(
  async () => {
    (
      window as Window & { EXCALIDRAW_ASSET_PATH?: string }
    ).EXCALIDRAW_ASSET_PATH = "/vendor/excalidraw/";
    return (await import("@excalidraw/excalidraw")).Excalidraw;
  },
  {
    ssr: false,
    loading: () => (
      <p className="p-6" role="status">
        Opening whiteboard…
      </p>
    ),
  },
);
const MonacoEditor = dynamic(
  async () => {
    const editor = await import("@monaco-editor/react");
    editor.loader.config({ paths: { vs: "/vendor/monaco/vs" } });
    return editor.default;
  },
  {
    ssr: false,
    loading: () => (
      <p className="p-6" role="status">
        Opening code editor…
      </p>
    ),
  },
);
type Props = {
  modality: Modality;
  initial?: WorkspaceSnapshot;
  onChange?: (snapshot: WorkspaceSnapshot) => void;
  onContent?: (text: string) => void;
};
export function Workspace({ modality, initial, onChange, onContent }: Props) {
  const [text, setText] = useState(initial?.content ?? "");
  const [language, setLanguage] = useState(
    String(initial?.data?.language ?? "python"),
  );
  const [plain, setPlain] = useState(false);
  const update = (content: string, data?: Record<string, unknown>) => {
    setText(content);
    onContent?.(content);
    onChange?.({
      kind:
        modality === "coding"
          ? "code"
          : modality === "system_design"
            ? "canvas"
            : modality === "written"
              ? "written"
              : "note",
      content,
      revision: initial?.revision ?? 0,
      data,
    });
  };
  if (modality === "system_design" && !plain)
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between border-b border-[var(--color-line)] px-4 py-1 text-xs">
          <span>Whiteboard · diagram and connections are saved</span>
          <button onClick={() => setPlain(true)} className="underline">
            Use text description
          </button>
        </div>
        <div className="min-h-0 flex-1">
          <Excalidraw
            initialData={initial?.data as never}
            onChange={(elements, appState, files) => {
              const scene = {
                elements,
                appState: { viewBackgroundColor: appState.viewBackgroundColor },
                files,
              };
              update(
                summarizeDiagram(elements),
                scene as unknown as Record<string, unknown>,
              );
            }}
            UIOptions={{
              canvasActions: {
                loadScene: false,
                saveToActiveFile: false,
                toggleTheme: false,
              },
            }}
          />
        </div>
      </div>
    );
  if (modality === "coding" && !plain)
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between gap-4 border-b border-[var(--color-line)] px-4 py-2">
          <label className="flex items-center gap-3 text-xs">
            Language
            <select
              value={language}
              onChange={(e) => {
                setLanguage(e.target.value);
                update(text, { language: e.target.value });
              }}
              className="rounded border border-[var(--color-line)] bg-[var(--color-panel)] px-2"
            >
              {[
                "python",
                "javascript",
                "typescript",
                "go",
                "java",
                "cpp",
                "sql",
              ].map((l) => (
                <option key={l}>{l}</option>
              ))}
            </select>
          </label>
          <button onClick={() => setPlain(true)} className="text-xs underline">
            Plain text editor
          </button>
        </div>
        <p className="px-4 py-2 text-xs text-[var(--color-muted)]">
          Code review interview. Execution is unavailable; explain your tests
          and expected results.
        </p>
        <div className="min-h-0 flex-1">
          <MonacoEditor
            value={text}
            onChange={(v) => update(v ?? "", { language })}
            language={language}
            theme="vs"
            options={{
              fontSize: 15,
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              accessibilitySupport: "on",
              ariaLabel: "Your interview solution",
            }}
          />
        </div>
      </div>
    );
  return (
    <label className="flex h-full flex-col">
      <span className="border-b border-[var(--color-line)] px-4 py-3 text-xs text-[var(--color-muted)]">
        {modality === "system_design"
          ? "Architecture description — describe components and connections"
          : modality === "written"
            ? "Your written response"
            : modality === "coding"
              ? "Your solution"
              : "Optional notes — the interviewer can read these"}
      </span>
      <textarea
        value={text}
        onChange={(e) =>
          update(
            e.target.value,
            modality === "coding" ? { language } : undefined,
          )
        }
        className="min-h-0 flex-1 resize-none bg-[var(--color-panel)] p-5 leading-relaxed text-[var(--color-ink)]"
        placeholder="Start here. Your work saves automatically."
      />
    </label>
  );
}
export function summarizeDiagram(elements: readonly unknown[]): string {
  const live = (
    elements as {
      id: string;
      type: string;
      text?: string;
      isDeleted?: boolean;
      startBinding?: { elementId: string } | null;
      endBinding?: { elementId: string } | null;
      containerId?: string | null;
    }[]
  ).filter((e) => !e.isDeleted);
  const names = new Map<string, string>();
  for (const e of live)
    if (e.text) {
      names.set(e.id, e.text);
      if (e.containerId) names.set(e.containerId, e.text);
    }
  const labels = [...new Set(names.values())];
  const links = live
    .filter((e) => e.type === "arrow")
    .map(
      (e) =>
        (names.get(e.startBinding?.elementId ?? "") ?? "unlabeled component") +
        " → " +
        (names.get(e.endBinding?.elementId ?? "") ?? "unlabeled component"),
    );
  return (
    (labels.length ? "Components: " + labels.join(", ") : "") +
    (links.length ? "\nConnections: " + links.join("; ") : "")
  );
}
