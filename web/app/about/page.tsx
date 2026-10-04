import { Button } from "@/components/ui";
import {
  PROJECT,
  ProjectHeading,
  ProjectPage,
} from "@/components/project/Project";
import styles from "@/components/project/project.module.css";

export const metadata = { title: "About the project · mockinterview.live" };

export default function About() {
  return (
    <ProjectPage>
      <ProjectHeading
        eyebrow="About mockinterview"
        title="Explore the project on GitHub."
      >
        mockinterview is an open source AI interviewer with voice and text
        sessions, custom interview formats, and feedback on your answers.
      </ProjectHeading>
      <div className={styles.callout}>
        <h2>Code, issues, and contributions in one place.</h2>
        <p>
          Read the source, follow development, report an issue, or submit a
          change in the project repository. The code is MIT licensed.
        </p>
        <div className={styles.actions}>
          <Button href={PROJECT.github}>View the repository ↗</Button>
        </div>
      </div>
    </ProjectPage>
  );
}
