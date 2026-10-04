import Link from "next/link";
import { Button } from "@/components/ui";
import { ProjectPage } from "@/components/project/Project";
import { CommunityIcons } from "@/components/project/CommunityIcons";
import { Testimonials } from "@/components/project/Testimonials";
import { InterviewShowcase } from "@/components/project/InterviewShowcase";
import styles from "@/components/project/project.module.css";

export default function Home() {
  return (
    <ProjectPage>
      <section className={styles.hero}>
        <div>
          <span className={styles.badge}>
            <span className={styles.dot} /> Open source · MIT licensed
          </span>
          <h1>
            Better interviews.
            <br />
            <em>Built together.</em>
          </h1>
          <p className={styles.lead}>
            An open source AI interviewer for voice and text practice, custom
            questions, and feedback on your answers.
          </p>
          <div className={styles.actions}>
            <Button href="/interviews">Start practicing →</Button>
            <Button href="/get-started" variant="ghost">
              Run it locally
            </Button>
          </div>
          <CommunityIcons className="mt-5" />
        </div>
        <InterviewShowcase />
      </section>
      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <div>
            <p className="eyebrow">Practice is a skill</p>
            <h2>A useful loop, every time.</h2>
          </div>
          <Link href="/docs" className={styles.textLink}>
            See how it works →
          </Link>
        </div>
        <div className={styles.cardGrid}>
          {[
            {
              n: "01 / Prepare",
              title: "Make it your interview",
              body: "Pick a community template or describe your profession, goal, level, questions and structure. Your AI interviewer uses that context to guide the session.",
              link: "/interviews",
              label: "Explore practice",
            },
            {
              n: "02 / Practice",
              title: "Make room for your thinking",
              body: "Speak or type, work through a problem, and respond to follow-ups. Use text with your selected model; Gemini also supports live voice.",
              link: "/get-started",
              label: "Choose your setup",
            },
            {
              n: "03 / Improve",
              title: "Find your next small step",
              body: "Review feedback grounded in your answers, return to saved attempts, and tell us what worked. Your experience helps make the project better.",
              link: "/feedback",
              label: "Share feedback",
            },
          ].map((x) => (
            <article className={styles.card} key={x.n}>
              <span className={styles.cardNumber}>{x.n}</span>
              <h3>{x.title}</h3>
              <p>{x.body}</p>
              <Link href={x.link} className={styles.textLink}>
                {x.label} →
              </Link>
            </article>
          ))}
        </div>
      </section>
      <section className={styles.section}>
        <div className={styles.runPanel}>
          <div>
            <p className="eyebrow">Your computer. Your copy.</p>
            <h2>
              Start small.
              <br />
              Build what you need.
            </h2>
            <p className={styles.sectionIntro}>
              A Docker-free local demo for macOS, Windows and Linux. Add
              PostgreSQL for lasting history, or run the complete web app with
              Docker.
            </p>
            <Link href="/get-started" className={styles.textLink}>
              Installation and setup →
            </Link>
          </div>
          <div>
            <pre className={styles.code}>
              <code>
                <span className={styles.codeComment}>
                  # With Git, Node.js 22 and Go installed
                </span>
                {
                  "\ngit clone https://github.com/tejovardhan-makineni/mockinterview.git\ncd mockinterview\nnode scripts/local.mjs"
                }
              </code>
            </pre>
            <p className={styles.fine}>
              Demo data resets on exit. No provider key needed.
            </p>
          </div>
        </div>
      </section>
      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <div>
            <p className="eyebrow">Contribute</p>
            <h2>Help shape the next version.</h2>
          </div>
        </div>
        <p className={styles.sectionIntro}>
          Contribute code, improve interview templates, test accessibility, or
          share feedback.
        </p>
        <div className={styles.actions}>
          <Button href="/contribute" variant="ghost">
            Ways to contribute →
          </Button>
          <Button href="/beta" variant="ghost">
            Join beta testing →
          </Button>
        </div>
        <p className={styles.fine}>
          Approved beta testers get unlimited interviews and agree to share
          feedback.
        </p>
      </section>
      <Testimonials />
    </ProjectPage>
  );
}
