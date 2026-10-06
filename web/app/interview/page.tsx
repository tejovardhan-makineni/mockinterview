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
  type MicState,
  type AudioState,
} from "@/lib/live";
import { WorkspaceSaver, readWorkspaceDraft } from "@/lib/workspaceSave";
import { describeWorkspace } from "@/lib/workspaceObservation";
import {
  Avatar3D,
  interviewerName,
  type AvatarDrive,
} from "@/components/studio/Avatar3D";
import { PersonalKeyRecovery } from "@/components/PersonalKeyRecovery";
import { Workspace } from "@/components/studio/Workspace";
import { Webcam } from "@/components/studio/Webcam";
import { LiveHUD } from "@/components/studio/LiveHUD";
import { BetaBadge } from "@/components/BetaBadge";
import { IconMic, IconMicOff } from "@/components/icons";
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
  const [microphone, setMicrophone] = useState<MicState>("off");
  const [audio, setAudio] = useState<AudioState>("idle");
  const micLevel = useRef(0);
  const live = useRef<LiveSession | null>(null);
  const saver = useRef<WorkspaceSaver | null>(null);
  const drive = useRef<AvatarDrive>({
    speaking: false,
    amplitude: 0,
    mood: "listening",
  });
  const transcript = useRef<HTMLDivElement>(null);
  const roomHeader = useRef<HTMLElement>(null);
  const roomIntro = useRef<HTMLDivElement>(null);
  const roomGrid = useRef<HTMLDivElement>(null);
  const roomControls = useRef<HTMLElement>(null);
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
          router.replace(
            "/consent?next=" + encodeURIComponent("/interview?s=" + sid),
          );
          return;
        }
        const [q, prior] = await Promise.all([
          s.question
            ? Promise.resolve(s.question)
            : api.getQuestion(s.question_id),
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
        setEffectiveMode(s.mode ?? "voice");
        setCamera(sessionStorage.getItem("mi_camera_" + sid) === "1");
        setQuestion(q);
        setMuted(s.mode === "text");
        if (s.mode === "text" || s.modality === "conversational")
          setTab("conversation");
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
          modality: s.modality,
        });
        live.current = ls;
        ls.sendCanvas(describeWorkspace(restored));
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
          .on("micLevel", (value) => {
            micLevel.current = value;
          })
          .on("microphone", setMicrophone)
          .on("audio", setAudio)
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
  useEffect(() => {
    const grid = roomGrid.current;
    if (!grid) return;
    const sizeRoom = () => {
      const top = grid.getBoundingClientRect().top + window.scrollY;
      const controls =
        roomControls.current?.getBoundingClientRect().height ?? 72;
      const viewport = Math.min(
        window.innerHeight,
        window.visualViewport?.height ?? window.innerHeight,
      );
      // Reserve room for notices, wrapped headers, and the actual control bar.
      // On short screens the document can scroll instead of clipping the composer.
      grid.style.setProperty(
        "--room-panel-height",
        `${Math.max(360, Math.min(800, viewport - top - controls - 24))}px`,
      );
    };
    sizeRoom();
    const observer = new ResizeObserver(sizeRoom);
    [roomHeader.current, roomIntro.current, roomControls.current].forEach(
      (element) => {
        if (element) observer.observe(element);
      },
    );
    window.addEventListener("resize", sizeRoom);
    window.visualViewport?.addEventListener("resize", sizeRoom);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", sizeRoom);
      window.visualViewport?.removeEventListener("resize", sizeRoom);
    };
  }, [session?.id]);
  const change = useCallback((snapshot: WorkspaceSnapshot) => {
    const serialized = JSON.stringify(snapshot);
    if (serialized === lastSnapshot.current) return;
    lastSnapshot.current = serialized;
    saver.current?.update(snapshot);
    live.current?.noteWorkspaceActivity();
    live.current?.sendCanvas(describeWorkspace(snapshot));
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
      await api.finishSession(sid);
      live.current?.end();
      setCamera(false);
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
        <div className="mb-6 flex items-center gap-2">
          <h1 className="text-lg font-semibold">Your practice room</h1>
          <BetaBadge />
        </div>
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
  const workspacePanel = (
    <section
      id="room-work"
      tabIndex={-1}
      className={tab !== "workspace" ? "hidden lg:block" : ""}
    >
      <Panel className="room-work-panel overflow-hidden">
        <details
          open
          className="room-brief border-b border-[var(--color-line)] bg-[var(--color-panel-2)] px-4 py-3 sm:px-5 sm:py-4"
        >
          <summary className="text-sm font-semibold">
            {question?.candidate_brief ? "Opening brief" : "Interview brief"}
          </summary>
          <p className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap text-sm">
            {question?.prompt}
          </p>
        </details>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-line)] px-4 py-2 text-xs sm:px-5">
          <span>
            {session.modality === "conversational"
              ? "Your notes"
              : section
                ? section.title
                : "Your workspace"}
            <span className="ml-2 text-[var(--color-muted)]">
              Shared with your interviewer
            </span>
          </span>
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
        <div
          className={
            "room-workspace" +
            (session.modality === "conversational"
              ? " room-workspace-notes"
              : session.modality === "system_design"
                ? " room-workspace-canvas"
                : "")
          }
        >
          <Workspace
            modality={session.modality}
            initial={initial}
            onChange={change}
          />
        </div>
      </Panel>
    </section>
  );
  const conversationPanel = (
    <aside
      id="room-conversation"
      tabIndex={-1}
      className={
        "room-conversation " + (tab !== "conversation" ? "hidden lg:block" : "")
      }
    >
      <Panel className="room-conversation-panel overflow-hidden">
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--color-line)] px-3 py-3 sm:px-4">
          <div className="flex min-w-0 items-center gap-2">
            <div className="h-10 w-10 shrink-0 overflow-hidden rounded-full bg-[var(--color-panel-2)] sm:h-12 sm:w-12">
              <Avatar3D faceId={session.config.face_id} drive={drive} />
            </div>
            <div className="min-w-0">
              <h2 className="font-semibold">
                {interviewerName(session.config.face_id)}
              </h2>
              <p
                className="mt-0.5 text-xs text-[var(--color-muted)]"
                role="status"
              >
                AI interviewer · {connected ? aiState : status}
              </p>
            </div>
          </div>
          {camera && (
            <div className="w-20 shrink-0 sm:w-24">
              <Webcam compact />
            </div>
          )}
        </div>
        <h2 className="sr-only">Conversation</h2>
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
          className="room-transcript space-y-5 overflow-auto px-4 py-4 sm:px-5"
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
                {caption.delivery === "pending" ? " · waiting to send" : ""}
              </p>
              <p className="mt-1 whitespace-pre-wrap text-sm">{caption.text}</p>
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
          className="room-composer shrink-0 space-y-2 border-t border-[var(--color-line)] p-3 sm:p-4"
        >
          <label
            htmlFor="typed-answer"
            className="text-xs text-[var(--color-muted)]"
          >
            Type an answer or correction
          </label>
          <textarea
            id="typed-answer"
            rows={2}
            className="field-select resize-y text-sm"
            placeholder="Add an answer or clarify what you said…"
            value={typed}
            onChange={(e) => {
              setTyped(e.target.value);
              live.current?.noteWorkspaceActivity();
            }}
          />
          <div className="flex justify-end">
            <Button
              type="submit"
              variant="ghost"
              disabled={!typed.trim() || ending}
            >
              {connected ? "Send answer" : "Queue answer"}
            </Button>
          </div>
        </form>
      </Panel>
    </aside>
  );
  return (
    <>
      <a
        href={
          session.modality === "conversational"
            ? "#room-conversation"
            : "#room-work"
        }
        className="skip-link"
        onClick={(event) => {
          event.preventDefault();
          const target =
            session.modality === "conversational"
              ? "conversation"
              : "workspace";
          setTab(target);
          // Reveal the target on mobile before moving keyboard focus into it.
          requestAnimationFrame(() => {
            document
              .getElementById(
                target === "workspace" ? "room-work" : "room-conversation",
              )
              ?.focus();
          });
        }}
      >
        {session.modality === "conversational"
          ? "Skip to conversation"
          : "Skip to workspace"}
      </a>
      <header
        ref={roomHeader}
        className="border-b border-[var(--color-line)] bg-[var(--color-panel)]"
      >
        <div className="room-heading mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 sm:py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="eyebrow">Your practice room</p>
              <BetaBadge />
            </div>
            <h1 className="mt-1 text-base font-semibold sm:text-lg">
              {question?.title}
            </h1>
          </div>
          <div className="flex items-center gap-4 text-xs">
            <span
              className="shrink-0 whitespace-nowrap rounded-md bg-[var(--color-panel-2)] px-3 py-2 font-mono"
              aria-label="Remaining time"
            >
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
                ai_state: aiState,
                status: session.status,
              })}
            />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1400px] px-4 py-5 sm:px-6">
        <div ref={roomIntro}>
          <LiveHUD
            micRef={micLevel}
            microphone={microphone}
            audio={audio}
            conn={conn}
            mode={effectiveMode}
            section={section}
            onReconnect={() => {
              setError("");
              live.current?.reconnect();
            }}
            onRetryMicrophone={() => {
              if (microphone === "interrupted") {
                void live.current?.enableAudio().catch(() => {});
              } else {
                live.current?.setMuted(true);
                live.current?.setMuted(false);
                setMuted(false);
              }
            }}
            onResumeAudio={() => {
              void live.current?.enableAudio().catch(() => {});
            }}
          />
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
          <div
            className="mb-4 grid grid-cols-2 gap-2 lg:hidden"
            aria-label="Room panels"
          >
            {["workspace", "conversation"].map((value) => (
              <Button
                key={value}
                variant={tab === value ? "primary" : "ghost"}
                className="min-w-0 !px-2"
                aria-pressed={tab === value}
                onClick={() => setTab(value)}
              >
                {value === "workspace"
                  ? session.modality === "conversational"
                    ? "Brief & notes"
                    : "Brief & workspace"
                  : "Conversation"}
              </Button>
            ))}
          </div>
        </div>
        <div
          ref={roomGrid}
          className={
            "room-grid" +
            (session.modality === "conversational"
              ? " room-grid-conversational"
              : "")
          }
        >
          {session.modality === "conversational" ? (
            <>
              {conversationPanel}
              {workspacePanel}
            </>
          ) : (
            <>
              {workspacePanel}
              {conversationPanel}
            </>
          )}
        </div>
      </main>
      <footer ref={roomControls} className="room-controls">
        <div className="room-control-actions mx-auto flex max-w-[1350px] items-center justify-between gap-2">
          <div className="room-device-actions flex min-w-0 items-center gap-2">
            {effectiveMode === "voice" && (
              <Button
                variant="ghost"
                aria-label={muted ? "Unmute microphone" : "Mute microphone"}
                aria-pressed={muted}
                disabled={ending}
                onClick={() => {
                  live.current?.setMuted(!muted);
                  setMuted(!muted);
                }}
              >
                {muted ? (
                  <IconMicOff className="h-4 w-4" />
                ) : (
                  <IconMic className="h-4 w-4" />
                )}
                {muted ? "Unmute" : "Mute"}
              </Button>
            )}
            <Button
              variant="ghost"
              aria-pressed={camera}
              aria-label={camera ? "Hide self-view" : "Show self-view"}
              disabled={ending}
              onClick={() => {
                sessionStorage.setItem("mi_camera_" + sid, camera ? "0" : "1");
                setCamera(!camera);
                if (!camera) setTab("conversation");
              }}
            >
              <span className="sm:hidden">Self-view</span>
              <span className="hidden sm:inline">
                {camera ? "Hide self-view" : "Show self-view"}
              </span>
            </Button>
          </div>
          <Button onClick={() => void finish()} disabled={ending}>
            {ending ? "Saving & preparing feedback…" : "Finish interview"}
          </Button>
        </div>
      </footer>
    </>
  );
}
export default function InterviewPage() {
  return (
    <Suspense
      fallback={
        <main className="page-width">
          <div className="flex items-center gap-2">
            <p role="status">Opening room…</p>
            <BetaBadge />
          </div>
        </main>
      }
    >
      <Room />
    </Suspense>
  );
}
