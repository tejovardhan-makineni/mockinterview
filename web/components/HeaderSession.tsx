"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { api } from "@/lib/api";
import { disconnectAnalytics, syncAnalytics } from "@/lib/analytics";
import type { User } from "@/lib/features/auth";

export type HeaderSession = {
  user: User | null | undefined;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
};

const HeaderSessionContext = createContext<HeaderSession | null>(null);

/** Header presentation only; pages and API requests still authorize themselves. */
export function HeaderSessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const generation = useRef(0);
  const mounted = useRef(true);
  const pendingLogouts = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (pendingLogouts.current) return;
    const request = ++generation.current;
    try {
      const next = await api.me();
      if (!mounted.current || request !== generation.current) return;
      setUser(next);
      if (next) void syncAnalytics(next.id).catch(() => {});
    } catch {
      if (mounted.current && request === generation.current)
        setUser((known) => known ?? null);
    }
  }, []);

  const logout = useCallback(async () => {
    generation.current++;
    pendingLogouts.current++;
    try {
      await api.logout();
    } catch {
      // The auth slice clears local credentials even if the service is offline.
    } finally {
      pendingLogouts.current--;
      generation.current++;
      disconnectAnalytics();
      if (mounted.current) setUser(null);
    }
  }, []);

  const session = useMemo(
    () => ({ user, refresh, logout }),
    [user, refresh, logout],
  );
  return (
    <HeaderSessionContext.Provider value={session}>
      {children}
    </HeaderSessionContext.Provider>
  );
}

export function useHeaderSession(): HeaderSession | null {
  return useContext(HeaderSessionContext);
}
