// Shared HTTP transport for every feature slice. Feature files import `req`
// (and, for non-JSON endpoints, `BASE` + `authHeader`) from here so none of
// them re-implement base URL / bearer-token / RFC-7807 error handling. This is
// the only place that knows how to talk to the Go API.

export const BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8080";
export const TOKEN_KEY = "mi_token";
export const USER_KEY = "mi_user";

export function getToken(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(TOKEN_KEY) ?? "";
}

export function authHeader(): Record<string, string> {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

// req is the JSON workhorse: adds auth + content-type, unwraps RFC-7807
// `detail` on error, and treats 204 as void.
export async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json", ...authHeader() };
  const res = await fetch(BASE + path, { ...init, headers: { ...headers, ...(init?.headers as object) } });
  if (!res.ok) {
    let detail = res.statusText;
    try { detail = (await res.json()).detail || detail; } catch { /* ignore */ }
    throw new Error(detail);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export function wsBase(): string {
  return BASE.replace(/^http/, "ws");
}
