"use client";
import { useRef, useState } from "react";
import styles from "./project.module.css";

const platforms = ["macOS", "Windows", "Linux", "Docker"] as const;
type Platform = (typeof platforms)[number];
const source =
  "git clone https://github.com/tejovardhan-makineni/mockinterview.git\ncd mockinterview";
const commands: Record<Platform, string> = {
  macOS: `${source}\nnode scripts/local.mjs`,
  Windows: `${source}\nnode scripts/local.mjs`,
  Linux: `${source}\nnode scripts/local.mjs`,
  Docker: `${source}\n# macOS / Linux / Git Bash:\ncp .env.example .env\n# PowerShell instead: Copy-Item .env.example .env\ndocker compose --profile app up --build`,
};

export function LocalSetup() {
  const [platform, setPlatform] = useState<Platform>("macOS");
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const choose = (next: Platform) => {
    setPlatform(next);
    setCopied(false);
    setCopyError(false);
  };
  return (
    <div className={styles.setupPanel}>
      <div
        className={styles.tabs}
        role="tablist"
        aria-label="Local setup platform"
      >
        {platforms.map((p, i) => (
          <button
            key={p}
            ref={(el) => {
              tabRefs.current[i] = el;
            }}
            id={`platform-${p}`}
            role="tab"
            type="button"
            aria-selected={platform === p}
            aria-controls="local-setup-panel"
            tabIndex={platform === p ? 0 : -1}
            onClick={() => choose(p)}
            onKeyDown={(e) => {
              let n = i;
              if (e.key === "ArrowRight") n = (i + 1) % platforms.length;
              else if (e.key === "ArrowLeft")
                n = (i + platforms.length - 1) % platforms.length;
              else if (e.key === "Home") n = 0;
              else if (e.key === "End") n = platforms.length - 1;
              else return;
              e.preventDefault();
              choose(platforms[n]);
              tabRefs.current[n]?.focus();
            }}
          >
            {p}
          </button>
        ))}
      </div>
      <div
        className={styles.setupBody}
        role="tabpanel"
        id="local-setup-panel"
        aria-labelledby={`platform-${platform}`}
        tabIndex={0}
      >
        <h3>
          {platform === "Docker"
            ? "The complete web stack, in containers."
            : `Run the local web app on ${platform}.`}
        </h3>
        <p>
          {platform === "Docker" ? (
            <>
              Install{" "}
              <a
                className="underline"
                href="https://docs.docker.com/get-started/get-docker/"
              >
                Docker with Compose
              </a>{" "}
              and Git. Start Docker before running these commands.
            </>
          ) : (
            <>
              Install{" "}
              <a className="underline" href="https://git-scm.com/downloads">
                Git
              </a>
              ,{" "}
              <a className="underline" href="https://nodejs.org/en/download">
                Node.js 22 with npm 10
              </a>
              , and{" "}
              <a className="underline" href="https://go.dev/dl/">
                Go 1.26.8 or newer
              </a>
              . Open {platform === "Windows" ? "PowerShell" : "Terminal"} and
              run:
            </>
          )}
        </p>
        <div className={styles.codeWrap}>
          <button
            type="button"
            className={styles.copy}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(commands[platform]);
                setCopied(true);
                setCopyError(false);
              } catch {
                setCopyError(true);
              }
            }}
          >
            {copied ? "Copied ✓" : "Copy commands"}
          </button>
          <pre className={styles.code}>
            <code>{commands[platform]}</code>
          </pre>
        </div>
        <span className="sr-only" role="status">
          {copied ? "Commands copied." : ""}
        </span>
        {copyError && (
          <p role="status">
            Copy isn’t available here. Select and copy the commands above.
          </p>
        )}
        <p>
          Open{" "}
          <a href="http://localhost:3000" className="font-semibold underline">
            localhost:3000
          </a>
          , create a local account, then choose a text interview. Stop with
          Ctrl+C.
        </p>
        <p className="mt-3">
          {platform === "Docker"
            ? "PostgreSQL keeps your local accounts and history in a Docker volume. Compose binds published ports to your computer. This is a development setup."
            : "The launcher installs dependencies and starts both services. The no-key demo uses example responses; its accounts and history reset when you stop. No Docker or database setup required."}
        </p>
      </div>
    </div>
  );
}
