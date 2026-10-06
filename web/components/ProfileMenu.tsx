"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import {
  IconChevronDown,
  IconProfile,
  IconResume,
  IconSettings,
  IconShield,
  IconSignOut,
} from "./icons";

export function ProfileMenu({
  admin = false,
  settingsActive = false,
  onLogout,
}: {
  admin?: boolean;
  settingsActive?: boolean;
  onLogout?: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const focusLast = useRef(false);
  const id = useId();
  const items = () =>
    Array.from(
      container.current?.querySelectorAll<HTMLElement>(
        '[role="menuitem"]:not(:disabled)',
      ) || [],
    );

  useEffect(() => {
    if (!open) return;
    const entries = items();
    (focusLast.current ? entries.at(-1) : entries[0])?.focus();
    const dismiss = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);

  function handleMenuKey(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      trigger.current?.focus();
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const entries = items();
    const current = entries.indexOf(document.activeElement as HTMLElement);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? entries.length - 1
          : (current + (event.key === "ArrowDown" ? 1 : -1) + entries.length) %
            entries.length;
    entries[next]?.focus();
  }

  const itemClass =
    "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm no-underline hover:bg-[var(--color-panel-2)] focus-visible:bg-[var(--color-panel-2)] focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]";
  return (
    <div
      ref={container}
      className="relative"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        ref={trigger}
        id={`${id}-trigger`}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? `${id}-menu` : undefined}
        className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm hover:bg-[var(--color-panel-2)] focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]"
        onClick={() => {
          focusLast.current = false;
          setOpen(!open);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            focusLast.current = event.key === "ArrowUp";
            setOpen(true);
          }
        }}
      >
        <IconProfile className="h-4 w-4" />
        <span className="sr-only sm:not-sr-only">Profile</span>
        <IconChevronDown
          className={`hidden h-3.5 w-3.5 sm:block ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div
          id={`${id}-menu`}
          role="menu"
          aria-labelledby={`${id}-trigger`}
          onKeyDown={handleMenuKey}
          className="absolute right-0 z-50 mt-2 max-h-[calc(100dvh-88px)] w-52 max-w-[calc(100vw-32px)] overflow-y-auto overscroll-contain rounded-xl border border-[var(--color-line)] bg-[var(--color-panel)] p-1.5 shadow-lg"
        >
          <Link
            role="menuitem"
            tabIndex={-1}
            href="/settings"
            aria-current={settingsActive ? "page" : undefined}
            className={itemClass}
            onClick={() => setOpen(false)}
          >
            <IconSettings className="h-4 w-4" />
            Settings
          </Link>
          <Link
            role="menuitem"
            tabIndex={-1}
            href="/resume-review"
            className={itemClass}
            onClick={() => setOpen(false)}
          >
            <IconResume className="h-4 w-4" />
            Resume review
          </Link>
          {admin && (
            <Link
              role="menuitem"
              tabIndex={-1}
              href="/admin"
              className={itemClass}
              onClick={() => setOpen(false)}
            >
              <IconShield className="h-4 w-4" />
              Admin portal
            </Link>
          )}
          {onLogout && (
            <div className="mt-1 border-t border-[var(--color-line)] pt-1">
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                disabled={loggingOut}
                className={itemClass}
                onClick={async () => {
                  setLoggingOut(true);
                  try {
                    await onLogout();
                  } finally {
                    setLoggingOut(false);
                    setOpen(false);
                  }
                }}
              >
                <IconSignOut className="h-4 w-4" />
                {loggingOut ? "Logging out…" : "Log out"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
