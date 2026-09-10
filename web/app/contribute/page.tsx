import { AppShell, SOURCE_URL } from "@/components/AppShell";
import { Button, Panel } from "@/components/ui";
export default function Contribute() {
  return (
    <AppShell active="contribute">
      <p className="eyebrow">Built together</p>
      <h1 className="page-title mt-3">Help someone practice.</h1>
      <p className="mt-4 max-w-2xl text-[var(--color-muted)]">
        Your experience can make the next interview more useful. Add a scenario,
        improve an interviewer format, or make the product easier to use.
      </p>
      <div className="mt-9 grid gap-5 md:grid-cols-3">
        {[
          {
            title: "Add a scenario",
            body: "Start with a clear task, known facts, thoughtful follow-ups and a rubric. Include strong, mixed and incomplete example responses.",
            link: "/blob/main/docs/CORPUS.md",
            label: "Scenario guide",
          },
          {
            title: "Improve a format",
            body: "Define how the conversation works: pacing, what to reveal, when to probe and how to assess evidence. Preview it without a paid model key.",
            link: "/blob/main/CONTRIBUTING.md",
            label: "Contributor guide",
          },
          {
            title: "Fix the experience",
            body: "Reproduce a bug, improve accessibility or contribute a focused change. Keep personal interview content out of public issues.",
            link: "/issues",
            label: "Find an issue",
          },
        ].map((x) => (
          <Panel key={x.title} className="flex flex-col p-6">
            <h2 className="text-lg font-semibold">{x.title}</h2>
            <p className="my-4 flex-1 text-sm text-[var(--color-muted)]">
              {x.body}
            </p>
            <Button href={SOURCE_URL + x.link} variant="ghost">
              {x.label} ↗
            </Button>
          </Panel>
        ))}
      </div>
      <Panel className="mt-6 grid gap-6 p-7 md:grid-cols-[1.3fr_1fr]">
        <div>
          <h2 className="text-2xl font-medium">Make room for more practice.</h2>
          <p className="mt-3 text-sm text-[var(--color-muted)]">
            Hosted access includes one funded interview every seven days. Using
            your own key is limited to one hosted interview per 24 hours. Run
            your own copy for more practice, subject to your model provider’s
            limits and charges.
          </p>
          <Button href={SOURCE_URL + "#run-locally"} className="mt-5">
            Follow the local setup guide ↗
          </Button>
        </div>
        <ol className="space-y-4 text-sm text-[var(--color-muted)]">
          <li>
            1. Clone the repository and install the documented dependencies.
          </li>
          <li>2. Copy the environment example and start the local database.</li>
          <li>
            3. Try the simulated mode, or configure your model credentials.
          </li>
          <li>
            4. Run the web app and API. Your local data stays in your own
            installation.
          </li>
        </ol>
      </Panel>
      <p className="mt-6 text-xs text-[var(--color-muted)]">
        AGPL open source. Review the license and contribution guidelines before
        distributing changes.
      </p>
    </AppShell>
  );
}
