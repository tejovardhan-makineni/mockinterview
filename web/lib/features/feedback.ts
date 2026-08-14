// Feedback feature slice — send user feedback (general, or captured DURING an
// interview with debug context attached). Backend: api/internal/feedback;
// db: store/feedback.go.

import { req } from "../http";

export type FeedbackContext = Record<string, unknown>;

export interface FeedbackPayload {
  kind: "general" | "interview";
  message: string;
  rating?: number; // 0 = unset, else 1..5
  context?: FeedbackContext;
}

export interface FeedbackSlice {
  sendFeedback(p: FeedbackPayload): Promise<{ id: string }>;
}

export const feedbackHttp: FeedbackSlice = {
  sendFeedback(p) {
    return req<{ id: string }>("/api/v1/feedback", { method: "POST", body: JSON.stringify(p) });
  },
};

export const feedbackMock: FeedbackSlice = {
  async sendFeedback() {
    return { id: "mock-feedback" };
  },
};
