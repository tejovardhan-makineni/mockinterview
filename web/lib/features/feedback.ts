// Feedback feature slice — send user feedback (general, or captured DURING an
// interview with debug context attached). Backend: api/internal/feedback;
// db: store/feedback.go.

import { req } from "../http";

export type FeedbackContext = Record<string, unknown>;

export interface FeedbackPayload {
  kind:
    "general" | "interview" | "interviewer" | "product" | "question" | "report";
  session_id?: string;
  tags?: string[];
  include_diagnostics?: boolean;
  share_transcript?: boolean;
  message?: string;
  rating?: number; // 0 = unset, else 1..5
  context?: FeedbackContext;
}

export interface ToolComparison {
  version: "tool-comparison-v1";
  prior_use: "yes" | "no" | "prefer_not_to_say";
  tool_names: string;
  preference:
    | ""
    | "mockinterview_better"
    | "about_same"
    | "other_tools_better"
    | "unable_to_judge";
  details: string;
}
export interface ToolComparisonMetrics {
  instrument_version: "tool-comparison-v1";
  answered_count: number;
  skipped_count: number;
  prior_use: Record<ToolComparison["prior_use"], number>;
  preference: Record<Exclude<ToolComparison["preference"], "">, number>;
  compared_count: number;
  other_tools_better_rate: number | null;
}

export interface FeedbackSuggestions {
  items: {
    session_id: string;
    version: string;
    question_title: string;
    subject_key: string;
    subject_label: string;
    mode: string;
    provider: string;
    status: string;
    comment: string;
    comparison?: ToolComparison | null;
    share_transcript: boolean;
    submitted_at: string;
    updated_at: string;
  }[];
  next_cursor: string | null;
}
export interface FeedbackSlice {
  getFeedbackSuggestions(before?: string): Promise<FeedbackSuggestions>;
  sendFeedback(p: FeedbackPayload): Promise<{ id: string }>;
  getInterviewFeedback(id: string): Promise<InterviewFeedbackEnvelope>;
  saveInterviewFeedback(
    id: string,
    response: InterviewFeedbackInput,
  ): Promise<InterviewFeedbackEnvelope>;
  getRequiredFeedback(): Promise<RequiredFeedback>;
  getInterviewFeedbackMetrics(
    days: number,
    groupBy: FeedbackGroupBy,
  ): Promise<InterviewFeedbackMetrics>;
}

export interface InterviewFeedbackInput {
  version: string;
  answers: Record<string, string>;
  comment?: string;
  share_transcript?: boolean;
  comparison?: ToolComparison | null;
}
export interface InterviewFeedbackEnvelope {
  required: boolean;
  eligible: boolean;
  report_available: boolean;
  session_status?: string;
  feedback_version?: string;
  questionnaire: {
    comparison_version?: string;
    version: string;
    subject_key: string;
    subject_label: string;
    questions: {
      id: string;
      prompt: string;
      options: { value: string; label: string }[];
    }[];
  };
  response:
    | (InterviewFeedbackInput & { submitted_at: string; updated_at: string })
    | null;
}
export interface RequiredFeedback {
  items: {
    session_id: string;
    question_title: string;
    status: string;
    version: string;
    created_at: string;
  }[];
  total: number;
}
export type FeedbackGroupBy =
  "subject" | "domain" | "question" | "mode" | "provider" | "format" | "level";
export interface FeedbackTotals {
  eligible_sessions: number;
  responded_sessions: number;
  pending_sessions: number;
  response_rate: number | null;
}
export interface InterviewFeedbackMetrics {
  schema_version: string;
  days: number;
  group_by: FeedbackGroupBy;
  generated_at: string;
  totals: FeedbackTotals;
  comparison?: ToolComparisonMetrics;
  groups: (FeedbackTotals & {
    key: string;
    label: string;
    comparison?: ToolComparisonMetrics;
    questions: {
      id: string;
      label: string;
      distribution: Record<string, number>;
      answered_count: number;
      unrated_count: number;
      mean: number | null;
      favorable_count: number;
      favorable_label: string;
      favorable_rate: number | null;
    }[];
  })[];
  note: string;
}

export const feedbackHttp: FeedbackSlice = {
  getFeedbackSuggestions(before) {
    return req(
      "/api/v1/admin/interview-feedback/comments?limit=25" +
        (before ? "&before=" + encodeURIComponent(before) : ""),
    );
  },
  sendFeedback(p) {
    return req<{ id: string }>("/api/v1/feedback", {
      method: "POST",
      body: JSON.stringify(p),
    });
  },
  getInterviewFeedback(id) {
    return req(`/api/v1/sessions/${encodeURIComponent(id)}/feedback`);
  },
  saveInterviewFeedback(id, response) {
    return req(`/api/v1/sessions/${encodeURIComponent(id)}/feedback`, {
      method: "PUT",
      body: JSON.stringify(response),
    });
  },
  getRequiredFeedback() {
    return req("/api/v1/feedback/required");
  },
  getInterviewFeedbackMetrics(days, groupBy) {
    return req(
      `/api/v1/admin/interview-feedback/metrics?days=${days}&group_by=${encodeURIComponent(groupBy)}`,
    );
  },
};

export const feedbackMock: FeedbackSlice = {
  async getFeedbackSuggestions() {
    throw new Error(
      "Administrative suggestions require a connected service and an administrator account.",
    );
  },
  async sendFeedback() {
    return { id: "mock-feedback" };
  },
  async getInterviewFeedback() {
    return {
      required: false,
      eligible: false,
      report_available: false,
      questionnaire: {
        version: "post-interview-v1",
        subject_key: "demo",
        subject_label: "Demo",
        questions: [],
      },
      response: null,
    };
  },
  async saveInterviewFeedback() {
    throw new Error(
      "Demo responses are not sent or saved. Connect to the API to submit a check-in.",
    );
  },
  async getRequiredFeedback() {
    return { items: [], total: 0 };
  },
  async getInterviewFeedbackMetrics() {
    throw new Error(
      "Administrative metrics require a connected service and an administrator account.",
    );
  },
};
