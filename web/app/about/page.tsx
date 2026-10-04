import { Button } from "@/components/ui";
import {
  CommunityLinks,
  PROJECT,
  ProjectHeading,
  ProjectPage,
  ProjectResources,
} from "@/components/project/Project";
import styles from "@/components/project/project.module.css";
export const metadata = { title: "About the project · mockinterview.live" };
export default function About() {
  return (
    <ProjectPage>
      <ProjectHeading
        eyebrow="Behind the project"
        title="Practice should be something we share."
      >
        mockinterview is an open source project by Tejovardhan Makineni, built
        to make thoughtful interview practice available to more people.
      </ProjectHeading>
      <div className={styles.docsGrid}>
        <article className={styles.card}>
          <span className={styles.cardNumber}>The idea</span>
          <h3>Confidence comes from practice.</h3>
          <p>
            Explaining a decision, asking a clarifying question, recovering
            after a difficult answer: these are skills we can train. We’re
            building a place to try, reflect, and try again, across professions
            and experience levels.
          </p>
        </article>
        <article className={styles.card}>
          <span className={styles.cardNumber}>The approach</span>
          <h3>Open code. Shared progress.</h3>
          <p>
            Read the code, run your own copy, adapt a template, or contribute a
            better experience. The project uses the MIT license. Contributions
            can be code, writing, accessibility testing, feedback, or
            professional knowledge.
          </p>
        </article>
      </div>
      <section className={styles.section}>
        <div className={styles.story}>
          <div>
            <p className="eyebrow">A personal project, open to everyone</p>
            <h2>Made by Tejovardhan Makineni.</h2>
          </div>
          <div>
            <p>
              The project exists to share useful technology and make interview
              practice more accessible. The next version will be better because
              someone tried it, noticed something, and helped.
            </p>
            <div className={styles.actions}>
              <Button
                href="https://github.com/tejovardhan-makineni"
                variant="ghost"
              >
                Meet the maintainer ↗
              </Button>
              <Button href="/contribute" variant="ghost">
                Become a contributor →
              </Button>
            </div>
          </div>
        </div>
      </section>
      <section className={styles.section}>
        <p className="eyebrow">Our commitments</p>
        <div className={styles.cardGrid + " mt-5"}>
          {[
            {
              title: "Be honest about AI",
              text: "Your interviewer is AI. Feedback can be incomplete or wrong. Community templates are practice material, not employer questions or a hiring decision.",
            },
            {
              title: "Keep feedback private",
              text: "Product feedback and consented analytics are for administrator review. They are not published as stories or testimonials without separate permission.",
            },
            {
              title: "Build in the open",
              text: "Public source, documented setup, and readable release notes. Dependencies keep their own licenses and attribution.",
            },
          ].map((x) => (
            <article className={styles.card} key={x.title}>
              <h3 className="!mt-0">{x.title}</h3>
              <p>{x.text}</p>
            </article>
          ))}
        </div>
      </section>
      <section className={styles.section}>
        <h2>Come build with us.</h2>
        <CommunityLinks />
        <a
          className={styles.textLink}
          href={PROJECT.github + "/blob/main/LICENSE"}
        >
          Read the MIT license ↗
        </a>
      </section>
      <ProjectResources />
    </ProjectPage>
  );
}
