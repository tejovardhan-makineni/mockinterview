import type { PracticeSession } from "./domain";

// No account password or access token is written to device storage.
const base = (process.env.EXPO_PUBLIC_ANALYTICS_API_BASE || "").replace(
  /\/$/,
  "",
);
let token = "";
let consentSince = 0;
const pendingUploads = new Set<Promise<Response>>();
export function analyticsConfigured() {
  try {
    const url = new URL(base);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}
export function mobileSharingEnabled() {
  return consentSince > 0;
}
export function mobileSharingConnected() {
  return !!token;
}
export function setMobileSharing(enabled: boolean) {
  consentSince = enabled ? Date.now() : 0;
}
export async function connectMobileSharing(email: string, password: string) {
  if (!analyticsConfigured())
    throw new Error("Sharing server is not configured in this build.");
  const response = await fetch(base + "/api/v1/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok)
    throw new Error("Could not sign in. Check your hosted account details.");
  const result = await response.json();
  if (!result.token) throw new Error("Sharing sign-in failed.");
  token = result.token;
}
export function disconnectMobileSharing() {
  consentSince = 0;
  token = "";
}
export function mobileAnalyticsPayload(
  session: PracticeSession,
  feedback = "",
) {
  const end = Date.parse(session.completedAt || session.startedAt);
  const duration = Math.max(
    0,
    Math.min(86400, Math.round((end - Date.parse(session.startedAt)) / 1000)),
  );
  return {
    consent: true,
    consent_version: "2026-10-04",
    client_session_id: session.id,
    source: "mobile",
    status: "complete",
    provider: "self-review",
    model: "none",
    duration_seconds: Number.isFinite(duration) ? duration : 0,
    turn_count: session.answers.length,
    error_count: 0,
    feedback: feedback.slice(0, 5000),
    report: {
      overall: 0,
      scored: false,
      coaching_md: JSON.stringify({
        topic: session.topicId,
        reflection: session.reflection || "",
        answers: session.answers.map((answer) => ({
          question: answer.questionId,
          checked: answer.checked,
        })),
      }).slice(0, 20000),
    },
  };
}
export async function shareMobileResult(
  session: PracticeSession,
  feedback = "",
): Promise<boolean> {
  const started = Date.parse(session.startedAt);
  if (
    !consentSince ||
    !token ||
    !analyticsConfigured() ||
    !Number.isFinite(started) ||
    started < consentSince
  )
    return false;
  try {
    const upload = fetch(base + "/api/v1/community/analytics", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify(mobileAnalyticsPayload(session, feedback)),
      signal: AbortSignal.timeout(8000),
    });
    pendingUploads.add(upload);
    try {
      return (await upload).ok;
    } finally {
      pendingUploads.delete(upload);
    }
  } catch {
    return false;
  }
}
export async function deleteMobileAnalytics() {
  setMobileSharing(false);
  if (!analyticsConfigured() || !token)
    throw new Error("Connect your hosted account first.");
  await Promise.allSettled([...pendingUploads]);
  const response = await fetch(base + "/api/v1/community/analytics", {
    method: "DELETE",
    headers: { Authorization: "Bearer " + token },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok)
    throw new Error("Could not delete shared data. Try again when connected.");
}
export async function sendMobileFeedback(message: string) {
  if (!token || !analyticsConfigured())
    throw new Error("Connect your hosted account in About first.");
  const response = await fetch(base + "/api/v1/feedback", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + token,
    },
    body: JSON.stringify({
      kind: "product",
      message: message.slice(0, 5000),
      tags: ["mobile"],
      include_diagnostics: false,
      share_transcript: false,
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok)
    throw new Error(
      "Feedback was not sent. Keep your note and try again when connected.",
    );
}
