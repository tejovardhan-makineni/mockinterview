// Auth feature slice — register / login / me / logout. Owns the User type and
// the token+user persistence. To change how auth works, touch this file (front
// end) + api/internal/auth (backend) + store/users.go (db). Nothing else.

import {
  req,
  TOKEN_KEY,
  USER_KEY,
  getToken,
  ApiError,
  clearPrivateBrowserData,
} from "../http";

export interface User {
  id: string;
  email: string;
  email_verified?: boolean;
  role?: string;
}

export interface AuthResult {
  token: string;
  user: User;
  verification_required?: boolean;
  delivery_available?: boolean;
  development_action_url?: string;
}

export interface AuthSlice {
  register(email: string, password: string): Promise<AuthResult>;
  login(email: string, password: string): Promise<AuthResult>;
  me(): Promise<User | null>;
  logout(): void | Promise<void>;
}

function persist(r: AuthResult) {
  clearPrivateBrowserData();
  window.localStorage.setItem(TOKEN_KEY, r.token);
  window.localStorage.setItem(USER_KEY, JSON.stringify(r.user));
}

export const authHttp: AuthSlice = {
  async register(email, password) {
    const r = await req<AuthResult>("/api/v1/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    persist(r);
    return r;
  },
  async login(email, password) {
    const r = await req<AuthResult>("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    persist(r);
    return r;
  },
  async me() {
    if (!getToken()) return null;
    try {
      return await req<User>("/api/v1/auth/me");
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        clearPrivateBrowserData();
        return null;
      }
      throw error;
    }
  },
  async logout() {
    try {
      await req<void>("/api/v1/auth/logout", { method: "POST" });
    } finally {
      clearPrivateBrowserData();
    }
  },
};

export const authMock: AuthSlice = {
  async register(email) {
    return mockAuth(email);
  },
  async login(email) {
    return mockAuth(email);
  },
  async me() {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as User) : null;
  },
  logout() {
    clearPrivateBrowserData();
  },
};

function mockAuth(email: string): AuthResult {
  clearPrivateBrowserData();
  const user: User = { id: "mock-user", email, email_verified: true };
  if (typeof window !== "undefined") {
    window.localStorage.setItem(TOKEN_KEY, "mock-token");
    window.localStorage.setItem(USER_KEY, JSON.stringify(user));
  }
  return { token: "mock-token", user };
}

export const account = {
  resend: () =>
    req<{ message?: string; development_action_url?: string }>(
      "/api/v1/auth/verification/resend",
      { method: "POST", body: "{}" },
    ),
  verify: (token: string) =>
    req<{ message?: string }>("/api/v1/auth/verify", {
      method: "POST",
      body: JSON.stringify({ token }),
    }),
  forgot: (email: string) =>
    req<{ message?: string; development_action_url?: string }>(
      "/api/v1/auth/password/forgot",
      { method: "POST", body: JSON.stringify({ email }) },
    ),
  reset: (token: string, password: string) =>
    req<{ message?: string }>("/api/v1/auth/password/reset", {
      method: "POST",
      body: JSON.stringify({ token, password }),
    }),
  async change(current_password: string, password: string) {
    const result = await req<AuthResult>("/api/v1/auth/password/change", {
      method: "POST",
      body: JSON.stringify({ current_password, password }),
    });
    persist(result);
    return result;
  },
};
