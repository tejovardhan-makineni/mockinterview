import { AppShell } from "@/components/AppShell";
import Link from "next/link";
const contact =
  process.env.NEXT_PUBLIC_SUPPORT_EMAIL || "makinenitejovardhan@gmail.com";
export default function Privacy() {
  return (
    <AppShell active="public">
      <article className="prose-page mx-auto">
        <p className="eyebrow">Your practice is personal</p>
        <h1 className="page-title mt-3">Privacy & your data</h1>
        <p className="mt-5">
          Effective September 10, 2026 · notice version 2026-09-10
        </p>
        <p>
          This notice describes the hosted mockinterview.live service,
          maintained by the mockinterview project maintainer. Contact the
          operator privately at{" "}
          <a className="underline" href={"mailto:" + contact}>
            {contact}
          </a>
          , including without an account. Other installations have their own
          operators, providers and policies.
        </p>
        <h2>Accounts and eligibility</h2>
        <p>
          We store your email, a password hash, email-verification status,
          account settings, and the version and time of your terms/privacy
          acknowledgment and adult declaration. Hosted AI practice is for people
          aged 18 or older. We do not request a birth date or identity document
          for signup. If you believe a child has provided data, contact us so we
          can restrict use and arrange deletion. An age declaration is not
          identity verification.
        </p>
        <h2>Practice, resumes and AI providers</h2>
        <p>
          Your scenario, chosen settings, answers, notes/code/diagram and
          optional resume context support the AI interview and feedback. The app
          stores transcripts, workspace revisions and reports with your account.
          It is a practice tool; it does not make employer hiring decisions or
          infer your health, identity or emotions from camera footage.
        </p>
        <p>
          Selecting a resume file immediately uploads it for text extraction and
          AI parsing, independently of the later “use for this interview”
          option. Extracted text, filename, parsed details and generated reviews
          are saved. Review and matching requests send the resume and any
          supplied job description to the service’s model. The app does not
          retain the original uploaded binary in this processing path. Use your
          own permitted material and omit unnecessary contact details, health
          information, government identifiers, financial credentials,
          confidential questions and real patient/client records.
        </p>
        <p>
          The hosted service uses Google Cloud/Firebase for hosting and storage,
          Google Gemini for platform interviews, resume tools and other AI
          assistance, and Resend for verification and password-reset emails
          (your email and a single-use link). The platform Gemini key uses a
          project with paid billing enabled. Google’s paid-service terms govern
          its handling of inputs, including safety/abuse processing.
          Personal-key interviews use the selected provider for interview
          reasoning and feedback; Gemini supplies native voice. Resume tools
          still use the platform model.
        </p>
        <p>
          Review the relevant provider information:{" "}
          <a
            className="underline"
            href="https://cloud.google.com/terms/cloud-privacy-notice"
          >
            Google Cloud
          </a>
          ,{" "}
          <a
            className="underline"
            href="https://ai.google.dev/gemini-api/terms"
          >
            Gemini
          </a>
          ,{" "}
          <a
            className="underline"
            href="https://resend.com/legal/privacy-policy"
          >
            Resend
          </a>
          ,{" "}
          <a className="underline" href="https://openai.com/business-data/">
            OpenAI
          </a>
          ,{" "}
          <a
            className="underline"
            href="https://www.anthropic.com/legal/commercial-terms"
          >
            Anthropic
          </a>
          ,{" "}
          <a
            className="underline"
            href="https://cdn.deepseek.com/policies/en-US/deepseek-open-platform-terms-of-service.html"
          >
            DeepSeek
          </a>
          ,{" "}
          <a className="underline" href="https://x.ai/legal/data-processing-addendum">
            xAI
          </a>
          . Provider policies, account plans and locations differ. A working API
          key does not prove zero retention or appropriate data handling.
        </p>
        <p>
          Service-specific processing terms also include the{" "}
          <a
            className="underline"
            href="https://cloud.google.com/terms/data-processing-addendum"
          >
            Google Cloud DPA
          </a>
          ,{" "}
          <a
            className="underline"
            href="https://business.safety.google/processorterms/"
          >
            Google processor terms
          </a>{" "}
          and{" "}
          <a className="underline" href="https://resend.com/legal/dpa">
            Resend DPA
          </a>
          . Linking these documents does not certify that every provider
          arrangement satisfies the laws of your location.
        </p>
        <h2>Voice and camera</h2>
        <p>
          Device checks are local. Starting a voice interview streams your
          microphone audio through our API to Google Gemini, and saves a text
          transcript. The application does not save raw microphone recordings,
          but provider processing and retention are governed separately. Use a
          private space and only your own voice. Text interviews require no
          microphone or camera permission.
        </p>
        <p>
          Camera self-view starts off and remains in your browser. The current
          service does not upload camera frames or accept face-analysis samples.
          It does not use facial geometry, gaze, posture or emotion analysis to
          score your practice. Legacy analysis records from earlier versions are
          covered by the retention controls below.
        </p>
        <h2>Personal model keys</h2>
        <p>
          Your key travels over HTTPS to the service and selected provider for
          validation and use. It is held in memory in the page and is not
          intentionally written to browser storage, transcripts, reports or
          feedback. A temporary encrypted server copy can support reconnection
          and scoring, with a three-hour expiry and earlier removal after
          completion. Personal Gemini keys require your declaration that their
          Google project has paid billing enabled. We cannot independently
          verify that declaration through a normal connection check.
        </p>
        <h2>Feedback and service operation</h2>
        <p>
          Feedback is optional and associated with your account email,
          rating/comment and relevant interview. It is not anonymous. Technical
          context and permission to inspect the related transcript have
          separate, initially unchecked controls. They are not prerequisites for
          practice. Contact us to withdraw optional sharing or delete feedback.
          Deleting only an interview does not delete separately submitted
          feedback; account deletion does.
        </p>
        <p>
          Security and troubleshooting use limited request/usage metadata, such
          as time, request ID, IP address, browser information and error
          category in infrastructure logs. We do not intentionally log
          passwords, resume text, interview content or personal model keys.
          Authorized operators may access records to provide support, handle
          your requests, investigate abuse or maintain the service. We do not
          publish private records as community contributions.
        </p>
        <h2>Purposes and legal grounds</h2>
        <p>
          Where European or UK data-protection law applies, core account and
          requested AI processing supports our agreement with you; proportionate
          security, abuse prevention and service administration support
          legitimate interests. Optional diagnostic and transcript sharing for a support report is based on your consent. You can withdraw that permission by contacting us; withdrawal does not affect earlier lawful processing. Reading this notice
          is not blanket consent for every use of personal information. We do
          not request special-category data or use interview content for
          advertising or our own model training.
        </p>
        <h2>Storage, retention and deletion</h2>
        <p>
          The hosted application database is in the United States. Providers may
          process information in other countries. Provider contracts and any
          applicable international-transfer requirements also matter; US storage
          alone does not establish compliance in your country.
        </p>
        <p>
          Account and interview records remain until you delete them or request
          deletion. A new resume upload replaces the previous upload; older
          standalone reviews and interview-derived content remain until
          separately removed. Settings offers account export and deletion;
          History offers individual interview deletion; Resume offers removal of
          saved resumes and reviews. Removing resumes does not rewrite existing
          interview answers or reports that already incorporated them. Delete
          those interviews separately if needed. Downloads and copies you have
          shared are outside the app’s deletion controls.
        </p>
        <p>
          Verification links expire after 24 hours and reset links after 30
          minutes. Temporary credentials expire after three hours. A minimal,
          pseudonymous eligibility record may remain after account/interview
          deletion until hourly cleanup following seven days from the attempt’s
          start to enforce hosted limits: it contains a keyed email hash,
          attempt ID, funding type and start time, without email text, resume or
          transcript. Hourly maintenance removes expired
          action/credential/eligibility records and raw legacy camera-analysis
          samples older than 30 days. Historical aggregate reports remain with
          their interview until deletion.
        </p>
        <p>
          Configured ordinary Google Cloud logs retain 30 days, while required
          infrastructure audit logs retain 400 days. Automated database backups
          retain seven backup copies; this is a count, not a guaranteed
          seven-day deletion period. Restricted manual release/recovery backups
          may also retain deleted records. These copies are not active interview
          history; complete expiry from every backup is not immediate. Contact
          the operator about a specific deletion request or backup retention.
        </p>
        <h2>Browser storage and tracking</h2>
        <p>
          The app uses browser local/session storage for sign-in, preferences,
          cached resume reviews and recovery of unsaved answers/workspace.
          Logout and account deletion clear private app caches on the current
          browser origin. Another device, alternate hostname, downloaded export
          or browser backup may still hold a copy; clear that site’s storage on
          shared devices.
        </p>
        <p>
          We do not sell personal information, use advertising or cross-site
          behavioral tracking, or embed an analytics SDK in this release. Do Not
          Track and Global Privacy Control signals do not change these
          practices; essential sign-in, preference and recovery storage
          continues to operate. We will explain material changes before
          introducing additional tracking or new data uses.
        </p>
        <h2>Your questions and rights</h2>
        <p>
          You may use the account controls or email the operator for access,
          correction, deletion, withdrawal of optional sharing, or applicable
          rights to portability, restriction or objection. We may
          proportionately verify account ownership; do not send identity
          documents or secrets unless a secure, necessary process has been
          agreed. Depending on your location, you may complain to your
          data-protection authority or appeal a decision. Applicable legal
          response deadlines still apply to requests; support availability does
          not remove them.
        </p>
        <p>
          Material notice changes will be dated here and presented for review
          before further hosted AI use. For private access, accessibility or
          data questions, see{" "}
          <Link href="/help" className="underline">
            Help & support
          </Link>
          . Public GitHub issues are visible to everyone and should never
          include personal records.
        </p>
      </article>
    </AppShell>
  );
}
