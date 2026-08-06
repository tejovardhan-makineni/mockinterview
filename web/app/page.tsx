import { Badge, Button, Panel } from "@/components/ui";

const FEATURES = [
  { t: "A human-like interviewer", d: "A configurable face and voice that speaks, reacts, and interrupts in real time — powered by Gemini's native-audio live model." },
  { t: "It watches you draw", d: "Sketch your architecture on a live canvas. The interviewer sees it and probes: \"you drew Postgres — how do you capture changes, CDC/Debezium?\"" },
  { t: "Scored like the real thing", d: "Requirements, estimations, HLD, API, deep-dives, scaling, reliability, observability, security — each rated with evidence and coverage." },
  { t: "Reads the room", d: "Eye contact, posture, lighting, filler words, long pauses, and how often you asked for help — tracked in-browser, reported honestly." },
  { t: "Your resume, your projects", d: "Upload a resume; the intro conversation digs into your real projects before the design problem begins." },
  { t: "Tune the interviewer", d: "Supportive, neutral, interruptive, or downright annoying — and dial the intensity — to train for any room." },
];

export default function Home() {
  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <nav className="flex items-center justify-between">
        <div className="flex items-center gap-2.5 text-lg font-bold tracking-tight">
          <span className="live-dot inline-block h-2.5 w-2.5 rounded-full bg-[var(--color-live)]" />
          mockinterview<span className="text-[var(--color-accent)]">.live</span>
        </div>
        <div className="flex items-center gap-3">
          <Button href="/login" variant="ghost">Sign in</Button>
          <Button href="/login">Start an interview</Button>
        </div>
      </nav>

      <section className="mx-auto mt-24 max-w-3xl text-center">
        <Badge tone="accent">Powered by Gemini · Live voice &amp; face</Badge>
        <h1 className="mt-6 text-5xl font-extrabold leading-[1.05] tracking-tight md:text-6xl">
          Practice system design with an AI that feels like a{" "}
          <span className="text-[var(--color-accent)]">real interviewer</span>.
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-[var(--color-muted)]">
          Not a chatbot. A face and a voice that asks, listens, watches your diagram, interrupts with
          low-level follow-ups, and gives you a brutally useful scorecard afterward.
        </p>
        <div className="mt-9 flex items-center justify-center gap-3">
          <Button href="/login" className="px-6 py-3 text-base">Start free interview</Button>
          <Button href="#how" variant="ghost" className="px-6 py-3 text-base">See how it works</Button>
        </div>
      </section>

      <section id="how" className="mt-28 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((f) => (
          <Panel key={f.t} className="p-6">
            <h3 className="text-base font-semibold">{f.t}</h3>
            <p className="mt-2 text-sm leading-relaxed text-[var(--color-muted)]">{f.d}</p>
          </Panel>
        ))}
      </section>

      <section className="mt-28 mb-10">
        <Panel className="flex flex-col items-center gap-4 p-10 text-center">
          <h2 className="text-2xl font-bold">Sit down. The interviewer is ready.</h2>
          <p className="max-w-xl text-[var(--color-muted)]">
            Pick a question, set the interviewer&apos;s temperament, and go. You&apos;ll get a full
            report — expected vs. actual, coverage, and coaching — the moment you finish.
          </p>
          <Button href="/login" className="mt-2 px-6 py-3 text-base">Begin</Button>
        </Panel>
      </section>

      <footer className="border-t border-[var(--color-line)] py-8 text-center text-sm text-[var(--color-faint)]">
        mockinterview.live · built for engineers who want the real thing
      </footer>
    </main>
  );
}
