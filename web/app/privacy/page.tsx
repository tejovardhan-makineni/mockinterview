import { AppShell } from "@/components/AppShell";
import Link from "next/link";
export default function Privacy() {
  return (
    <AppShell active="public">
      <article className="prose-page mx-auto">
        <p className="eyebrow">Your practice is personal</p>
        <h1 className="page-title mt-3">Privacy & your data</h1>
        <p className="mt-5">
          This page describes how this application handles practice data. A
          self-hosted installation is operated by its owner and may use
          different provider and retention settings.
        </p>
        <h2>What an interview uses</h2>
        <p>
          Your account, selected scenario, answers, working notes or diagram,
          and optional resume provide context for the interview. Text and, in
          voice mode, microphone audio are processed by the configured AI
          provider. Your transcript, workspace and generated report are saved
          with your account so you can review them later.
        </p>
        <h2>Camera and microphone</h2>
        <p>
          Camera self-view is optional, starts off, and is shown locally in your
          browser. This release does not collect camera-analysis samples or
          record camera video. You can use text without granting camera or
          microphone access. Voice interviews stream microphone audio to the
          service and its speech provider; they are not an offline mode.
        </p>
        <h2>Your own model key</h2>
        <p>
          A personal key is sent over the configured connection to the service
          for validation and the selected interview. It is not stored in your
          browser, included in your transcript or attached to product feedback.
          The service may retain an encrypted, temporary credential to resume
          the interview and finish scoring. Your model provider’s usage charges
          and data policies still apply. Use only a key you are authorized to
          use.
        </p>
        <h2>History, export and deletion</h2>
        <p>
          You can export your account data in Settings, delete individual
          interviews from History, or delete your account. Deleting interview
          content or your account does not reset the hosted usage allowance. A
          minimal anti-abuse record retains a keyed hash of your email, the
          attempt identifier, funding type and start time. It contains no email
          text, resume, transcript or report. It expires after seven days and is
          removed by periodic cleanup. Existing raw camera-analysis samples from
          earlier versions are subject to the service’s retention job.
          Operational backups may retain deleted data until their configured
          expiry.
        </p>
        <h2>Feedback and diagnostics</h2>
        <p>
          Product feedback includes your rating or comment, the relevant session
          identifier when applicable. Technical context is sent only when you
          opt in. Transcript sharing is a separate optional choice. API keys are
          never requested in feedback. Technical errors and usage events help
          the operator diagnose failures; avoid putting confidential employer,
          patient, client or other third-party information into practice
          material.
        </p>
        <h2>Questions and requests</h2>
        <p>
          Use{" "}
          <Link href="/help" className="underline">
            Help & support
          </Link>{" "}
          for access or data requests. Public source-code issues are visible to
          everyone; do not include private records or credentials.
        </p>
      </article>
    </AppShell>
  );
}
