"use client";

import Link from "next/link";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { api } from "@/lib/api";
import {
  buildInterviewShowcase,
  SHOWCASE_SLIDES,
} from "@/lib/interview-showcase";
import styles from "./showcase.module.css";

const INTERVAL = 7000;
const motionQuery = "(prefers-reduced-motion: reduce)";
const subscribeMotion = (change: () => void) => {
  const query = window.matchMedia(motionQuery);
  query.addEventListener("change", change);
  return () => query.removeEventListener("change", change);
};
const reducedMotionSnapshot = () => window.matchMedia(motionQuery).matches;
const subscribeVisibility = (change: () => void) => {
  document.addEventListener("visibilitychange", change);
  return () => document.removeEventListener("visibilitychange", change);
};
const hiddenSnapshot = () => document.hidden;
const serverPaused = () => true;

function ProfessionIcon({ family }: { family: string }) {
  const shapes: Record<string, React.ReactNode> = {
    healthcare: (
      <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8ZM3 12h5l2-4 4 8 2-4h5" />
    ),
    technology: (
      <>
        <rect x="3" y="4" width="18" height="13" rx="2" />
        <path d="M8 21h8m-4-4v4M7 9l2 2-2 2m5 0h4" />
      </>
    ),
    education_public: (
      <>
        <path d="M12 6v15M3 4c4-1 7 0 9 2 2-2 5-3 9-2v15c-4-1-7 0-9 2-2-2-5-3-9-2Z" />
        <path d="m6 8 3 1m6 0 3-1" />
      </>
    ),
    business: (
      <>
        <rect x="3" y="7" width="18" height="14" rx="2" />
        <path d="M8 7V4h8v3M3 12c6 3 12 3 18 0m-9 0v4" />
      </>
    ),
    customer_creative: (
      <>
        <path d="M21 11.5a8.4 8.4 0 0 1-9 8.5H5l-3 2V11.5a9.5 9.5 0 0 1 19 0Z" />
        <path d="M7 9h10M7 13h6" />
      </>
    ),
    engineering_trades: (
      <>
        <path d="m14 4 2 2-4 4-2-2-7 7a2.8 2.8 0 0 0 4 4l7-7-2-2 4-4 2 2 3-3-4-4Z" />
      </>
    ),
    career_readiness: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="m16 8-2 6-6 2 2-6Z" />
      </>
    ),
  };
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {shapes[family] ?? shapes.business}
    </svg>
  );
}

