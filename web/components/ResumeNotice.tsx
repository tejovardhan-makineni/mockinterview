export function ResumeNotice() {
  return (
    <p className="my-3 text-xs text-[var(--color-muted)]">
      Choosing a file uploads it immediately. Its text is sent to the service’s
      AI model (Google Gemini on mockinterview.live) for parsing and saved with
      your account; this happens before you choose whether to use it in an
      interview. Reviews also send the resume and any job description to that
      model. Share only your own permitted material, remove contact details you
      do not need, and omit sensitive personal or confidential information. A
      resume is optional.{" "}
      <a href="/privacy" className="underline" target="_blank" rel="noopener">
        Privacy details
      </a>
    </p>
  );
}
