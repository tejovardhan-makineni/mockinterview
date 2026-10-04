"use client";
import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import {
  analyticsSince,
  setAnalyticsConsent,
  subscribeAnalytics,
  REMOTE_ANALYTICS_BASE,
  analyticsTarget,
  analyticsConnected,
  connectAnalytics,
  deleteSharedAnalytics,
  syncAnalytics,
} from "@/lib/analytics";
import { IS_DESKTOP, desktopPreferences } from "@/lib/desktop";
import { setResultsConsent, disconnectAnalytics } from "@/lib/analytics";
import { Button, Field, Input } from "./ui";
export function AnalyticsSettings({ userId }: { userId?: string }) {
  const enabled = useSyncExternalStore(
    subscribeAnalytics,
    () => !!userId && !!analyticsSince(userId),
    () => false,
  );
  const connected = useSyncExternalStore(
    subscribeAnalytics,
    analyticsConnected,
    () => false,
  );
  const shareResults = useSyncExternalStore(
    subscribeAnalytics,
    () => desktopPreferences().shareInterviewResults,
    () => false,
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-3">
      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          className="mt-1"
          checked={enabled}
          disabled={!userId || busy}
          onChange={async (e) => {
            if (!userId) return;
            const checked = e.target.checked;
            setBusy(true);
            try {
              await setAnalyticsConsent(userId, checked);
            } catch (error) {
              setMessage(
                error instanceof Error
                  ? error.message
                  : "Could not save consent.",
              );
              return;
            } finally {
              setBusy(false);
            }
            if (checked) void syncAnalytics(userId);
            setMessage(
              checked
                ? "Sharing is on for new interviews."
                : "Sharing is off. You can also delete previously shared data below.",
            );
          }}
        />
        <span>
          <strong>Share analytics</strong>
          <br />
          <span className="text-[var(--color-muted)]">
            {IS_DESKTOP
              ? "Share usage and error counts privately with the admin. Optional; retries when connected."
              : "Share new interview results and error metrics privately with the admin to improve practice. Optional; skips uploads when offline."}{" "}
            <Link href="/privacy" className="underline">
              Details
            </Link>
          </span>
        </span>
      </label>
      {IS_DESKTOP && (
        <label className="flex items-start gap-3 text-sm">
          <input
            className="mt-1"
            type="checkbox"
            checked={shareResults}
            disabled={!userId || busy}
            onChange={async (e) => {
              setBusy(true);
              try {
                await setResultsConsent(e.target.checked);
                setMessage("Interview result sharing preference saved.");
              } catch (error) {
                setMessage(
                  error instanceof Error
                    ? error.message
                    : "Could not save consent.",
                );
              } finally {
                setBusy(false);
              }
            }}
          />
          <span>
            <strong>Include interview results</strong>
            <br />
            <span className="text-[var(--color-muted)]">
              Include new scores and written feedback with analytics. Reports
              can contain personal details.
            </span>
          </span>
        </label>
      )}
      {REMOTE_ANALYTICS_BASE && !connected && (
        <div className="space-y-3 rounded-lg border border-[var(--color-line)] p-4">
          <p className="text-xs">
            Connect your hosted account to share from this installation. Session
            lasts until this app closes or reloads. Sign-in alone does not
            enable analytics. Server:{" "}
            {IS_DESKTOP
              ? "mockinterview.live"
              : analyticsTarget() || "Not configured"}
          </p>
          <Field label="Hosted account email">
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Field label="Hosted account password">
            <Input
              type="password"
              autoComplete="off"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <Button
            disabled={busy || !email || !password}
            variant="ghost"
            onClick={async () => {
              setBusy(true);
              setMessage("");
              try {
                await connectAnalytics(email, password);
                setMessage("Sharing connected for this app session.");
                if (userId) void syncAnalytics(userId);
              } catch (e) {
                setMessage(
                  e instanceof Error ? e.message : "Connection failed.",
                );
              } finally {
                setPassword("");
                setBusy(false);
              }
            }}
          >
            Connect sharing
          </Button>
        </div>
      )}
      {REMOTE_ANALYTICS_BASE && connected && (
        <Button
          variant="ghost"
          onClick={() => {
            disconnectAnalytics();
            setMessage("Sharing account disconnected.");
          }}
        >
          Disconnect sharing account
        </Button>
      )}
      <Button
        variant="ghost"
        disabled={busy || !userId}
        onClick={async () => {
          setBusy(true);
          try {
            if (userId) await setAnalyticsConsent(userId, false);
            await deleteSharedAnalytics();
            setMessage("Shared interview analytics deleted. Sharing is off.");
          } catch (e) {
            setMessage(e instanceof Error ? e.message : "Deletion failed.");
          } finally {
            setBusy(false);
          }
        }}
      >
        Delete shared analytics
      </Button>
      {message && (
        <p role="status" className="text-xs">
          {message}
        </p>
      )}
    </div>
  );
}
