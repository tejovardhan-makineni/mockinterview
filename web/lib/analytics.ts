import { apiBase, getToken } from "./http";
import {
  IS_DESKTOP,
  desktopPreferences,
  saveDesktopPreferences,
} from "./desktop";
import type { Report } from "./features/interview";
import { api, IS_MOCK } from "./api";

export const ANALYTICS_VERSION = "2026-10-05";
export const REMOTE_ANALYTICS_BASE = IS_DESKTOP
  ? "/desktop/remote"
  : process.env.NEXT_PUBLIC_ANALYTICS_API_BASE || "";
let remoteToken = "";
let remoteLocalToken = "";
let remoteAccount = "";
let generation = 0;
const inFlight = new Set<string>();
const pendingUploads = new Set<Promise<Response>>();
const preferenceKey = (uid: string) => "mi_analytics_" + uid;
export function analyticsSince(uid: string): number {
  if (IS_DESKTOP) return desktopPreferences().analyticsSince;
  try {
    const stored = localStorage.getItem(preferenceKey(uid));
    if (stored !== null) return Math.max(0, Number(stored) || 0);
    // Start with new interviews only; never backfill existing private history.
    const since = Date.now();
    localStorage.setItem(preferenceKey(uid), String(since));
    return since;
  } catch {
    return 0;
  }
}
export function setAnalyticsConsent(uid: string, enabled: boolean) {
  generation++;
  if (IS_DESKTOP) return saveDesktopPreferences({ shareAnalytics: enabled });
  try {
    if (enabled) localStorage.setItem(preferenceKey(uid), String(Date.now()));
    else localStorage.setItem(preferenceKey(uid), "0");
  } catch {
    /* Optional sharing never blocks practice. */
  }
  window.dispatchEvent(new Event("mi-analytics-change"));
}
export function analyticsTarget() {
  if (IS_DESKTOP) return apiBase() + "/desktop/remote";
  const base = REMOTE_ANALYTICS_BASE || (IS_DESKTOP ? "" : apiBase());
  try {
    const url = new URL(base);
    if (
      url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      )
    )
      return "";
    if (url.username || url.password || url.search || url.hash) return "";
    return base.replace(/\/$/, "");
  } catch {
    return "";
  }
}
export function analyticsConnected() {
  return (
    (!REMOTE_ANALYTICS_BASE && !IS_DESKTOP) ||
    (!!remoteToken && remoteLocalToken === getToken())
  );
}
export async function connectAnalytics(email: string, password: string) {
  const base = analyticsTarget();
  if (!base || !REMOTE_ANALYTICS_BASE)
    throw new Error("A secure analytics server has not been configured.");
  const response = await fetch(base + "/api/v1/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok)
    throw new Error(
      "Could not sign in to the sharing server. Check your account details.",
    );
  const result = await response.json();
  if (!result.token) throw new Error("The server did not return a session.");
  generation++;
  remoteAccount = result.user?.id || email.toLowerCase();
  remoteToken = result.token;
  remoteLocalToken = getToken();
  window.dispatchEvent(new Event("mi-analytics-change"));
}
export async function deleteSharedAnalytics() {
  const base = analyticsTarget();
  const token = REMOTE_ANALYTICS_BASE
    ? analyticsConnected()
      ? remoteToken
      : ""
    : getToken();
  if (!base || !token)
    throw new Error("Sign in to the sharing server to remove uploaded data.");
  // Wait for earlier writes before deleting so a late response cannot restore them.
  await Promise.allSettled([...pendingUploads]);
  const result = await fetch(base + "/api/v1/community/analytics", {
    method: "DELETE",
    headers: { Authorization: "Bearer " + token },
    signal: AbortSignal.timeout(12000),
  });
  if (!result.ok)
    throw new Error(
      "Shared data could not be deleted. Try again when the server is available.",
    );
}
export function disconnectAnalytics() {
  remoteToken = "";
  remoteAccount = "";
  remoteLocalToken = "";
  generation++;
  window.dispatchEvent(new Event("mi-analytics-change"));
}
export function subscribeAnalytics(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener("mi-analytics-change", callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener("mi-analytics-change", callback);
  };
}

export function sharedReport(report: Report) {
  const result = {
    overall: report.overall,
    scored: report.scored ?? false,
    coaching_md: report.coaching_md.slice(0, 40000),
    scores: report.scores.slice(0, 50).map((entry) => ({
      dimension: entry.dimension.slice(0, 160),
      score: entry.score,
      rationale: entry.evidence.slice(0, 4000),
    })),
  };
  // Leave headroom for metrics within the server's 64 KiB envelope. Full
  // reports remain in private history; optional improvement copies are bounded.
  while (new TextEncoder().encode(JSON.stringify(result)).byteLength > 58000) {
    result.coaching_md = result.coaching_md.slice(
      0,
      Math.floor(result.coaching_md.length / 2),
    );
    for (const score of result.scores)
      score.rationale = score.rationale.slice(
        0,
        Math.floor(score.rationale.length / 2),
      );
  }
  return result;
}

// Best effort, consent-gated and idempotent on the server. Never upload keys,
// transcripts, raw exception messages, camera data or voice recordings.
export async function syncAnalytics(uid: string) {
  const since = analyticsSince(uid);
  const target = analyticsTarget();
  const token = REMOTE_ANALYTICS_BASE
    ? analyticsConnected()
      ? remoteToken
      : ""
    : getToken();
  if (IS_MOCK || !since || !target || !token || inFlight.has(uid)) return;
  const epoch = generation;
  inFlight.add(uid);
  try {
    const sessions = await api.listSessions();
    for (const item of sessions) {
      if (epoch !== generation || !analyticsSince(uid)) break;
      const created = Date.parse(item.created_at);
      if (
        !Number.isFinite(created) ||
        created < since ||
        ![
          "complete",
          "feedback_failed",
          "abandoned",
          "expired",
          "interrupted",
        ].includes(item.status)
      )
        continue;
      const key = `mi_analytics_sent_${uid}_${remoteAccount}_${item.id}_${item.status}`;
      try {
        if (localStorage.getItem(key)) continue;
      } catch {}
      const session = await api.getSession(item.id);
      const includeReport =
        !IS_DESKTOP ||
        (desktopPreferences().shareInterviewResults &&
          created >= desktopPreferences().resultsSince);
      const report =
        item.status === "complete" && includeReport
          ? await api.getReport(item.id)
          : undefined;
      const metrics = session.runtime_metrics;
      // Old server versions cannot supply accurate operational metrics.
      // Leave this upload eligible for a later visit after the API update.
      if (!metrics) continue;
      if (epoch !== generation || !analyticsSince(uid)) break;
      const upload = fetch(target + "/api/v1/community/analytics", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify({
          consent: true,
          consent_version: ANALYTICS_VERSION,
          client_session_id: item.id,
          source: IS_DESKTOP || REMOTE_ANALYTICS_BASE ? "local" : "web",
          status:
            item.status === "feedback_failed"
              ? "failed"
              : item.status === "expired"
                ? "abandoned"
                : item.status,
          provider: session.provider || "",
          model: session.model || "",
          duration_seconds: Math.min(metrics.duration_seconds, 86400),
          turn_count: metrics.turn_count,
          error_count: metrics.error_count,
          score:
            report && "overall" in report && report.scored
              ? report.overall
              : undefined,
          report:
            report && !("status" in report) ? sharedReport(report) : undefined,
        }),
        signal: AbortSignal.timeout(8000),
      });
      pendingUploads.add(upload);
      let response: Response;
      try {
        response = await upload;
      } finally {
        pendingUploads.delete(upload);
      }
      if (response.ok) {
        try {
          localStorage.setItem(key, "1");
        } catch {}
      }
    }
  } catch {
    /* Service offline: practice and saved results stay available. */
  } finally {
    inFlight.delete(uid);
  }
}

export function analyticsIdentity() {
  return remoteAccount;
}
export async function setResultsConsent(enabled: boolean) {
  generation++;
  await saveDesktopPreferences({ shareInterviewResults: enabled });
}
/** Only an explicit action sends a message copy. Analytics consent is unrelated. */
export async function sendProjectCopy(
  path: "/api/v1/feedback" | "/api/v1/community/templates",
  payload: unknown,
) {
  if (!IS_DESKTOP || !REMOTE_ANALYTICS_BASE || !analyticsConnected())
    throw new Error(
      "Connect your hosted account in Settings to send a project copy.",
    );
  const response = await fetch(analyticsTarget() + path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + remoteToken,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok)
    throw new Error(
      "The project service did not confirm delivery. Your local copy is saved.",
    );
}
