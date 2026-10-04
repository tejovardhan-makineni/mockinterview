import Link from "next/link";
import { Button } from "@/components/ui";
import {
  CommunityLinks,
  PROJECT,
  ProjectHeading,
  ProjectPage,
  ProjectResources,
} from "@/components/project/Project";
import styles from "@/components/project/project.module.css";
export const metadata = { title: "Contribute · mockinterview.live" };
export default function Contribute() {
  return (
    <ProjectPage>
      <ProjectHeading eyebrow="Built together" title="Help someone practice.">
        Your experience can make the next interview more useful. You don’t need
        to write code to contribute to this MIT-licensed project.
      </ProjectHeading>
      <div className={styles.cardGrid}>
        {[
          {
            title: "Share your experience",
            body: "Try an interview, complete the short check-in, and tell us what helped or got in your way. Private feedback reaches the administrator; it does not become a public testimonial.",
            href: "/feedback",
            label: "Share feedback",
          },
          {
            title: "Add a scenario",
            body: "Turn your professional knowledge into an original task with useful follow-ups and a fair rubric. Review existing scenarios or request a template you wish we had.",
            href: PROJECT.github + "/blob/main/docs/CORPUS.md",
            label: "Read the scenario guide",
          },
          {
            title: "Improve the experience",
            body: "Fix a bug, simplify the docs, test keyboard access, or contribute a focused change. Keep personal interview content and keys out of public issues.",
            href: PROJECT.github + "/blob/main/CONTRIBUTING.md",
            label: "Read the contributor guide",
          },
        ].map((x) => (
          <article className={styles.card} key={x.title}>
            <h3 className="!mt-0">{x.title}</h3>
            <p>{x.body}</p>
            <Link className={styles.textLink} href={x.href}>
              {x.label} →
            </Link>
          </article>
        ))}
      </div>
      <section className={styles.section}>
        <div className={styles.runPanel}>
          <div>
            <p className="eyebrow">Help shape the beta</p>
            <h2>
              More practice.
              <br />A closer feedback loop.
            </h2>
            <p className={styles.sectionIntro}>
              Apply to become a beta tester and agree to share useful product
              feedback. Approved testers get unlimited interview starts.
              Approval is reviewed by the administrator.
            </p>
            <div className={styles.actions}>
              <Button href="/beta">Apply for beta testing →</Button>
            </div>
          </div>
          <div>
            <p className="eyebrow">Something missing?</p>
            <h3 className="mt-3 text-xl font-semibold">
              Ask for the practice you need.
            </h3>
            <p className={styles.sectionIntro}>
              Tell us the profession, level and kind of interview you want to
              practice. Template requests are private notes to the
              administrator, and help guide what the community builds next.
            </p>
            <Link href="/requests" className={styles.textLink}>
              Request a template →
            </Link>
            <p className={styles.fine}>
              You can also create a custom interview now from your own questions
              and goals.
            </p>
          </div>
        </div>
      </section>
      <section className={styles.section}>
        <h2>Find your place in the community.</h2>
        <CommunityLinks />
      </section>
      <ProjectResources />
    </ProjectPage>
  );
}
