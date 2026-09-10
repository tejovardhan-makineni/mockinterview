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
  policies_required?: boolean;
  adult_confirmed?: boolean;
  terms_version?: string;
  privacy_version?: string;
}

export interface LegalPolicy {
  terms_version: string;
  privacy_version: string;
  minimum_age: number;
  required: boolean;
}
export interface PolicyAcceptance {
  adult_confirmed: boolean;
  terms_version: string;
  privacy_version: string;
}

export interface AuthResult {
  token: string;
  user: User;
  verification_required?: boolean;
  delivery_available?: boolean;
  development_action_url?: string;
}

export interface AuthSlice {
  register(
    email: string,
    password: string,
    acceptance?: PolicyAcceptance,
  ): Promise<AuthResult>;
  legalPolicy(): Promise<LegalPolicy>;
  acceptPolicies(acceptance: PolicyAcceptance): Promise<User>;
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
  legalPolicy: () => req<LegalPolicy>("/api/v1/legal-policy"),
  async acceptPolicies(acceptance) {
    const user = await req<User>("/api/v1/auth/policies", {
      method: "POST",
      body: JSON.stringify(acceptance),
    });
    window.localStorage.setItem(USER_KEY, JSON.stringify(user));
    return user;
  },
  async register(email, password, acceptance) {
    const r = await req<AuthResult>("/api/v1/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password, ...acceptance }),
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
  async legalPolicy() {
    return {
      terms_version: "2026-09-10",
      privacy_version: "2026-09-10",
      minimum_age: 18,
      required: false,
    };
  },
  async acceptPolicies(acceptance) {
    const user = await authMock.me();
    if (!user) throw new Error("Sign in to continue.");
    const updated = { ...user, ...acceptance, policies_required: false };
    window.localStorage.setItem(USER_KEY, JSON.stringify(updated));
    return updated;
  },
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
