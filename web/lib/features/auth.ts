// Auth feature slice — register / login / me / logout. Owns the User type and
// the token+user persistence. To change how auth works, touch this file (front
// end) + api/internal/auth (backend) + store/users.go (db). Nothing else.

import { req, TOKEN_KEY, USER_KEY, getToken } from "../http";

export interface User {
  id: string;
  email: string;
}

export interface AuthResult {
  token: string;
  user: User;
}

export interface AuthSlice {
  register(email: string, password: string): Promise<AuthResult>;
  login(email: string, password: string): Promise<AuthResult>;
  me(): Promise<User | null>;
  logout(): void;
}

function persist(r: AuthResult) {
  window.localStorage.setItem(TOKEN_KEY, r.token);
  window.localStorage.setItem(USER_KEY, JSON.stringify(r.user));
}

export const authHttp: AuthSlice = {
  async register(email, password) {
    const r = await req<AuthResult>("/api/v1/auth/register", { method: "POST", body: JSON.stringify({ email, password }) });
    persist(r); return r;
  },
  async login(email, password) {
    const r = await req<AuthResult>("/api/v1/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
    persist(r); return r;
  },
  async me() {
    if (!getToken()) return null;
    try { return await req<User>("/api/v1/auth/me"); } catch { return null; }
  },
  logout() { window.localStorage.removeItem(TOKEN_KEY); window.localStorage.removeItem(USER_KEY); },
};

export const authMock: AuthSlice = {
  async register(email) { return mockAuth(email); },
  async login(email) { return mockAuth(email); },
  async me() {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as User) : null;
  },
  logout() { if (typeof window !== "undefined") { window.localStorage.removeItem(TOKEN_KEY); window.localStorage.removeItem(USER_KEY); } },
};

function mockAuth(email: string): AuthResult {
  const user: User = { id: "mock-user", email };
  if (typeof window !== "undefined") {
    window.localStorage.setItem(TOKEN_KEY, "mock-token");
    window.localStorage.setItem(USER_KEY, JSON.stringify(user));
  }
  return { token: "mock-token", user };
}
