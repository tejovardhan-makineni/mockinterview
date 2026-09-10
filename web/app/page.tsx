import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { Button, Panel } from "@/components/ui";
export default function Home() {
  return (
    <AppShell active="public">
      <section className="grid items-center gap-12 py-12 md:grid-cols-[1.3fr_1fr]">
        <div>
          <p className="eyebrow">Practice with purpose</p>
          <h1 className="mt-5 text-5xl font-medium leading-[1.08] tracking-[-.055em] sm:text-6xl">
            A little practice.
            <br />A clearer next step.
          </h1>
          <p className="mt-6 max-w-xl text-lg text-[var(--color-muted)]">
            An AI interviewer that asks, listens, and follows your thinking.
            Practice for your role, then turn specific feedback into your next
            improvement.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button href="/interviews">Find your interview →</Button>
            <Button href="/contribute" variant="ghost">
              Explore the open source project
            </Button>
          </div>
          <p className="mt-4 text-xs text-[var(--color-muted)]">
            One funded interview every 7 days. Camera and resume are optional.
          </p>
        </div>
        <Panel className="p-7 sm:p-9">
          <p className="eyebrow">A thoughtful conversation</p>
          <div className="mt-6 rounded-xl bg-[var(--color-panel-2)] p-5">
            <p className="text-xs font-semibold">
              ALEX · AI INTERVIEWER · EXAMPLE
            </p>
            <p className="mt-3 text-xl leading-relaxed">
              “What did you consider, and why did you choose that approach?”
            </p>
          </div>
          <div className="mt-6 border-l-2 border-[var(--color-accent)] pl-5">
            <h2 className="font-semibold">Leave with something useful.</h2>
            <p className="mt-2 text-sm text-[var(--color-muted)]">
              Evidence from your answers, a few specific next steps, and a saved
              record to come back to.
            </p>
          </div>
        </Panel>
      </section>
      <section className="grid gap-5 border-t border-[var(--color-line)] py-10 md:grid-cols-3">
        {[
          {
            n: "01",
            title: "Choose your interview",
            text: "Explore engineering, product, business and professional scenarios. Set your level and the time you have.",
          },
          {
            n: "02",
            title: "Make room for your thinking",
            text: "Speak or type. Use a whiteboard, code editor or notes. Your interviewer follows up on what you actually say.",
          },
          {
            n: "03",
            title: "Know what to practice next",
            text: "Review what worked, what needs attention, and the evidence behind the feedback. Keep improving between interviews.",
          },
        ].map((x) => (
          <div key={x.n}>
            <span className="eyebrow">{x.n}</span>
            <h2 className="mt-3 text-lg font-semibold">{x.title}</h2>
            <p className="mt-2 text-sm text-[var(--color-muted)]">{x.text}</p>
          </div>
        ))}
      </section>
      <Panel className="flex flex-wrap items-center justify-between gap-6 p-7">
        <div>
          <h2 className="text-xl font-medium">
            Built in the open. Better with your experience.
          </h2>
          <p className="mt-2 text-sm text-[var(--color-muted)]">
            Add an interview scenario, improve a format, or run your own copy.
          </p>
        </div>
        <Link
          href="/contribute"
          className="font-semibold text-[var(--color-accent)]"
        >
          Help someone practice →
        </Link>
      </Panel>
      <p className="mt-6 text-xs text-[var(--color-muted)]">
        AI practice feedback is a learning aid, not a hiring decision or
        professional certification. Community scenarios are labeled with their
        review status.
      </p>
    </AppShell>
  );
}
