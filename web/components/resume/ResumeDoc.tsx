// ResumeDoc renders a structured ResumeParsed as a clean, sectioned resume
// document (header + experience + skills + education + projects) rather than a
// raw text dump. It supports inline highlight marks (amber = pending fix,
// green = applied / strength, accent = JD keyword match, red = JD gap) applied
// over any body text. Falls back to the raw resume text when the structured
// parse is empty. Structure modeled after OpenResume / Reactive Resume.
import type { ReactNode } from "react";
import type { ResumeParsed, ResumeSkillGroup } from "@/lib/types";

export type Mark = { str: string; cls: string };

// hasStructure reports whether the parse has enough to render as a document.
function hasStructure(p?: ResumeParsed): boolean {
  if (!p) return false;
  return Boolean(
    (p.experience && p.experience.length) ||
      (p.education && p.education.length) ||
      (p.skills && (p.skills as unknown[]).length) ||
      (p.projects && p.projects.length) ||
      p.summary,
  );
}

function skillGroups(skills: ResumeParsed["skills"]): ResumeSkillGroup[] {
  if (!skills || (skills as unknown[]).length === 0) return [];
  // Tolerate a flat string[] (back-compat) by wrapping it in one group.
  if (typeof (skills as unknown[])[0] === "string") {
    return [{ category: "", items: skills as string[] }];
  }
  return skills as ResumeSkillGroup[];
}

export function ResumeDoc({ parsed, text, marks, expand = false }: { parsed?: ResumeParsed; text?: string; marks: Mark[]; expand?: boolean }) {
  // When there's analysis alongside (expand), render the resume at full height and
  // let the page scroll — never clip the bottom behind an inner scrollbar. With no
  // analysis the right column is just a short prompt, so we cap the doc height and
  // let it scroll internally to avoid a lopsided, over-tall left column.
  const box = expand ? "px-7 py-7" : "mi-doc-scroll max-h-[72vh] overflow-auto px-7 py-7";
  if (!hasStructure(parsed)) {
    // Fallback: highlighted raw text, still readable.
    return (
      <div className={`${expand ? "px-6 py-6" : "mi-doc-scroll max-h-[72vh] overflow-auto px-6 py-6"} [overflow-wrap:anywhere]`}>
        <pre className="whitespace-pre-wrap font-sans text-[13.5px] leading-relaxed text-[var(--color-ink)]">{hl(text ?? "", marks)}</pre>
      </div>
    );
  }
  const p = parsed as ResumeParsed;
  const groups = skillGroups(p.skills);
  const contact = p.contact ?? {};
  const contactBits = [contact.location, contact.email, contact.phone, ...(contact.links ?? [])].filter(Boolean) as string[];

  return (
    <div className={`${box} text-[var(--color-ink)]`}>
      <div className="mx-auto max-w-[720px] [overflow-wrap:anywhere]">
        {/* Header */}
        <header className="border-b border-[var(--color-line)] pb-4 text-center">
          <h1 className="text-2xl font-extrabold tracking-tight">{p.name || "Your Name"}</h1>
          {p.headline && <p className="mt-0.5 text-sm font-medium text-[var(--color-accent)]">{p.headline}</p>}
          {contactBits.length > 0 && (
            <p className="mt-2 text-xs text-[var(--color-muted)]">{contactBits.join("  ·  ")}</p>
          )}
        </header>

        {p.summary && (
          <Section title="Summary">
            <p className="text-[13px] leading-relaxed text-[var(--color-muted)]">{hl(p.summary, marks)}</p>
          </Section>
        )}

        {p.experience && p.experience.length > 0 && (
          <Section title="Experience">
            <div className="space-y-4">
              {p.experience.map((e, i) => (
                <div key={i}>
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <h3 className="text-sm font-semibold">{[e.role, e.company].filter(Boolean).join(" — ")}</h3>
                    {(e.start || e.end) && (
                      <span className="font-mono text-[11px] text-[var(--color-faint)]">{[e.start, e.end].filter(Boolean).join(" – ")}</span>
                    )}
                  </div>
                  {e.bullets && e.bullets.length > 0 && (
                    <ul className="mt-1.5 space-y-1">
                      {e.bullets.map((b, j) => (
                        <li key={j} className="flex gap-2 text-[13px] leading-relaxed text-[var(--color-muted)]">
                          <span className="mt-[7px] h-1 w-1 flex-none rounded-full bg-[var(--color-faint)]" />
                          <span>{hl(b, marks)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </Section>
        )}

        {groups.length > 0 && (
          <Section title="Skills">
            <div className="space-y-2">
              {groups.map((g, i) => (
                <div key={i} className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  {g.category ? <span className="text-[12px] font-semibold text-[var(--color-ink)]">{g.category}:</span> : null}
                  <span className="text-[13px] text-[var(--color-muted)]">{hl((g.items ?? []).join(", "), marks)}</span>
                </div>
              ))}
            </div>
          </Section>
        )}

        {p.projects && p.projects.length > 0 && (
          <Section title="Projects">
            <div className="space-y-3">
              {p.projects.map((pr, i) => (
                <div key={i}>
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <h3 className="text-sm font-semibold">{pr.name}</h3>
                    {pr.tech && pr.tech.length > 0 && (
                      <span className="font-mono text-[11px] text-[var(--color-faint)]">{pr.tech.join(" · ")}</span>
                    )}
                  </div>
                  {pr.summary && <p className="mt-1 text-[13px] leading-relaxed text-[var(--color-muted)]">{hl(pr.summary, marks)}</p>}
                </div>
              ))}
            </div>
          </Section>
        )}

        {p.education && p.education.length > 0 && (
          <Section title="Education">
            <div className="space-y-2">
              {p.education.map((ed, i) => (
                <div key={i} className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <h3 className="text-sm font-semibold">{[ed.degree, ed.school].filter(Boolean).join(", ")}</h3>
                  {ed.dates && <span className="font-mono text-[11px] text-[var(--color-faint)]">{ed.dates}</span>}
                </div>
              ))}
            </div>
          </Section>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-5">
      <h2 className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--color-faint)]">{title}</h2>
      {children}
    </section>
  );
}

// hl wraps each occurrence of a mark string in a styled <mark>. Sequential,
// non-overlapping, first/earliest-match wins. Longer marks are tried first so a
// specific phrase beats a substring of it.
export function hl(text: string, marks: Mark[]): ReactNode[] {
  const targets = marks
    .filter((m) => m.str && text.includes(m.str))
    .sort((a, b) => b.str.length - a.str.length);
  if (targets.length === 0) return [text];
  const out: ReactNode[] = [];
  let rest = text;
  let key = 0;
  while (rest.length) {
    let best = -1;
    let bestMark: Mark | null = null;
    for (const m of targets) {
      const idx = rest.indexOf(m.str);
      if (idx >= 0 && (best === -1 || idx < best)) {
        best = idx;
        bestMark = m;
      }
    }
    if (best === -1 || !bestMark) {
      out.push(<span key={key++}>{rest}</span>);
      break;
    }
    if (best > 0) out.push(<span key={key++}>{rest.slice(0, best)}</span>);
    out.push(<mark key={key++} className={`mi-hl ${bestMark.cls}`}>{bestMark.str}</mark>);
    rest = rest.slice(best + bestMark.str.length);
  }
  return out;
}
