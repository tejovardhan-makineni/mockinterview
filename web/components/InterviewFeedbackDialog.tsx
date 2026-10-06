"use client";
import { useCallback, useId, useRef, useState } from "react";
import {
  InterviewCheckIn,
  type InterviewCheckInStatus,
} from "./InterviewCheckIn";
import { IconFeedback } from "./icons";
import styles from "./InterviewFeedbackDialog.module.css";

const statusLabels: Record<InterviewCheckInStatus, string> = {
  loading: "Loading…",
  pending: "Pending",
  submitted: "Submitted",
  unavailable: "Unavailable",
  ineligible: "Not available",
};

export function InterviewFeedbackDialog({
  sessionId,
  reportAvailable = false,
}: {
  sessionId: string;
  reportAvailable?: boolean;
}) {
  const [status, setStatus] = useState<InterviewCheckInStatus>("loading");
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const close = useCallback(() => dialog.current?.close(), []);

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={styles.trigger}
        data-status={status}
        aria-haspopup="dialog"
        aria-controls={id}
        onClick={() => dialog.current?.showModal()}
      >
        <IconFeedback className="h-4 w-4 shrink-0" />
        <span>Interview feedback</span>
        <span className={styles.status} aria-live="polite">
          <span aria-hidden="true">{status === "submitted" ? "✓" : "•"}</span>
          {statusLabels[status]}
        </span>
      </button>
      <dialog
        ref={dialog}
        id={id}
        aria-labelledby={id + "-title"}
        aria-describedby={id + "-description"}
        className={styles.dialog + " no-print"}
        onClose={() => trigger.current?.focus()}
      >
        <header className={styles.header}>
          <div>
            <h2 id={id + "-title"}>Interview feedback</h2>
            <p id={id + "-description"}>
              Help improve the experience. This is separate from your results.
            </p>
          </div>
          <button
            type="button"
            className={styles.close}
            onClick={close}
            aria-label="Close interview feedback"
            autoFocus
          >
            <span aria-hidden="true">✕</span>
          </button>
        </header>
        <div
          className={styles.body}
          role="region"
          aria-label="Interview feedback form"
          tabIndex={0}
        >
          {/* Keep the form mounted when closed so unfinished answers survive. */}
          <InterviewCheckIn
            key={sessionId}
            sessionId={sessionId}
            reportAvailable={reportAvailable}
            embedded
            showIneligible
            onStatusChange={setStatus}
            onReadReport={close}
          />
        </div>
        <footer className={styles.footer}>
          <p>Closing keeps any draft while you stay on this page.</p>
          <button type="button" className={styles.done} onClick={close}>
            Back to results
          </button>
        </footer>
      </dialog>
    </>
  );
}
