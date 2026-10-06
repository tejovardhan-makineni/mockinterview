import Link from "next/link";
import {
  PROJECT,
  ProjectHeading,
  ProjectPage,
  ProjectResources,
} from "@/components/project/Project";
import styles from "@/components/project/project.module.css";
export const metadata = {
  title: "Documentation · mockinterview.live",
  description:
    "How to practice, configure models, run locally, contribute and deploy mockinterview.",
};
const groups = [
  {
    title: "Start practicing",
    text: "Choose a template or describe your own interview, then practice with voice or text.",
    links: [
      ["Get started", "/get-started"],
      ["Desktop downloads", "/downloads"],
      ["Explore interview templates", "/interviews"],
      ["Microphone, connection and account help", "/help"],
      ["Request a new template", "/requests"],
    ],
  },
  {
    title: "Run and contribute",
    text: "Build your own copy and help make interview practice useful for more people.",
    links: [
      [
        "Local setup: macOS, Windows and Linux",
        PROJECT.github + "/blob/main/docs/LOCAL-SETUP.md",
      ],
      ["Contributor guide", PROJECT.github + "/blob/main/CONTRIBUTING.md"],
      [
        "Author a scenario or format",
        PROJECT.github + "/blob/main/docs/CORPUS.md",
      ],
      ["Release notes", "/updates"],
    ],
  },
  {
    title: "Understand the system",
    text: "Read the design, data contracts and operational checks behind the application.",
    links: [
      [
        "System architecture",
        PROJECT.github + "/blob/main/docs/ARCHITECTURE.md",
      ],
      [
        "Database and feature design",
        PROJECT.github + "/blob/main/docs/OPEN-SOURCE-DESIGN.md",
      ],
      [
        "Deployment and rollback",
        PROJECT.github + "/blob/main/docs/RELEASE-RUNBOOK.md",
      ],
      [
        "Feedback metric definitions",
        PROJECT.github + "/blob/main/docs/FEEDBACK-METRICS.md",
      ],
    ],
  },
  {
    title: "Community and privacy",
    text: "Help test the beta, understand your controls, or contact the maintainer.",
    links: [
      ["Apply for beta access", "/beta"],
      ["Share product feedback", "/feedback"],
      ["Privacy and data controls", "/privacy"],
      ["Who is behind the project", "/about"],
    ],
  },
];
export default function Docs() {
  return (
    <ProjectPage>
      <ProjectHeading eyebrow="Documentation" title="A good place to begin.">
        From your first practice to your first contribution. Find the short
        guide, then go deeper when you need to.
      </ProjectHeading>
      <div className={styles.docsGrid}>
        {groups.map((g) => (
          <article className={styles.card} key={g.title}>
            <h3 className="!mt-0">{g.title}</h3>
            <p>{g.text}</p>
            <ul className={styles.docList}>
              {g.links.map(([label, href]) => (
                <li key={href}>
                  <Link href={href}>{label} ↗</Link>
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>
      <section id="models" className={styles.section}>
        <p className="eyebrow">Models, keys and voice</p>
        <h2>Choose the model for your practice.</h2>
        <div className={styles.docsGrid + " mt-6"}>
          <article className={styles.card}>
            <h3 className="!mt-0">Hosted or personal</h3>
            <p>
              The free hosted interview uses Gemini 3.8 Flash for text and
              feedback. Each account gets one free interview; the project funds
              up to 200 interviews per UTC day. Personal-key setup supports
              Gemini, OpenAI, Anthropic, DeepSeek, xAI and Meta. Available
              models depend on your provider account; validate your selection
              before starting.
            </p>
            <p className="mt-3">
              Your key is sent securely to the API, encrypted for the active
              interview, and expires. It is not saved in browser storage.
              Validation can make a small billable request.
            </p>
          </article>
          <article className={styles.card}>
            <h3 className="!mt-0">Know what powers the session</h3>
            <p>
              Native live voice uses Gemini’s audio model. Other providers
              support text interviews and feedback; selecting one does not
              switch the voice engine. Use text when you want practice entirely
              on your selected provider.
            </p>
            <p className="mt-3">
              Your selected provider and model stay attached to the attempt and
              its feedback. Provider limits, model availability and charges
              still apply when daily app limits do not.
            </p>
          </article>
        </div>
      </section>
      <section className={styles.section}>
        <div className={styles.callout}>
          <h2>Share analytics. Help improve practice.</h2>Analytics sharing is
          on by default and can be turned off in Settings. Shared interview
          results and diagnostics help the administrator improve the app; they
          are not public testimonials. The privacy page explains the details.
          Local sharing needs a reachable API and your consent; a failed upload
          does not block local practice.
        </div>
      </section>
      <ProjectResources />
    </ProjectPage>
  );
}
