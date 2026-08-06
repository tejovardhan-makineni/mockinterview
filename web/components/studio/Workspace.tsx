"use client";

// The candidate's work surface, chosen by interview modality:
//   system_design → Excalidraw canvas   coding → Monaco editor
//   written → rich text pad             conversational → notes scratchpad
// It reports a debounced text representation of the content up to the studio,
// which persists it and feeds it to the interviewer (so the AI can reference
// "the Postgres box you drew").
import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { Modality } from "@/lib/types";
import "@excalidraw/excalidraw/index.css"; // REQUIRED — without this the canvas/toolbar render blank

const Excalidraw = dynamic(async () => (await import("@excalidraw/excalidraw")).Excalidraw, { ssr: false });
const MonacoEditor = dynamic(() => import("@monaco-editor/react"), { ssr: false });

type Props = { modality: Modality; onContent: (text: string) => void };

export function Workspace({ modality, onContent }: Props) {
  switch (modality) {
    case "system_design": return <CanvasWs onContent={onContent} />;
    case "coding": return <CodeWs onContent={onContent} />;
    default: return <TextWs modality={modality} onContent={onContent} />;
  }
}

function useDebouncedEmit(onContent: (t: string) => void, delay = 1200) {
  const timer = useRef<number | undefined>(undefined);
  return (text: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = window.setTimeout(() => onContent(text), delay);
  };
}

// ---- Excalidraw canvas (system design) ----
function CanvasWs({ onContent }: { onContent: (t: string) => void }) {
  const emit = useDebouncedEmit(onContent);
  return (
    <div className="h-full w-full overflow-hidden rounded-xl border border-[var(--color-line)]">
      <Excalidraw
        theme="dark"
        onChange={(elements: readonly unknown[]) => emit(summarizeDiagram(elements))}
        UIOptions={{ canvasActions: { toggleTheme: false, loadScene: false, saveToActiveFile: false } }}
      />
    </div>
  );
}

// Turn Excalidraw elements into a text description the interviewer can reason about.
function summarizeDiagram(elements: readonly unknown[]): string {
  const els = elements as { type?: string; text?: string; isDeleted?: boolean; id?: string }[];
  const live = els.filter((e) => e && !e.isDeleted);
  const labels = live.filter((e) => e.type === "text" && e.text).map((e) => e.text!.trim()).filter(Boolean);
  const shapeCounts: Record<string, number> = {};
  for (const e of live) {
    if (e.type && e.type !== "text") shapeCounts[e.type] = (shapeCounts[e.type] ?? 0) + 1;
  }
  const shapes = Object.entries(shapeCounts).map(([t, n]) => `${n} ${t}${n > 1 ? "s" : ""}`).join(", ");
  const parts: string[] = [];
  if (labels.length) parts.push(`labeled components: ${labels.join(", ")}`);
  if (shapes) parts.push(`shapes: ${shapes}`);
  const arrows = shapeCounts["arrow"] ?? 0;
  if (arrows) parts.push(`${arrows} connection${arrows > 1 ? "s" : ""}`);
  return parts.length ? parts.join("; ") : "empty canvas";
}

// ---- Monaco editor (coding) ----
function CodeWs({ onContent }: { onContent: (t: string) => void }) {
  const emit = useDebouncedEmit(onContent);
  const [lang, setLang] = useState("python");
  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-xl border border-[var(--color-line)] bg-[#0d1017]">
      <div className="flex items-center gap-2 border-b border-[var(--color-line)] px-3 py-1.5 text-xs text-[var(--color-muted)]">
        <span>Language</span>
        <select value={lang} onChange={(e) => setLang(e.target.value)} className="rounded bg-[var(--color-panel-2)] px-2 py-1 text-[var(--color-ink)]">
          {["python", "javascript", "typescript", "go", "java", "cpp"].map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
      </div>
      <div className="min-h-0 flex-1">
        <MonacoEditor
          height="100%"
          language={lang}
          theme="vs-dark"
          defaultValue={`# Write your solution here\n`}
          onChange={(v) => emit(`# language: ${lang}\n${v ?? ""}`)}
          options={{ fontSize: 14, minimap: { enabled: false }, scrollBeyondLastLine: false }}
        />
      </div>
    </div>
  );
}

// ---- Text pad (written / conversational notes) ----
function TextWs({ modality, onContent }: { modality: Modality; onContent: (t: string) => void }) {
  const emit = useDebouncedEmit(onContent);
  const [val, setVal] = useState("");
  const placeholder = useMemo(
    () => (modality === "written" ? "Write your response here — the interviewer reads it and probes." : "Optional scratchpad for your notes during the conversation."),
    [modality]
  );
  useEffect(() => { emit(val); }, [val]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="h-full w-full overflow-hidden rounded-xl border border-[var(--color-line)]">
      <textarea
        value={val}
        onChange={(e) => setVal(e.target.value)}
        placeholder={placeholder}
        className="h-full w-full resize-none bg-[#0d1017] p-5 text-[15px] leading-relaxed text-[#e8eaf0] outline-none placeholder:text-[#8791a6]"
      />
    </div>
  );
}
