import preview from "./features/catalog-preview.json";
import type { QuestionSummary } from "./features/catalog";
import type { Profession } from "./features/profile";
import type { Modality } from "./domain";

/** Public scenario metadata only. This is a preview, not a live interview. */
export interface InterviewShowcaseSlide {
  id: string;
  title: string;
  scenario: string;
  professionKey: string;
  profession: string;
  family: string;
  familyLabel: string;
  format: string;
  activity: string;
  modality: Modality;
  level: string;
  minutes: number;
}

const FAMILY_ORDER = [
  "healthcare",
  "technology",
  "education_public",
  "business",
  "customer_creative",
  "engineering_trades",
  "career_readiness",
];

const PROFESSION_ORDER = [
  "nursing",
  "software_engineering",
  "education",
  "finance",
  "sales",
  "civil_engineering",
  "career_foundations",
];

// Shortened from the public catalog descriptions, rather than cutting a
// sentence in the middle or exposing the server's interview instructions.
const SHORT_DESCRIPTIONS: Record<string, string> = {
  "experimentation-causal-inference":
    "Identify confounding, compare causal methods, and explain the assumptions behind your estimate.",
  "experimentation-ranking-ab-test":
    "Design an experiment for a ranking model, choose useful metrics, and explain your launch decision.",
  "finance-accretion-dilution":
    "Analyze how an acquisition changes earnings per share, including financing choices, costs, and synergies.",
  "finance-comparable-companies":
    "Choose a defensible peer group, compare valuation multiples, and explain what they imply for the business.",
  "finance-lbo-analysis":
    "Work through a paper LBO and explain how financing, operating growth, and the exit affect investor returns.",
  "heat-exchanger-sizing":
    "Size a heat exchanger, explain your assumptions, and weigh heat transfer, fouling, and pressure-drop tradeoffs.",
  "law-issue-spotting-criminal":
    "Analyze a fictional bar-fight death using a structured discussion of criminal liability, defenses, and causation.",
  "law-issue-spotting-property":
    "Use a structured legal analysis to explore a disputed driveway, easement claims, and notice to a new owner.",
  "law-negotiation-counsel":
    "Practice a settlement conversation that explains risks, alternatives, and the client's control over the decision.",
  "nearby-friends":
    "Design a location-sharing system that handles moving users and keeps friends informed of nearby activity.",
  "nursing-prioritization-shift-handoff":
    "Explain your start-of-shift priorities, recognize changing needs, and communicate safe delegation and handoffs.",
  "nursing-prioritization-telemetry":
    "Work through a telemetry prioritization scenario with clear assessment, delegation, and escalation reasoning.",
  "power-distribution-sizing":
    "Size a distribution feeder and transformer, then explain capacity, voltage-drop, and protection tradeoffs.",
  "rc-filter-design":
    "Design a low-pass filter, choose component values, and explain the response and practical design tradeoffs.",
  "shallow-foundation-bearing":
    "Size a spread footing and explain bearing capacity, safety factors, settlement, and site assumptions.",
  "signalized-intersection":
    "Plan signal timing for an intersection and balance traffic capacity, delay, and pedestrian crossing needs.",
  "thermo-cycle-sizing":
    "Size a steam power cycle, work through energy balances, and explain the tradeoffs behind efficiency and output.",
  "word-break":
    "Break a string into dictionary words and explain your algorithm, boundary cases, and performance tradeoffs.",
};

const FORMAT_ACTIVITIES: Record<string, string> = {
  "ai-output-critique": "Critique and verify",
  "work-sample-defense": "Explain your approach",
  "incident-simulation": "Respond and prioritize",
  "stakeholder-simulation": "Practice a conversation",
  "panel-simulation": "Answer a panel",
  "reverse-interview": "Ask thoughtful questions",
  "evidence-interview": "Tell your story",
  "recruiter-screen": "Introduce your strengths",
  behavioral: "Tell your story",
  "sales-roleplay": "Lead a discovery call",
  "employee-relations": "Practice a difficult conversation",
  "clinical-reasoning": "Explain your clinical reasoning",
  prioritization: "Prioritize and explain",
  "classroom-management": "Navigate a classroom scenario",
  "portfolio-review": "Discuss your creative decisions",
  "design-critique": "Review a design",
  case: "Work through a case",
};

