export type TopicId = "behavioral" | "career" | "technical";

export interface Topic {
  id: TopicId;
  title: string;
  subtitle: string;
  icon: string;
  color: string;
}

export interface Question {
  id: string;
  topicId: TopicId;
  prompt: string;
  hint: string;
  checkpoints: [string, string, string];
  followUp: string;
}

export interface PracticeAnswer {
  questionId: string;
  text: string;
  recordingUri?: string;
  durationSeconds?: number;
  /** Exact checkpoint labels the person marked during guided self-review. */
  checked: string[];
}

export interface PracticeSession {
  id: string;
  topicId: TopicId;
  startedAt: string;
  completedAt?: string;
  /** The question currently open when a draft is paused. */
  currentQuestionIndex?: number;
  questionIds: string[];
  answers: PracticeAnswer[];
  reflection?: string;
}

export interface SavedState {
  draft: PracticeSession | null;
  sessions: PracticeSession[];
  bookmarks: string[];
  /** Read failures and ignored invalid records; never presented as successful saves. */
  storageWarnings: string[];
}

export const MAX_SAVED_SESSIONS = 30;
export const MAX_ANSWER_LENGTH = 20_000;

export const topics: Topic[] = [
  {
    id: "behavioral",
    title: "Behavioral",
    subtitle: "Tell a story that sounds like you.",
    icon: "chatbubble-ellipses-outline",
    color: "#71816A",
  },
  {
    id: "career",
    title: "Career",
    subtitle: "Make your next chapter clear.",
    icon: "compass-outline",
    color: "#B98053",
  },
  {
    id: "technical",
    title: "Technical",
    subtitle: "Practice thinking out loud.",
    icon: "code-slash-outline",
    color: "#788291",
  },
];

/** Original, mobile-sized prompts for offline practice and guided self-review. */
export const questions: Question[] = [
  {
    id: "behavioral-proud",
    topicId: "behavioral",
    prompt: "Tell me about a piece of work you are proud of.",
    hint: "Choose one real example. Give just enough context, then focus on what you did and what changed.",
    checkpoints: [
      "I gave clear context",
      "I explained my own contribution",
      "I shared an outcome or lesson",
    ],
    followUp: "What would you approach differently if you did it again?",
  },
  {
    id: "behavioral-disagreement",
    topicId: "behavioral",
    prompt: "Tell me about a time you disagreed with a teammate.",
    hint: "Keep the other person’s perspective fair. Explain how you worked toward a decision together.",
    checkpoints: [
      "I explained both perspectives",
      "I described what I actually did",
      "I reflected on the outcome",
    ],
    followUp:
      "How did the disagreement affect the way you worked together afterward?",
  },
  {
    id: "behavioral-mistake",
    topicId: "behavioral",
    prompt: "Describe a mistake you made and how you handled it.",
    hint: "A modest, specific example is enough. Take responsibility and describe the repair and the lesson.",
    checkpoints: [
      "I took responsibility",
      "I explained how I addressed it",
      "I named a change I made afterward",
    ],
    followUp: "What helps you catch that kind of mistake earlier now?",
  },
  {
    id: "behavioral-priorities",
    topicId: "behavioral",
    prompt: "Tell me about a time your priorities changed unexpectedly.",
    hint: "Explain the tradeoff you faced, how you chose what mattered, and how you kept people informed.",
    checkpoints: [
      "I described the competing priorities",
      "I explained my tradeoff",
      "I showed how I communicated",
    ],
    followUp:
      "What did you decide to pause, and how did you explain that decision?",
  },
  {
    id: "career-introduction",
    topicId: "career",
    prompt: "How would you introduce yourself in about a minute?",
    hint: "Try a simple arc: what you do now, one relevant experience, and what you hope to do next.",
    checkpoints: [
      "I made my current focus clear",
      "I included a relevant example",
      "I connected my story to my next step",
    ],
    followUp:
      "Which part of your experience is most relevant to the role you want?",
  },
  {
    id: "career-interest",
    topicId: "career",
    prompt: "What interests you about the role you are preparing for?",
    hint: "Pick a role you have in mind. Connect a specific responsibility to work you enjoy or want to learn.",
    checkpoints: [
      "I named something specific about the role",
      "I connected it to my experience or interests",
      "I explained what I could contribute",
    ],
    followUp:
      "What would you want to learn about the team before deciding whether it is a fit?",
  },
  {
    id: "career-growth",
    topicId: "career",
    prompt: "What is one skill you are actively working on?",
    hint: "Choose something real and explain a small action you have taken. Progress can be a useful lesson, too.",
    checkpoints: [
      "I named a specific skill",
      "I described how I am practicing",
      "I explained a sign of progress",
    ],
    followUp: "What is the next small step you will take to keep improving?",
  },
  {
    id: "career-questions",
    topicId: "career",
    prompt: "What would you ask an interviewer to understand the team better?",
    hint: "Pick two questions that would help you make a decision. Think about expectations, feedback, or daily work.",
    checkpoints: [
      "I asked about something that matters to me",
      "My questions invite specific examples",
      "I explained what I hope to learn",
    ],
    followUp: "What answer would help you feel confident about joining?",
  },
  {
    id: "technical-explain",
    topicId: "technical",
    prompt: "Explain a technical project to someone outside your field.",
    hint: "Start with the problem and who it helped. Use plain language for the approach and one important decision.",
    checkpoints: [
      "I explained the problem in plain language",
      "I made the approach easy to follow",
      "I connected the work to its impact",
    ],
    followUp:
      "How would you explain the most important tradeoff without using technical jargon?",
  },
  {
    id: "technical-debug",
    topicId: "technical",
    prompt: "An app suddenly feels slow. How would you investigate?",
    hint: "Think out loud. Clarify the symptoms, look for evidence, and explain how you would narrow the cause.",
    checkpoints: [
      "I clarified the symptoms and scope",
      "I proposed checks driven by evidence",
      "I explained how I would verify a fix",
    ],
    followUp:
      "What would you do if you could not reproduce the issue yourself?",
  },
  {
    id: "technical-tradeoff",
    topicId: "technical",
    prompt:
      "Walk me through a technical decision with more than one reasonable answer.",
    hint: "Use a real or small imagined example. State your assumptions, compare options, then make a choice.",
    checkpoints: [
      "I stated the requirements and assumptions",
      "I compared benefits and drawbacks",
      "I justified a choice for this situation",
    ],
    followUp:
      "What change in requirements would make you choose the other option?",
  },
  {
    id: "technical-unknown",
    topicId: "technical",
    prompt:
      "How would you approach a problem involving a tool you have never used?",
    hint: "Describe a practical first step, a small experiment, and when you would ask for help.",
    checkpoints: [
      "I clarified the problem before picking a tool",
      "I proposed a small way to learn and test",
      "I explained how I would check my understanding",
    ],
    followUp: "How would you balance learning the tool with a tight deadline?",
  },
];

