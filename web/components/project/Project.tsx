import Link from "next/link";
import type { ReactNode } from "react";
import { AppShell } from "@/components/AppShell";
import styles from "./project.module.css";
import { PROJECT } from "@/lib/project";
export { PROJECT } from "@/lib/project";
export { CommunityIcons } from "./CommunityIcons";

export function ProjectPage({ children }: { children: ReactNode }) {
  return (
    <AppShell active="public">
      <div className={styles.project}>{children}</div>
    </AppShell>
  );
}

export function ProjectHeading({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className={styles.pageHeading}>
      <p className="eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      <p className={styles.lead}>{children}</p>
    </div>
  );
}

export function CommunityLinks() {
  return (
    <div className={styles.communityLinks}>
      <a href={PROJECT.github}>
        <span>GitHub</span>
        <small>Explore the code, build with us</small>
        <b aria-hidden="true">↗</b>
      </a>
      <a href={PROJECT.discord}>
        <span>Discord</span>
        <small>Ask questions, meet contributors</small>
        <b aria-hidden="true">↗</b>
      </a>
      <a href={PROJECT.reddit}>
        <span>Reddit</span>
        <small>Share ideas and practice stories</small>
        <b aria-hidden="true">↗</b>
      </a>
    </div>
  );
}

export function ProjectResources() {
  return (
    <nav aria-label="Project resources" className={styles.resourceLinks}>
      <Link href="/get-started">Get started →</Link>
      <Link href="/docs">Documentation →</Link>
      <Link href="/updates">Release notes →</Link>
    </nav>
  );
}