function readable(value: string): string {
  return value.replace(/[_-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function activityFor(question: QuestionSummary, family: string): string {
  const formatActivity = FORMAT_ACTIVITIES[question.format_id ?? ""];
  if (formatActivity) return formatActivity;
  if (question.modality === "coding") return "Write and test code";
  if (question.modality === "system_design") return "Map a system";
  if (question.modality === "written") return "Build a written response";
  switch (family) {
    case "business":
      return "Analyze and recommend";
    case "engineering_trades":
      return "Reason through tradeoffs";
    case "healthcare":
      return "Explain your judgment";
    case "customer_creative":
      return "Practice a conversation";
    case "career_readiness":
      return "Tell your story";
    default:
      return "Explain your approach";
  }
}

function scenarioFor(question: QuestionSummary, format: string): string {
  if (SHORT_DESCRIPTIONS[question.id]) return SHORT_DESCRIPTIONS[question.id];
  const blurb = question.blurb.trim();
  if (blurb && blurb.length <= 180) return blurb;
  // Future catalog additions can still render a complete sentence. Keep a
  // whole first sentence if it fits; otherwise describe the practice format.
  const firstSentence = blurb.match(/^.*?[.!?](?:\s|$)/)?.[0].trim();
  if (firstSentence && firstSentence.length <= 180) return firstSentence;
  return `Practice ${format.toLowerCase()} and explain the reasoning behind your decisions.`;
}

function orderedKeys(keys: string[], priority: string[]): string[] {
  return keys.sort((a, b) => {
    const aRank = priority.indexOf(a);
    const bRank = priority.indexOf(b);
    return (
      (aRank < 0 ? priority.length : aRank) -
        (bRank < 0 ? priority.length : bRank) || a.localeCompare(b)
    );
  });
}

/**
 * Every scenario appears once, with families and then professions taking
 * turns. A large software catalog cannot crowd other careers off the front.
 * The input arrays and objects are never changed.
 */
export function buildInterviewShowcase(
  questions: QuestionSummary[],
  professions: Profession[],
): InterviewShowcaseSlide[] {
  const professionByKey = new Map(professions.map((p) => [p.key, p]));
  const families = new Map<string, Map<string, InterviewShowcaseSlide[]>>();
  const seen = new Set<string>();
  for (const question of questions) {
    if (!question.id || seen.has(question.id)) continue;
    seen.add(question.id);
    const professionKey = question.areas[0] ?? "general";
    const profession = professionByKey.get(professionKey);
    const family = profession?.family ?? "general";
    const format =
      question.format_name || readable(question.format_id || question.domain);
    const slide: InterviewShowcaseSlide = {
      id: question.id,
      title: question.title,
      scenario: scenarioFor(question, format),
      professionKey,
      profession: profession?.label ?? readable(professionKey),
      family,
      familyLabel: profession?.family_label ?? readable(family),
      format,
      activity: activityFor(question, family),
      modality: question.modality,
      level: readable(question.difficulty),
      minutes: question.minutes ?? 30,
    };
    const roles = families.get(family) ?? new Map();
    const queue = roles.get(professionKey) ?? [];
    queue.push(slide);
    roles.set(professionKey, queue);
    families.set(family, roles);
  }

  const queues = orderedKeys([...families.keys()], FAMILY_ORDER).map(
    (family) => {
      const roles = families.get(family)!;
      return orderedKeys([...roles.keys()], PROFESSION_ORDER).map((key) =>
        roles.get(key)!,
      );
    },
  );
  const slides: InterviewShowcaseSlide[] = [];
  while (queues.some((roles) => roles.length)) {
    for (const roles of queues) {
      const queue = roles.shift();
      if (!queue) continue;
      slides.push(queue.shift()!);
      if (queue.length) roles.push(queue);
    }
  }
  return slides;
}

// A useful offline/first-render preview. The live public catalog supplies the
// complete rotation after hydration, including newly published scenarios.
export const SHOWCASE_SLIDES = buildInterviewShowcase(
  preview.questions as QuestionSummary[],
  preview.professions as Profession[],
);
