import { req } from "../http";

export interface BetaApplication {
  id: string;
  user_id: string;
  email?: string;
  motivation: string;
  feedback_commitment: boolean;
  status: "pending" | "approved" | "rejected";
  created_at: string;
  reviewed_at?: string;
}
export interface TemplateRequest {
  id: string;
  email?: string;
  profession: string;
  goal: string;
  level: string;
  description: string;
  status: "new" | "planned" | "shipped" | "closed";
  created_at: string;
}
export interface SharedInterviewPayload {
  status: string;
  provider: string;
  model: string;
  duration_seconds: number;
  turn_count: number;
  error_count: number;
  score?: number;
  feedback?: string;
  report?: {
    overall: number;
    scored: boolean;
    coaching_md: string;
    scores?: { dimension: string; score: number; rationale?: string }[];
  };
}
export interface CommunityOverview {
  applications: BetaApplication[];
  requests: TemplateRequest[];
  uploads: {
    id: string;
    user_id: string;
    client_session_id: string;
    source: string;
    created_at: string;
    consent_version: string;
    payload: SharedInterviewPayload;
  }[];
  feedback:
    | {
        id: string;
        email?: string;
        kind: string;
        message: string;
        rating?: number;
        status: string;
        created_at: string;
        context?: Record<string, unknown>;
      }[]
    | null;
}
export const communityApi = {
  betaStatus: () =>
    req<{ application: BetaApplication | null; unlimited: boolean }>(
      "/api/v1/community/beta",
    ),
  applyBeta: (motivation: string, feedback_commitment: boolean) =>
    req<BetaApplication>("/api/v1/community/beta", {
      method: "POST",
      body: JSON.stringify({ motivation, feedback_commitment }),
    }),
  requestTemplate: (
    input: Pick<
      TemplateRequest,
      "profession" | "goal" | "level" | "description"
    >,
  ) =>
    req<TemplateRequest>("/api/v1/community/templates", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  overview: () => req<CommunityOverview>("/api/v1/admin/community"),
  reviewBeta: (id: string, status: "approved" | "rejected") =>
    req<void>(`/api/v1/admin/community/beta/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }),
  reviewTemplate: (id: string, status: TemplateRequest["status"]) =>
    req<void>(`/api/v1/admin/community/templates/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }),
  reviewFeedback: (id: string, status: string) =>
    req<void>(`/api/v1/feedback/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }),
};
