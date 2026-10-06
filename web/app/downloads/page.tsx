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
        eyebrow="Desktop beta"
        title="Your practice. On your computer."
      >
        The same interview room, custom questions and feedback, with history
        saved locally. Bring your own AI key; desktop downloads do not include
        free interviews. This project is still in beta on web, macOS, Ubuntu and
        Windows.
      </ProjectHeading>
      <div className={styles.cardGrid}>
        {(
          [
            {
              platform: "mac",
              name: "macOS",
              pending: "Awaiting Apple signing",
              detail:
                "The macOS app is built. Downloads open after Developer ID signing and Apple notarization are complete.",
            },
            {
              platform: "windows",
              name: "Windows",
              pending: "Awaiting publisher signing",
              detail:
                "The Windows app is built. Downloads open after its publisher certificate and installer signature are verified.",
            },
            {
              platform: "linux",
              name: "Ubuntu / Linux",
              pending: "Release verification pending",
              detail:
                "Linux packages are built. Downloads open when native runtime checks and published file hashes are verified.",
            },
          ] as const
        ).map(({ platform, name, pending, detail }) => {
          const assets =
            DESKTOP_RELEASE?.assets.filter(
              (asset) => asset.platform === platform,
            ) || [];
          const tag = assets[0]?.tag || DESKTOP_RELEASE?.tag;
          const preview = assets[0]?.prerelease ?? DESKTOP_RELEASE?.prerelease;
          return (
            <article key={platform} className={styles.card}>
              <span className={styles.cardNumber}>{name}</span>
              <h3>
                {assets.length
                  ? preview
                    ? "Download the beta"
                    : "Download the app"
                  : pending}
              </h3>
              <p>
                {assets.length
                  ? `Version ${tag?.replace(/^desktop-v/, "")}. Install, open, and connect your AI provider.`
                  : detail}
              </p>
              <div className={styles.actions}>
                {assets.length ? (
                  assets.map((asset) => (
                    <Button key={asset.url} href={asset.url}>
                      {asset.label} ↓
                    </Button>
                  ))
                ) : (
                  <Button href="/interviews" variant="ghost">
                    Practice in your browser →
                  </Button>
                )}
              </div>
              {assets.length > 0 && (
                <p className="text-sm">
                  <a
                    className={styles.textLink}
                    href={`${RELEASES_URL}/tag/${tag}`}
                  >
                    Release notes and checksums ↗
                  </a>
                </p>
              )}
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
              Share analytics starts on and can be turned off in Settings.
              Desktop uploads require a connected hosted account. Sharing
              interview results is a separate choice.
            </p>
            <p>
              Your model connection resets when you close or reload the app.
              Saved interviews remain available; add your key to start new
              practice.
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
        Prefer your browser? Each account gets one free interview. The project
        funds up to 200 interviews per UTC day, including approved tester
        sessions. Personal-key practice has no product interview limit.
      </p>
    </ProjectPage>
  );
}
