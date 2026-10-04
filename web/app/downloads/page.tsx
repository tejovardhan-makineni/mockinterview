import Link from "next/link";
import { Button } from "@/components/ui";
import {
  ProjectHeading,
  ProjectPage,
  PROJECT,
  CommunityIcons,
} from "@/components/project/Project";
import { DESKTOP_RELEASE, RELEASES_URL } from "@/lib/downloads";
import styles from "@/components/project/project.module.css";

export const metadata = {
  title: "Download · mockinterview",
  description:
    "Desktop interview practice for macOS, Windows and Linux. Bring your own AI key and keep your interviews on your computer.",
};
export default function Downloads() {
  return (
    <ProjectPage>
      <ProjectHeading
        eyebrow="Desktop app"
        title="Your practice. On your computer."
      >
        The same interview room, custom questions and feedback, with history
        saved locally. Bring your own AI key; desktop downloads do not include
        free interviews.
      </ProjectHeading>
      <div className={styles.cardGrid}>
        {(
          [
            { platform: "mac", name: "macOS" },
            { platform: "windows", name: "Windows" },
            { platform: "linux", name: "Linux" },
          ] as const
        ).map(({ platform, name }) => {
          const assets =
            DESKTOP_RELEASE?.assets.filter(
              (asset) => asset.platform === platform,
            ) || [];
          return (
            <article key={platform} className={styles.card}>
              <span className={styles.cardNumber}>{name}</span>
              <h3>
                {assets.length
                  ? "Download the app"
                  : "Installer in preparation"}
              </h3>
              <p>
                {assets.length
                  ? `Release ${DESKTOP_RELEASE!.tag}. Install, open, and connect your AI provider.`
                  : "A verified installer for this platform has not been published here yet."}
              </p>
              <div className={styles.actions}>
                {assets.length ? (
                  assets.map((asset) => (
                    <Button key={asset.url} href={asset.url}>
                      {asset.label} ↓
                    </Button>
                  ))
                ) : (
                  <Button href={RELEASES_URL} variant="ghost">
                    Check GitHub releases ↗
                  </Button>
                )}
              </div>
            </article>
          );
        })}
      </div>
      <section className={styles.section}>
        <div className={styles.docsGrid}>
          <article className={styles.card}>
            <h3 className="!mt-0">Install once. Keep practicing.</h3>
            <ol className="mt-4 list-decimal space-y-3 pl-5 text-sm">
              <li>
                Download the package for your operating system and install it.
              </li>
              <li>
                Open the app and validate your provider key in Settings or
                interview setup.
              </li>
              <li>
                Choose a template or create a custom interview. History and
                reports stay on your computer.
              </li>
            </ol>
            <p>
              Cloud models need internet and your provider may charge for usage.
              Gemini supports voice; other providers support text.
            </p>
          </article>
          <article className={styles.card}>
            <h3 className="!mt-0">Sharing is your choice.</h3>
            <p>
              Analytics starts off. Connect a hosted account and enable “Share
              analytics” to help the admin improve practice. Sharing interview
              results is a separate choice. Failed uploads never block your
              local practice.
            </p>
            <p>
              Keys are kept in memory for the current app session (until close
              or reload). Reopen the app, add your key, and pick up your saved
              work.
            </p>
            <Link href="/privacy" className={styles.textLink}>
              Privacy and data controls →
            </Link>
          </article>
        </div>
      </section>
      <section className={styles.section}>
        <div className={styles.callout}>
          <h2>Downloads live on GitHub.</h2>GitHub Releases hosts the installer
          files. This page links to verified release assets; the website remains
          the hosted app. Browse release notes and source, report issues, or
          help build the next version.
          <div className={styles.actions}>
            <Button href={RELEASES_URL} variant="ghost">
              Releases & source ↗
            </Button>
            <Button
              href={PROJECT.github + "/blob/main/docs/LOCAL-SETUP.md"}
              variant="ghost"
            >
              Build from source ↗
            </Button>
          </div>
          <CommunityIcons className="mt-4" />
        </div>
      </section>
      <p className={styles.fine}>
        Prefer your browser? The hosted app includes one free interview every 24
        hours for standard accounts. Personal keys and approved beta access have
        separate limits.
      </p>
    </ProjectPage>
  );
}
