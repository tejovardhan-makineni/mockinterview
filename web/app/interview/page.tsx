"use client";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/http";
import type { Session, WorkspaceSnapshot } from "@/lib/features/interview";
import type { QuestionSummary } from "@/lib/features/catalog";
import {
  LiveSession,
  type Caption,
  type ConnState,
  type SectionInfo,
} from "@/lib/live";
import { WorkspaceSaver, readWorkspaceDraft } from "@/lib/workspaceSave";
import {
  Avatar3D,
  interviewerName,
  type AvatarDrive,
} from "@/components/studio/Avatar3D";
import { PersonalKeyRecovery } from "@/components/PersonalKeyRecovery";
import { Workspace } from "@/components/studio/Workspace";
import { Webcam } from "@/components/studio/Webcam";
import { FeedbackWidget } from "@/components/FeedbackWidget";
import { Button, Panel, ErrorNotice } from "@/components/ui";
function Room() {
  const router = useRouter();
  const params = useSearchParams();
  const sid = params.get("s") ?? "";
  const [session, setSession] = useState<Session | null>(null);
  const [question, setQuestion] = useState<QuestionSummary | null>(null);
  const [initial, setInitial] = useState<WorkspaceSnapshot | null>(null);
  const [captions, setCaptions] = useState<Caption[]>([]);
  const [conn, setConn] = useState<ConnState>("connecting");
  const [status, setStatus] = useState("Preparing your interviewer…");
  const [section, setSection] = useState<SectionInfo | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState("saved");
  const [ending, setEnding] = useState(false);
  const [typed, setTyped] = useState("");
  const [camera, setCamera] = useState(false);
  const [muted, setMuted] = useState(false);
  const [effectiveMode, setEffectiveMode] = useState<"voice" | "text">("text");
  const [modeNotice, setModeNotice] = useState("");
  const [tab, setTab] = useState("workspace");
  const [remaining, setRemaining] = useState<number | null>(null);
  const [aiState, setAiState] = useState("Ready");
  const [draftNotice, setDraftNotice] = useState("");
  const [micLevel, setMicLevel] = useState(0);
  const live = useRef<LiveSession | null>(null);
  const saver = useRef<WorkspaceSaver | null>(null);
  const drive = useRef<AvatarDrive>({
    speaking: false,
    amplitude: 0,
    mood: "listening",
  });
  const transcript = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const finishRef = useRef<() => Promise<void>>(async () => {});
  const lastSnapshot = useRef("");
  useEffect(() => {
    if (stick.current && transcript.current)
      transcript.current.scrollTop = transcript.current.scrollHeight;
  }, [captions]);
  useEffect(() => {
    let cancelled = false;
    let ls: LiveSession | undefined;
    let writer: WorkspaceSaver | undefined;
    (async () => {
      try {
        const user = await api.me();
        if (cancelled) return;
        if (!user) {
          router.replace(
            "/login?next=" + encodeURIComponent("/interview?s=" + sid),
          );
          return;
        }
        const s = await api.getSession(sid);
        if (cancelled) return;
        if (["scoring", "feedback_failed", "complete"].includes(s.status)) {
          router.replace("/report?s=" + sid);
          return;
        }
        if (["abandoned", "expired"].includes(s.status))
          throw new Error(
            "This attempt can no longer be resumed. Your saved record is available in History.",
          );
        if (user.policies_required) {
          router.replace("/consent?next=" + encodeURIComponent("/interview?s=" + sid));
          return;
        }
        const [q, prior] = await Promise.all([
          api.getQuestion(s.question_id),
          api.getTranscript(sid),
        ]);
        if (cancelled) return;
        const snapshot = s.workspace ?? {
          kind:
            s.modality === "coding"
              ? "code"
              : s.modality === "system_design"
                ? "canvas"
                : s.modality === "written"
                  ? "written"
                  : "note",
          content: "",
          revision: 0,
        };
        const draft = readWorkspaceDraft("mi_workspace_" + sid);
        const restored = draft
          ? { ...draft, revision: snapshot.revision }
          : snapshot;
        setInitial(restored);
        lastSnapshot.current = JSON.stringify(restored);
        setSession(s);
        setQuestion(q);
        setMuted(s.mode === "text");
        if (s.mode === "text") setTab("conversation");
        setCaptions(
          prior.map((turn) => ({
            role: turn.role,
            text: turn.text,
            id: turn.event_id ?? turn.id,
            delivery: "sent" as const,
          })),
        );
        writer = new WorkspaceSaver(
          snapshot,
          async (next) => {
            const result = await api.saveSnapshot(sid, next);
            ls?.sendCanvas(next.content);
            return result;
          },
          (value, e) => {
            if (!cancelled) {
              setSaving(value);
              if (e) setError(errorMessage(e));
            }
          },
          "mi_workspace_" + sid,
        );
        saver.current = writer;
        if (draft) {
          setDraftNotice(
            "Recovered unsaved work from this browser. It will be saved before you finish.",
          );
          writer.update(restored);
        }
        ls = new LiveSession(sid, [], s.config.voice_id, {
          mode: s.mode ?? "voice",
          language: s.config.language ?? "en",
          inputDeviceId: sessionStorage.getItem("mi_device_" + sid) ?? "",
          prompt: q.prompt,
        });
        live.current = ls;
        ls.on("caption", (caption) => {
          setCaptions((prev) => {
            const last = prev[prev.length - 1];
            if (last && last.role === caption.role && last.streaming)
              return [...prev.slice(0, -1), caption];
            if (caption.id && prev.some((c) => c.id === caption.id))
              return prev;
            return [...prev, caption];
          });
        })
          .on("delivery", (value) =>
            setCaptions((prev) =>
              prev.map((c) =>
                c.id === value.id ? { ...c, delivery: value.status } : c,
              ),
            ),
          )
          .on("connection", (state) => {
            setConn(state);
            if (state === "connected") {
              void api
                .getSession(sid)
                .then((updated) => {
                  if (!cancelled) setSession(updated);
                })
                .catch(() => {});
            }
          })
          .on("mode", (mode) => {
            const effective = mode === "voice" ? "voice" : "text";
            setEffectiveMode(effective);
            setMuted(effective === "text" || (ls?.isMuted() ?? false));
            if (effective === "text") {
              setTab("conversation");
              if (s.mode === "voice")
                setModeNotice(
                  "This installation is providing a text interview. Your microphone is off; type your answers in Conversation.",
                );
            } else setModeNotice("");
          })
          .on("status", setStatus)
          .on("error", setError)
          .on("section", setSection)
          .on("speaking", (on) => {
            drive.current.speaking = on;
            drive.current.mood = on ? "speaking" : "listening";
            setAiState(on ? "Speaking" : "Listening");
          })
          .on("userSpeaking", (on) => {
            if (!drive.current.speaking)
              setAiState(on ? "Listening" : "Thinking");
          })
          .on("micLevel", setMicLevel)
          .on("amplitude", (v) => {
            drive.current.amplitude = v;
          })
          .on("viseme", (v) => {
            drive.current.level = v.level;
            drive.current.bright = v.bright;
          })
          .on("ended", () => {
            void finishRef.current();
          });
        if (cancelled) {
          ls.end();
          writer.dispose();
          return;
        }
        await ls.start(s.duration_minutes ?? 30);
      } catch (e) {
        if (!cancelled) setError(errorMessage(e));
      }
    })();
    return () => {
      cancelled = true;
      ls?.end();
      writer?.dispose();
    };
  }, [sid, router]);
  useEffect(() => {
    if (!session?.deadline_at) return;
    const deadline = new Date(session.deadline_at).getTime();
    const tick = () => setRemaining(Math.max(0, deadline - Date.now()));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [session?.deadline_at]);
  const change = useCallback((snapshot: WorkspaceSnapshot) => {
    const serialized = JSON.stringify(snapshot);
    if (serialized === lastSnapshot.current) return;
    lastSnapshot.current = serialized;
    saver.current?.update(snapshot);
  }, []);
  async function finish() {
    if (ending) return;
    setEnding(true);
    setError("");
    try {
      if (typed.trim()) {
        live.current?.submitText(typed);
        setTyped("");
      }
      await saver.current?.flush();
      await live.current?.drain();
      live.current?.end();
      setCamera(false);
      await api.finishSession(sid);
      router.push("/report?s=" + sid);
    } catch (e) {
      setError(errorMessage(e));
      setEnding(false);
    }
  }
  useEffect(() => {
    finishRef.current = finish;
  });
  if (!session || !initial)
    return (
      <main className="page-width">
        {error ? (
          <ErrorNotice
            message={error}
            onRetry={() => window.location.reload()}
          />
        ) : (
          <p role="status">Preparing your interview…</p>
        )}
        <Button href="/results" variant="ghost" className="mt-6">
          Go to history
        </Button>
      </main>
    );
  const connected = conn === "connected";
  const time =
    remaining !== null
      ? Math.floor(remaining / 60000) +
        ":" +
        String(Math.floor(remaining / 1000) % 60).padStart(2, "0")
      : session.duration_minutes + " min";
  return (
    <>
      <a href="#room-work" className="skip-link">
        Skip to workspace
      </a>
      <header className="border-b border-[var(--color-line)] bg-[var(--color-panel)]">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-3 px-6 py-4">
          <div>
            <p className="eyebrow">Your practice room</p>
            <h1 className="mt-1 text-lg font-semibold">{question?.title}</h1>
          </div>
          <div className="flex items-center gap-4 text-xs">
            <span
              role="status"
              className={
                connected
                  ? "text-[var(--color-good)]"
                  : "text-[var(--color-warn)]"
              }
            >
              {connected
                ? "Interviewer ready"
                : conn === "failed"
                  ? "Connection needs attention"
                  : "Connecting…"}
            </span>
            <span className="font-mono" aria-label="Remaining time">
              {time}
            </span>
            <FeedbackWidget
              variant="studio"
              getContext={() => ({
                session_id: sid,
                question_id: session.question_id,
                connection: conn,
                section: section?.title,
                mode: effectiveMode,
              })}
            />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1400px] px-4 py-5 sm:px-6">
        {error && (
          <div className="mb-4">
            <ErrorNotice message={error} />
          </div>
        )}
        {session.funding === "byok" && conn === "failed" && (
          <div className="mb-4">
            <PersonalKeyRecovery
              sessionId={sid}
              provider={session.provider}
              onSaved={() => {
                setError("");
                live.current?.reconnect();
              }}
            />
          </div>
        )}
        {modeNotice && (
          <p className="notice mb-4" role="status">
            {modeNotice}
          </p>
        )}
        {draftNotice && (
          <p className="notice mb-4" role="status">
            {draftNotice}
          </p>
        )}
        <div className="mb-4 flex gap-2 lg:hidden" aria-label="Room panels">
          {["workspace", "conversation"].map((value) => (
            <Button
              key={value}
              variant={tab === value ? "primary" : "ghost"}
              aria-pressed={tab === value}
              onClick={() => setTab(value)}
            >
              {value === "workspace" ? "Brief & workspace" : "Conversation"}
            </Button>
          ))}
        </div>
        <div className="room-grid">
          <section
            id="room-work"
            className={tab !== "workspace" ? "hidden lg:block" : ""}
          >
            <Panel className="overflow-hidden">
              <details
                open
                className="border-b border-[var(--color-line)] bg-[var(--color-panel-2)] px-5 py-4"
              >
                <summary className="text-sm font-semibold">
                  Interview brief
                </summary>
                <p className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap text-sm">
                  {question?.prompt}
                </p>
              </details>
              <div className="flex items-center justify-between border-b border-[var(--color-line)] px-5 py-2 text-xs">
                <span>{section ? section.title : "Your workspace"}</span>
                <span role="status">
                  {saving === "saved"
                    ? "All changes saved"
                    : saving === "saving"
                      ? "Saving…"
                      : "Changes waiting to save"}
                </span>
                {saving === "unsaved" && (
                  <button
                    className="underline"
                    onClick={() => {
                      void saver.current
                        ?.flush()
                        .catch((e) => setError(errorMessage(e)));
                    }}
                  >
                    Retry save
                  </button>
                )}
              </div>
              <div className="room-workspace">
                {session.modality === "conversational" ? (
                  <div className="flex h-full flex-col items-center justify-center gap-6 p-6">
                    <div className="h-64 w-64 max-w-full sm:h-80 sm:w-80">
                      <Avatar3D faceId={session.config.face_id} drive={drive} />
                    </div>
                    <div className="text-center">
                      <h2 className="text-xl font-medium">
                        {interviewerName(session.config.face_id)}
                      </h2>
                      <p className="mt-1 text-sm text-[var(--color-muted)]">
                        {connected ? aiState : status} · AI interviewer
                      </p>
                    </div>
                    <details className="w-full rounded-lg border border-[var(--color-line)]">
                      <summary className="px-4 py-3 text-sm">
                        Optional interview notes
                      </summary>
                      <div className="h-44">
                        <Workspace
                          modality={session.modality}
                          initial={initial}
                          onChange={change}
                        />
                      </div>
                    </details>
                  </div>
                ) : (
                  <Workspace
                    modality={session.modality}
                    initial={initial}
                    onChange={change}
                  />
                )}
              </div>
            </Panel>
          </section>
          <aside
            className={
              "space-y-4 " + (tab !== "conversation" ? "hidden lg:block" : "")
            }
          >
            <Panel className="p-4">
              <div
                className={
                  "mx-auto h-40 w-40 " +
                  (session.modality === "conversational" ? "lg:hidden" : "")
                }
              >
                <Avatar3D faceId={session.config.face_id} drive={drive} />
              </div>
              <div className="mt-3 flex items-center justify-between">
                <h2 className="font-semibold">
                  {interviewerName(session.config.face_id)}
                </h2>
                <span className="text-xs text-[var(--color-muted)]">
                  AI interviewer
                </span>
              </div>
              <p className="mt-1 text-xs" aria-live="polite">
                {connected ? aiState : status}
              </p>
            </Panel>
            <Panel className="overflow-hidden">
              <h2 className="border-b border-[var(--color-line)] px-4 py-3 text-sm font-semibold">
                Conversation
              </h2>
              <div
                ref={transcript}
                role="log"
                aria-label="Interview transcript"
                aria-live="polite"
                aria-relevant="additions text"
                onScroll={(e) => {
                  const el = e.currentTarget;
                  stick.current =
                    el.scrollHeight - el.scrollTop - el.clientHeight < 60;
                }}
                className="max-h-[35dvh] min-h-40 space-y-4 overflow-auto px-4 py-4"
              >
                {!captions.length && (
                  <p className="text-sm text-[var(--color-muted)]">
                    Your interviewer will begin when the connection is ready.
                  </p>
                )}
                {captions.map((caption, i) => (
                  <div key={caption.id ?? i}>
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">
                      {caption.role === "candidate"
                        ? "You"
                        : caption.role === "system"
                          ? "Connection"
                          : interviewerName(session.config.face_id)}
                      {caption.delivery === "pending"
                        ? " · waiting to send"
                        : ""}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-sm">
                      {caption.text}
                    </p>
                  </div>
                ))}
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (typed.trim()) {
                    live.current?.submitText(typed);
                    setTyped("");
                    stick.current = true;
                  }
                }}
                className="space-y-2 border-t border-[var(--color-line)] p-3"
              >
                <label
                  htmlFor="typed-answer"
                  className="text-xs text-[var(--color-muted)]"
                >
                  Type an answer or correction
                </label>
                <textarea
                  id="typed-answer"
                  rows={3}
                  className="field-select resize-y text-sm"
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                />
                <Button
                  type="submit"
                  className="w-full"
                  variant="ghost"
                  disabled={!typed.trim() || ending}
                >
                  {connected ? "Send answer" : "Queue answer"}
                </Button>
              </form>
            </Panel>
            {camera && <Webcam />}
          </aside>
        </div>
      </main>
      <footer className="room-controls">
        <div className="mx-auto flex max-w-[1350px] flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {effectiveMode === "voice" && (
              <>
                <Button
                  variant="ghost"
                  aria-pressed={!muted}
                  onClick={() => {
                    live.current?.setMuted(!muted);
                    setMuted(!muted);
                  }}
                >
                  {muted ? "Unmute microphone" : "Mute microphone"}
                </Button>
                <meter
                  value={micLevel}
                  min={0}
                  max={1}
                  aria-label="Local microphone input level"
                  className="w-16"
                />
                <Button
                  variant="ghost"
                  onClick={() => {
                    void live.current
                      ?.enableAudio()
                      .catch((e) => setError(errorMessage(e)));
                  }}
                >
                  Enable audio
                </Button>
              </>
            )}
            <Button
              variant="ghost"
              aria-pressed={camera}
              onClick={() => setCamera(!camera)}
            >
              {camera ? "Camera off" : "Camera self-view"}
            </Button>
            {!connected && (
              <Button
                variant="ghost"
                onClick={() => {
                  setError("");
                  live.current?.reconnect();
                }}
              >
                Retry connection
              </Button>
            )}
          </div>
          <Button onClick={() => void finish()} disabled={ending}>
            {ending
              ? "Saving & preparing feedback…"
              : "Finish & see feedback →"}
          </Button>
        </div>
      </footer>
    </>
  );
}
export default function InterviewPage() {
  return (
    <Suspense fallback={<p className="p-10">Opening room…</p>}>
      <Room />
    </Suspense>
  );
}
