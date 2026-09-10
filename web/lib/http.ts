// Shared transport: preserve error status so outages never masquerade as logout.
export const BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8080";
export const TOKEN_KEY = "mi_token";
export const USER_KEY = "mi_user";
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
export function getToken(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}
export function authHeader(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: "Bearer " + token } : {};
}
export async function req<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(BASE + path, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...authHeader(),
        ...(init?.headers as object),
      },
    });
  } catch {
    throw new ApiError(
      "We cannot reach the service. Check your connection and try again. Your saved interviews are still there.",
      0,
      "network",
    );
  }
  if (!res.ok) {
    let message = res.statusText || "Request failed";
    let code: string | undefined;
    try {
      const body = await res.json();
      message = body.detail || body.message || message;
      code = body.code;
    } catch {
      /* no JSON body */
    }
    const requestId = res.headers.get("X-Request-ID");
    throw new ApiError(
      message + (requestId ? " (Support ID: " + requestId + ")" : ""),
      res.status,
      code,
    );
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}
export function wsBase(): string {
  return BASE.replace(/^http/, "ws");
}
export function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";
}
export function clearPrivateBrowserData() {
  if (typeof window === "undefined") return;
  for (const name of ["localStorage", "sessionStorage"] as const) {
    try {
      const storage = window[name];
      const keys = Array.from({ length: storage.length }, (_, i) =>
        storage.key(i),
      );
      for (const key of keys)
        if (
          key &&
          /^mi_(token|user|resume_|mock_|workspace|device_)|^mi\.cameraConsent/.test(
            key,
          )
        )
          storage.removeItem(key);
    } catch {
      /* storage disabled */
    }
  }
}
