import { AppShell } from "@/components/AppShell";
import Link from "next/link";
const contact =
  process.env.NEXT_PUBLIC_SUPPORT_EMAIL || "makinenitejovardhan@gmail.com";
export default function Terms() {
  return (
    <AppShell active="public">
      <article className="prose-page mx-auto">
        <p className="eyebrow">Before you practice</p>
        <h1 className="page-title mt-3">Using mockinterview</h1>
        <p className="mt-5">
          Effective September 10, 2026 · terms version 2026-09-10.1
        </p>
        <p>
          These terms cover the hosted mockinterview.live service provided by
          the project maintainer, reachable at{" "}
          <a className="underline" href={"mailto:" + contact}>
            {contact}
          </a>
          . Other installations have their own operators. The source-code
          license separately governs the open-source software.
        </p>
        <h2>Adult, independent practice</h2>
        <p>
          You must be at least 18 to create a hosted account or use hosted AI
          practice. Use it to rehearse your own interviews. Do not use the
          service to screen, rank or make hiring, admission, credit or other
          consequential decisions about other people; to monitor workers or
          students; or to record actual interviews without the participants’
          permission. Institution-managed, employer and minor use require
          separate assessment and are not offered under these terms.
        </p>
        <h2>You are speaking with AI</h2>
        <p>
          Interviewers are synthetic characters, including their illustrated
          faces and generated voices. Questions and feedback may be incomplete,
          biased or incorrect. Scores describe practice performance, not
          validated hiring predictions, job guarantees, licensure assessments or
          professional advice. Medical, legal and similar scenarios are
          fictional education; do not use the service for real clinical
          decisions, diagnosis, treatment or advice to clients. Review
          suggestions before relying on them.
        </p>
        <h2>Your material and privacy choices</h2>
        <p>
          Provide only material you have permission to process through this
          service and its providers. You retain your rights in your submissions;
          you give the operator permission to process, store, transmit and
          display them as needed to deliver the requested service, support and
          safety controls described in the{" "}
          <Link href="/privacy" className="underline">
            Privacy notice
          </Link>
          . This does not make your private records public or grant a general
          right to sell them or train models on them.
        </p>
        <p>
          Omit confidential employer questions, actual patient/client records,
          sensitive personal information, government/financial identifiers and
          other people’s credentials. Use fictional cases. For voice practice,
          use a private space and record only yourself. Resume inclusion, camera
          self-view and optional feedback sharing remain choices. Providers have
          separate terms governing their processing and any generated outputs;
          no ownership or exclusivity of AI output is promised.
        </p>
        <h2>Hosted access and model costs</h2>
        <p>
          One platform-funded attempt is available per rolling seven days, with
          a shared limit of one hosted attempt per rolling 24 hours across
          funding modes. Availability also depends on service capacity. Setup
          shows eligibility and next-start times. Reconnecting or retrying a
          report stays with the original attempt. Deletion does not reset the
          allowance. You can run the open-source project locally for more
          practice, subject to provider costs and terms.
        </p>
        <p>
          Use only personal model keys you are authorized to use and check their
          provider costs, supported locations and data terms. Your provider may
          charge for connection validation, interviews and reports. Personal
          Gemini keys must belong to a project with paid billing enabled; a
          successful connection does not verify this. Do not bypass quotas,
          probe other users’ records, submit malware or use the service
          unlawfully.
        </p>
        <h2>A short check-in after practice</h2>
        <p>
          New interview attempts include a required product-feedback check-in
          after an interview has started and ended, including unsuccessful
          attempts. Complete it before starting another interview. Choose the
          answer that reflects your experience; an unable-to-judge response is
          valid. Older attempts and reservations that never started do not
          create a feedback requirement. Your saved reports, history, export,
          deletion and report-retry controls remain available.
        </p>
        <p>
          Comments and permission to inspect a transcript are optional. Your
          answers are associated with your account and used to improve the
          product, as explained in the privacy notice. This check-in does not
          enroll you in a university study, permit publication of your private
          records or affect your interview score.
        </p>
        <h2>Community formats and contributions</h2>
        <p>
          Community preview scenarios are not independently validated.
          Company-style paths approximate interview patterns and are not
          affiliated with or guaranteed to match an employer. Public
          contributions are a separate intentional act: follow the repository’s
          license, contribution and conduct guidance, submit original or
          appropriately licensed material, and disclose sources. Your private
          interview history and product feedback are not automatically published
          to GitHub.
        </p>
        <h2>Changes, interruptions and ending use</h2>
        <p>
          The service is a public beta. Features and availability may change,
          and interruptions or errors can occur. We may restrict abusive,
          unlawful or ineligible use, with notice where practicable, while
          handling applicable access/deletion rights. You can stop using the
          service and export or delete your account in Settings. Contact support
          for inaccessible records or unrecoverable attempts.
        </p>
        <p>
          Material updates to these terms will be dated and presented for review
          before further hosted AI use. Nothing here excludes rights, remedies
          or obligations that applicable law does not allow us to waive. No
          guarantee of accuracy, uninterrupted service or a particular interview
          outcome is made.
        </p>
        <h2>Questions, accessibility and copyright</h2>
        <p>
          Use{" "}
          <Link href="/help" className="underline">
            Help & support
          </Link>{" "}
          for private concerns, accessibility barriers, data requests or
          suspected copyright infringement. Identify the material and your
          rights without posting confidential documents publicly. The
          repository’s{" "}
          <a
            className="underline"
            href="https://github.com/tejovardhan-makineni/mockinterview/blob/main/CONTRIBUTING.md"
          >
            contribution guidance
          </a>{" "}
          explains how to improve formats responsibly.
        </p>
      </article>
    </AppShell>
  );
}
