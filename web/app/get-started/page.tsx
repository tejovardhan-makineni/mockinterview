import Link from "next/link";
import { Button } from "@/components/ui";
import { LocalSetup } from "@/components/project/LocalSetup";
import {
  PROJECT,
  ProjectHeading,
  ProjectPage,
  ProjectResources,
} from "@/components/project/Project";
import styles from "@/components/project/project.module.css";
export const metadata = {
  title: "Get started · mockinterview.live",
  description:
    "Practice in your browser or run the open source interview app on macOS, Windows, and Linux.",
};
export default function GetStarted() {
  return (
    <ProjectPage>
      <ProjectHeading
        eyebrow="Get started"
        title="Your next practice starts here."
      >
        Practice in your browser, use the desktop app with your own AI key, or
        build a local copy from source.
      </ProjectHeading>
      <div className={styles.docsGrid}>
        <article className={styles.card}>
          <span className={styles.cardNumber}>01 / In your browser</span>
          <h3>Just bring yourself.</h3>
          <p>
            Sign up, verify your email, and choose an interview. One funded
            interview every 24 hours, using Gemini 2.5 Flash. A short check-in
            helps us improve your next one.
          </p>
          <div className={styles.actions}>
            <Button href="/interviews">Find an interview →</Button>
            <Button href="/login" variant="ghost">
              Sign in / sign up
            </Button>
          </div>
        </article>
        <article className={styles.card}>
          <span className={styles.cardNumber}>02 / With your own model</span>
          <h3>Your key. More practice.</h3>
          <p>
            Choose a supported provider and model in interview setup, paste your
            key, and validate it before starting. Personal keys remove the daily
            interview limit; your provider’s charges and limits apply.
          </p>
          <Link href="/docs#models" className={styles.textLink}>
            Models and voice explained →
          </Link>
        </article>
      </div>
      <section className={styles.section}>
        <div className={styles.callout}>
          <h2>Prefer a desktop app?</h2>See the available macOS, Windows and
          Linux packages on our download page. The desktop app saves history
          locally and requires your own AI key.
          <div className={styles.actions}>
            <Button href="/downloads">Desktop downloads →</Button>
          </div>
        </div>
      </section>
      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <div>
            <p className="eyebrow">03 / On your computer</p>
            <h2>For contributors: run from source.</h2>
          </div>
        </div>
        <LocalSetup />
      </section>
      <section className={styles.section}>
        <div className={styles.docsGrid}>
          <article className={styles.card}>
            <span className={styles.cardNumber}>Keep your progress</span>
            <h3>Add a local database.</h3>
            <p>
              Install PostgreSQL 16, create a database, and set DATABASE_URL in
              your .env file. Run the launcher with --persistent to save
              accounts, interview results and feedback between restarts.
            </p>
            <a
              href={
                PROJECT.github +
                "/blob/main/docs/LOCAL-SETUP.md#keep-history-with-postgresql"
              }
              className={styles.textLink}
            >
              Persistent setup for your OS ↗
            </a>
          </article>
          <article className={styles.card}>
            <span className={styles.cardNumber}>Turn on real AI</span>
            <h3>Add a provider key.</h3>
            <p>
              Copy .env.example to .env and set your provider’s key, or bring a
              personal key in interview setup. Real AI uses your provider
              account. Native voice currently needs Gemini.
            </p>
            <a
              href={PROJECT.github + "/blob/main/.env.example"}
              className={styles.textLink}
            >
              Configuration reference ↗
            </a>
          </article>
        </div>
      </section>
      <div className={styles.section}>
        <div className={styles.callout}>
          <h2>A local web app, on every platform.</h2>These instructions run the
          app in your browser. Desktop package availability is listed on the
          Downloads page. Local demo data is temporary; choose PostgreSQL for
          durable history. Optional analytics sharing is separate from your
          local history.
        </div>
      </div>
      <ProjectResources />
    </ProjectPage>
  );
}
