import {
  PROJECT,
  ProjectHeading,
  ProjectPage,
  ProjectResources,
} from "@/components/project/Project";
import styles from "@/components/project/project.module.css";
export const metadata = { title: "Release notes · mockinterview.live" };
export default function Updates() {
  return (
    <ProjectPage>
      <ProjectHeading
        eyebrow="Updates & release notes"
        title="Small improvements. In the open."
      >
        What changed, why it matters, and where to inspect the details. Source
        updates and verified hosted releases are labeled separately.
      </ProjectHeading>
      <article className={styles.release}>
        <div>
          <span className={styles.releaseState}>
            October 4, 2026 · project release
          </span>
        </div>
        <div>
          <h3>A more open, more personal practice experience</h3>
          <p>
            This project update makes it easier to discover, run and
            contribute to mockinterview.
          </p>
          <ul>
            <li>
              A project-first home, documentation, community links and MIT
              licensing.
            </li>
            <li>
              A Docker-free local demo on macOS, Windows and Linux, with
              optional persistent PostgreSQL.
            </li>
            <li>
              One funded interview per day and unlimited personal-key practice.
            </li>
            <li>
              Custom interviews built from your profession, goals, level,
              questions and structure.
            </li>
            <li>
              Beta applications, private template requests and administrator
              review.
            </li>
            <li>
              Optional analytics sharing and feedback throughout the practice
              experience.
            </li>
          </ul>
          <p className="mt-4">
            Available in the hosted web app and source checkout. Local setup
            uses Node.js and Go; signed desktop installers are not included.
          </p>
          <a
            href={PROJECT.github + "/blob/main/CHANGELOG.md"}
            className={styles.textLink}
          >
            Read the full changelog ↗
          </a>
        </div>
      </article>
      <article className={styles.release}>
        <time dateTime="2026-09-14">September 14, 2026</time>
        <div>
          <span className={styles.releaseState}>Recorded hosted release</span>
          <h3>More professions, more ways to practice</h3>
          <p>
            The interview bank expanded to 185 scenarios, with career families,
            specialized interviewer profiles and practice paths. The release
            record documents the deployed artifacts and validation.
          </p>
          <a
            href={
              PROJECT.github +
              "/blob/main/docs/INTERVIEW-BANK-RELEASE-2026-09-14.md"
            }
            className={styles.textLink}
          >
            Release record ↗
          </a>
        </div>
      </article>
      <article className={styles.release}>
        <time dateTime="2026-09-13">September 13, 2026</time>
        <div>
          <span className={styles.releaseState}>Recorded hosted release</span>
          <h3>Microphone readiness and tester access</h3>
          <p>
            Improved microphone checks and unlimited access for approved
            testers. Tester access is separate from the administrator role.
          </p>
          <a
            href={
              PROJECT.github +
              "/blob/main/docs/MICROPHONE-TESTERS-RELEASE-2026-09-13.md"
            }
            className={styles.textLink}
          >
            Release record ↗
          </a>
        </div>
      </article>
      <article className={styles.release}>
        <time dateTime="2026-09-10">September 10, 2026</time>
        <div>
          <span className={styles.releaseState}>Recorded hosted release</span>
          <h3>Clearer consent and data controls</h3>
          <p>
            Policy acknowledgment, adult access, voice-processing notice, and
            controls for resume and account data.
          </p>
          <a
            href={
              PROJECT.github +
              "/blob/main/docs/RELEASE-VALIDATION-2026-09-10.md"
            }
            className={styles.textLink}
          >
            Release record ↗
          </a>
        </div>
      </article>
      <ProjectResources />
    </ProjectPage>
  );
}
