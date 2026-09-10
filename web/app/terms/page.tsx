import { AppShell } from "@/components/AppShell";
import Link from "next/link";
export default function Terms() {
  return (
    <AppShell active="public">
      <article className="prose-page mx-auto">
        <p className="eyebrow">Before you practice</p>
        <h1 className="page-title mt-3">Using mockinterview</h1>
        <h2>A practice environment</h2>
        <p>
          This is an AI interview simulator and learning tool. Interviewers are
          synthetic characters. Generated questions and feedback can be
          incomplete or incorrect. Scores are practice observations, not hiring
          decisions, job guarantees, licensure assessments or professional
          advice.
        </p>
        <h2>Use your own material responsibly</h2>
        <p>
          Provide only material you are permitted to use. Do not upload
          confidential employer questions, private client or patient records, or
          someone else’s API credentials. Use fictional or anonymized examples
          when discussing sensitive work.
        </p>
        <h2>Hosted access and model costs</h2>
        <p>
          The hosted service offers one platform-funded attempt per rolling
          seven days, with a shared limit of one hosted attempt per rolling 24
          hours across funding modes. The setup screen shows eligibility and
          next-start times. Reconnecting to the same recoverable interview or
          retrying report generation does not create a new attempt. Your
          provider may charge for personal-key usage.
        </p>
        <h2>Community formats</h2>
        <p>
          Community preview scenarios have not been presented as independently
          reviewed. Company-style practice paths approximate interview patterns
          and are not affiliated with, or guaranteed to match, any employer’s
          hiring process.
        </p>
        <h2>Open source and your records</h2>
        <p>
          The application’s source-code license governs use and redistribution
          of the code. Your private interview records are not public
          contributions. Contributing a scenario or opening a public issue is a
          separate, intentional action.
        </p>
        <h2>Help when something goes wrong</h2>
        <p>
          Technical interruptions should leave a visible recovery option. If you
          cannot recover an attempt or access your records, use{" "}
          <Link href="/help" className="underline">
            Help & support
          </Link>
          . Review{" "}
          <Link href="/privacy" className="underline">
            Privacy & your data
          </Link>{" "}
          before uploading material.
        </p>
      </article>
    </AppShell>
  );
}