export function InterviewShowcase() {
  const [slides, setSlides] = useState(SHOWCASE_SLIDES);
  const [profession, setProfession] = useState("");
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [visible, setVisible] = useState(true);
  const [announcement, setAnnouncement] = useState("");
  const container = useRef<HTMLElement>(null);
  const pauseButton = useRef<HTMLButtonElement>(null);
  const reducedMotion = useSyncExternalStore(
    subscribeMotion,
    reducedMotionSnapshot,
    serverPaused,
  );
  const hidden = useSyncExternalStore(
    subscribeVisibility,
    hiddenSnapshot,
    serverPaused,
  );
  const professions = useMemo(
    () =>
      Array.from(
        new Map(slides.map((slide) => [slide.professionKey, slide.profession])),
      ).sort((a, b) => a[1].localeCompare(b[1])),
    [slides],
  );
  const selectedProfession = professions.some(([key]) => key === profession)
    ? profession
    : "";
  const choices = useMemo(
    () =>
      selectedProfession
        ? slides.filter((slide) => slide.professionKey === selectedProfession)
        : slides,
    [slides, selectedProfession],
  );
  const currentIndex = index % choices.length;
  const slide = choices[currentIndex];
  const rotating =
    !paused &&
    !hovered &&
    visible &&
    !hidden &&
    !reducedMotion &&
    choices.length > 1;

  useEffect(() => {
    let alive = true;
    // Public summaries only. The bundled examples keep the preview usable offline.
    Promise.all([api.listQuestions(), api.listProfessions()])
      .then(([questions, roles]) => {
        const next = buildInterviewShowcase(questions, roles);
        if (alive && next.length > 0) setSlides(next);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!container.current || !window.IntersectionObserver) return;
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { threshold: 0.1 },
    );
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!rotating) return;
    const timer = window.setTimeout(
      () => setIndex((value) => (value + 1) % choices.length),
      INTERVAL,
    );
    return () => window.clearTimeout(timer);
  }, [rotating, index, choices]);

  function move(direction: number) {
    const next = (currentIndex + direction + choices.length) % choices.length;
    setIndex(next);
    setPaused(true);
    setAnnouncement(`${choices[next].profession}: ${choices[next].title}`);
  }

  return (
    <section
      ref={container}
      className={styles.showcase}
      aria-label="Explore interview previews"
      aria-roledescription="carousel"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={(event) => {
        if (event.target !== pauseButton.current) setPaused(true);
      }}
    >
      <div className={styles.topline}>
        <span className={styles.roomLabel}>
          <span className={styles.roomMark} aria-hidden="true" />
          Practice room
        </span>
        <span>Template preview</span>
      </div>
      <div className={styles.selectorRow}>
        <label htmlFor="preview-profession" className="sr-only">
          Preview a profession
        </label>
        <select
          id="preview-profession"
          value={selectedProfession}
          onChange={(event) => {
            const key = event.target.value;
            setProfession(key);
            setIndex(0);
            setPaused(true);
            const first = slides.find(
              (item) => !key || item.professionKey === key,
            );
            if (first) setAnnouncement(`${first.profession}: ${first.title}`);
          }}
        >
          <option value="">Explore all professions</option>
          {professions.map(([key, name]) => (
            <option key={key} value={key}>
              {name}
            </option>
          ))}
        </select>
        <span className={styles.coverage}>
          {professions.length} career areas
        </span>
      </div>
      <div
        key={slide.id}
        className={styles.stage}
        role="group"
        aria-roledescription="slide"
        aria-label={`${currentIndex + 1} of ${choices.length}`}
        aria-live="off"
      >
        <div className={styles.profession}>
          <span className={styles.professionIcon}>
            <ProfessionIcon family={slide.family} />
          </span>
          <div>
            <p className={styles.family}>{slide.familyLabel}</p>
            <h2>{slide.profession}</h2>
          </div>
        </div>
        <div className={styles.scenario}>
          <span className={styles.scenarioLabel}>Your scenario</span>
          <h3>{slide.title}</h3>
          <p>{slide.scenario}</p>
        </div>
        <div className={styles.details}>
          <span>{slide.format}</span>
          <span>{slide.minutes} min</span>
          <span>{slide.level}</span>
        </div>
        <div className={styles.activity}>
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            aria-hidden="true"
          >
            <path d="m4 12 5 5L20 6" />
          </svg>
          <span>{slide.activity}</span>
        </div>
      </div>
      <div className={styles.bottomline}>
        <Link
          className={styles.tryLink}
          href={`/setup?q=${encodeURIComponent(slide.id)}`}
        >
          Try this interview <span aria-hidden="true">↗</span>
        </Link>
        <div className={styles.controls}>
          <button
            type="button"
            aria-label="Previous interview preview"
            title="Previous preview"
            onClick={() => move(-1)}
            disabled={choices.length < 2}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              aria-hidden="true"
            >
              <path d="m14 6-6 6 6 6" />
            </svg>
          </button>
          {!reducedMotion && (
            <button
              ref={pauseButton}
              type="button"
              aria-label={
                paused
                  ? "Resume interview previews"
                  : "Pause interview previews"
              }
              title={paused ? "Resume previews" : "Pause previews"}
              onClick={() => setPaused((value) => !value)}
              disabled={choices.length < 2}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                {paused ? (
                  <path d="m7 4 14 8-14 8Z" />
                ) : (
                  <path d="M6 4h4v16H6zm8 0h4v16h-4z" />
                )}
              </svg>
            </button>
          )}
          <button
            type="button"
            aria-label="Next interview preview"
            title="Next preview"
            onClick={() => move(1)}
            disabled={choices.length < 2}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              aria-hidden="true"
            >
              <path d="m10 6 6 6-6 6" />
            </svg>
          </button>
        </div>
      </div>
      <div className={styles.progress} aria-hidden="true">
        <span key={`${slide.id}-${rotating}`} data-running={rotating} />
      </div>
      <span
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {announcement}
      </span>
    </section>
  );
}