export function getTopic(id: string): Topic | undefined {
  return topics.find((topic) => topic.id === id);
}

export function getQuestion(id: string): Question | undefined {
  return questions.find((question) => question.id === id);
}

/** recentQuestionIds should be ordered newest first. Unseen questions come first. */
export function selectQuestions(
  topicId: TopicId,
  count: 1 | 3,
  recentQuestionIds: readonly string[] = [],
): Question[] {
  if (!getTopic(topicId) || (count !== 1 && count !== 3)) {
    throw new Error(
      "Choose a practice topic and either one or three questions.",
    );
  }
  return questions
    .filter((question) => question.topicId === topicId)
    .sort((a, b) => {
      const aIndex = recentQuestionIds.indexOf(a.id);
      const bIndex = recentQuestionIds.indexOf(b.id);
      if (aIndex === -1 && bIndex === -1) return 0;
      if (aIndex === -1) return -1;
      if (bIndex === -1) return 1;
      return bIndex - aIndex;
    })
    .slice(0, count);
}

export function createSession(
  topicId: TopicId,
  count: 1 | 3,
  recentQuestionIds: readonly string[] = [],
): PracticeSession {
  const selected = selectQuestions(topicId, count, recentQuestionIds);
  return {
    id: `practice-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    topicId,
    startedAt: new Date().toISOString(),
    currentQuestionIndex: 0,
    questionIds: selected.map((question) => question.id),
    answers: selected.map((question) => ({
      questionId: question.id,
      text: "",
      checked: [],
    })),
  };
}

export function getSessionAnswers(session: PracticeSession): PracticeAnswer[] {
  return session.questionIds.map(
    (questionId) =>
      session.answers.find((answer) => answer.questionId === questionId) ?? {
        questionId,
        text: "",
        checked: [],
      },
  );
}

export function hasAnswer(answer: PracticeAnswer): boolean {
  return Boolean(answer.text.trim() || answer.recordingUri);
}

/** Completion describes participation, never answer quality or an AI score. */
export function sessionProgress(session: PracticeSession) {
  const answers = getSessionAnswers(session);
  const answered = answers.filter(hasAnswer).length;
  const total = session.questionIds.length;
  const checked = answers.reduce((sum, answer) => {
    const validLabels: readonly string[] =
      getQuestion(answer.questionId)?.checkpoints ?? [];
    return (
      sum +
      new Set(answer.checked.filter((label) => validLabels.includes(label)))
        .size
    );
  }, 0);
  return {
    answered,
    total,
    checked,
    totalCheckpoints: total * 3,
    percent: total ? Math.round((answered / total) * 100) : 0,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 40 &&
    Number.isFinite(Date.parse(value))
  );
}

/** Unknown IDs and malformed records are rejected; optional fields are bounded. */
export function parsePracticeSession(value: unknown): PracticeSession | null {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    !/^[a-zA-Z0-9:_-]{1,120}$/.test(value.id) ||
    typeof value.topicId !== "string" ||
    !getTopic(value.topicId) ||
    !isTimestamp(value.startedAt) ||
    (value.completedAt !== undefined && !isTimestamp(value.completedAt)) ||
    !Array.isArray(value.questionIds) ||
    ![1, 3].includes(value.questionIds.length) ||
    new Set(value.questionIds).size !== value.questionIds.length ||
    !value.questionIds.every(
      (id) =>
        typeof id === "string" && getQuestion(id)?.topicId === value.topicId,
    ) ||
    !Array.isArray(value.answers) ||
    value.answers.length > value.questionIds.length ||
    (value.currentQuestionIndex !== undefined &&
      (typeof value.currentQuestionIndex !== "number" ||
        !Number.isFinite(value.currentQuestionIndex))) ||
    (value.reflection !== undefined &&
      (typeof value.reflection !== "string" ||
        value.reflection.length > MAX_ANSWER_LENGTH))
  ) {
    return null;
  }

  const answers: PracticeAnswer[] = [];
  for (const candidate of value.answers) {
    if (
      !isRecord(candidate) ||
      typeof candidate.questionId !== "string" ||
      !value.questionIds.includes(candidate.questionId) ||
      answers.some((answer) => answer.questionId === candidate.questionId) ||
      typeof candidate.text !== "string" ||
      candidate.text.length > MAX_ANSWER_LENGTH ||
      !Array.isArray(candidate.checked) ||
      candidate.checked.length > 3 ||
      !candidate.checked.every(
        (label) =>
          typeof label === "string" &&
          getQuestion(candidate.questionId as string)?.checkpoints.includes(
            label,
          ),
      ) ||
      (candidate.recordingUri !== undefined &&
        (typeof candidate.recordingUri !== "string" ||
          candidate.recordingUri.length > 4096 ||
          !/^(file:|content:|blob:|\/)/.test(candidate.recordingUri))) ||
      (candidate.durationSeconds !== undefined &&
        (typeof candidate.durationSeconds !== "number" ||
          !Number.isFinite(candidate.durationSeconds) ||
          candidate.durationSeconds < 0 ||
          candidate.durationSeconds > 86_400))
    ) {
      return null;
    }
    answers.push({
      questionId: candidate.questionId,
      text: candidate.text,
      checked: [...new Set(candidate.checked as string[])],
      ...(candidate.recordingUri !== undefined
        ? { recordingUri: candidate.recordingUri as string }
        : {}),
      ...(candidate.durationSeconds !== undefined
        ? { durationSeconds: candidate.durationSeconds as number }
        : {}),
    });
  }

  return {
    id: value.id,
    topicId: value.topicId as TopicId,
    startedAt: value.startedAt,
    ...(value.currentQuestionIndex !== undefined
      ? {
          currentQuestionIndex: Math.max(
            0,
            Math.min(
              value.questionIds.length - 1,
              Math.trunc(value.currentQuestionIndex as number),
            ),
          ),
        }
      : {}),
    questionIds: [...value.questionIds] as string[],
    answers,
    ...(value.completedAt !== undefined
      ? { completedAt: value.completedAt as string }
      : {}),
    ...(value.reflection !== undefined
      ? { reflection: value.reflection as string }
      : {}),
  };
}
