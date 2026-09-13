import { AppShell, SOURCE_URL } from "@/components/AppShell";
import { Button, Panel } from "@/components/ui";
const configuredSupport = process.env.NEXT_PUBLIC_SUPPORT_EMAIL;
const support = configuredSupport || "makinenitejovardhan@gmail.com";
export default function Help() {
  return (
    <AppShell active="public">
      <article className="prose-page mx-auto">
        <p className="eyebrow">A hand when you need one</p>
        <h1 className="page-title mt-3">Help & support</h1>
        <h2>Microphone or audio unavailable</h2>
        <p>
          Check browser and operating-system permissions, select the intended
          microphone in the device check, and try the speaker test. You can
          choose a text interview without media permissions. In the room, Enable
          audio starts playback if your browser blocked it.
        </p>
        <h2>A connection dropped</h2>
        <p>
          Wait for the interviewer-ready status before repeating unacknowledged
          speech. Typed answers show their delivery state. Use Retry connection
          to resume the same attempt. Do not start a new interview to recover
          the existing one.
        </p>
        <h2>Feedback is still being prepared</h2>
        <p>
          You can return to History while processing continues. If report
          generation fails, retry from the same report page. Your saved
          interview stays associated with the original attempt.
        </p>
        <h2>Access and passwords</h2>
        <p>
          Use Forgot password on the sign-in page. Check spam folders for
          verification or recovery mail, and request a fresh link if it expired.
          Never share passwords, verification links or API keys in a public
          issue.
        </p>
        <h2>Tester access</h2>
        <p>
          Approved testers have unlimited interview starts and optional product
          check-ins. Verify the email added to the tester list and refresh setup
          to see your access. Finish or resume an active interview before
          starting another. Email verification, policy review and voice
          acknowledgment still apply.
        </p>
        <h2>Browsers and accessibility</h2>
        <p>
          Choose text if your browser does not support the voice path or you
          prefer a quieter interaction. Camera is optional. The code editor has
          a plain-text alternative, and the whiteboard offers a written
          architecture description. Let us know if a control prevents you from
          completing an interview.
        </p>
        <Panel className="mt-7 p-5">
          <h2 className="!mt-0">Contact the operator</h2>
          <p className="my-3">
            For {configuredSupport ? "this installation" : "mockinterview.live"}{" "}
            account access, private data requests or Code of Conduct reports,
            email{" "}
            {configuredSupport
              ? "the service operator"
              : "the project maintainer"}
            . You do not need to sign in. Ordinary support has no guaranteed
            response time; applicable legal deadlines still govern privacy
            requests. You can also report accessibility barriers, underage use,
            sensitive-data uploads or suspected copyright infringement here.
          </p>
          <Button href={"mailto:" + support} variant="ghost">
            {support}
          </Button>
          {!configuredSupport && (
            <p className="mt-3">
              If you use another installation, contact its owner for account or
              data requests. The project maintainer cannot access that
              installation.
            </p>
          )}
          <p className="my-4">
            For a non-sensitive reproducible bug, include the page, browser and
            support ID if an error shows one. Public issues must not contain
            your transcript, email, resume or key.
          </p>
          <Button
            href={SOURCE_URL + "/issues/new?template=bug_report.md"}
            variant="ghost"
          >
            Report a public project issue ↗
          </Button>
        </Panel>
      </article>
    </AppShell>
  );
}
