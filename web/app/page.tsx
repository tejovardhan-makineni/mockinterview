import Link from "next/link";
import { Button } from "@/components/ui";
import {
  CommunityLinks,
  PROJECT,
  ProjectPage,
  ProjectResources,
} from "@/components/project/Project";
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
            Interview practice should be available to everyone. An open source
            AI interviewer to help you think out loud, learn from feedback, and
            try again.
          </p>
          <div className={styles.actions}>
            <Button href="/interviews">Start practicing →</Button>
            <Button href="/get-started" variant="ghost">
              Run it locally
            </Button>
          </div>
          <p className={styles.fine}>
            One free interview a day. Your own API key unlocks more.
          </p>
          <a className={styles.textLink} href={PROJECT.github}>
            Explore the source on GitHub ↗
          </a>
        </div>
        <div
          className={styles.preview}
          aria-label="Illustrative interview conversation"
        >
          <div className={styles.previewTop}>
            <span>mockinterview / practice room</span>
            <span>Example</span>
          </div>
          <div className={styles.previewBody}>
            <span className={styles.previewLabel}>Your AI interviewer</span>
            <h2>
              “What did you consider, and why did you choose that approach?”
            </h2>
            <div className={styles.answer}>
              A space to explain your thinking.
              <br />A follow-up that goes a little deeper.
              <br />
              Feedback you can put into practice.
            </div>
            <div className={styles.previewTools}>
              <span>Speak or type</span>
              <span>Sketch an idea</span>
              <span>Review your code</span>
            </div>
          </div>
          <div className={styles.previewNote}>
            Your profession. Your level. Your learning goal.
            <br />
            Choose a template, or create a practice interview of your own.
          </div>
        </div>
      </section>
      <div className={styles.principles}>
        <span>MIT licensed</span>
        <span>Run on your computer</span>
        <span>Bring your own model</span>
        <span>Built with the community</span>
      </div>
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
            <p className="eyebrow">A project, not just a product</p>
            <h2>Make practice better for someone.</h2>
          </div>
        </div>
        <p className={styles.sectionIntro}>
          A clearer question. An accessibility fix. An honest bug report. You
          don’t have to write code to help more people practice with confidence.
        </p>
        <CommunityLinks />
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
      <section className={styles.section}>
        <div className={styles.story}>
          <div>
            <p className="eyebrow">What people say</p>
            <h2>Let’s write this part together.</h2>
          </div>
          <div>
            <h3>Your experience belongs in the conversation.</h3>
            <p>
              We’re collecting stories from people who use the project. No
              published testimonials yet. Share what helped, what felt off, and
              what you’d like to practice next.
            </p>
            <a href={PROJECT.reddit} className={styles.textLink}>
              Join the conversation ↗
            </a>
            <p className={styles.fine}>
              Private product feedback stays private. We ask permission before
              publishing a testimonial.
            </p>
          </div>
        </div>
      </section>
      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <div>
            <p className="eyebrow">Building in the open</p>
            <h2>What’s changing.</h2>
          </div>
          <Link href="/updates" className={styles.textLink}>
            All release notes →
          </Link>
        </div>
        <article className={styles.release}>
          <div>
            <span className={styles.releaseState}>In this source update</span>
          </div>
          <div>
            <h3>Open source, from the front door.</h3>
            <p>
              A new project home, simpler local setup, custom practice, personal
              model choices, and a closer feedback loop with the community.
            </p>
          </div>
        </article>
      </section>
      <ProjectResources />
      <p className={styles.fine}>
        Made by Tejovardhan Makineni and open to contributors. AI practice for
        adults 18+; feedback is a learning aid, not a hiring decision.
      </p>
    </ProjectPage>
  );
}
