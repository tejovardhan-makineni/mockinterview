// Small design-system primitives used across the app. Keep these dependency-free
// and consistent with globals.css (studio dark theme).
import Link from "next/link";
import type { ReactNode } from "react";

export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`mi-panel rounded-2xl border border-[var(--color-line)] bg-[var(--color-panel)] transition-colors ${className}`}
      style={{ borderRadius: "var(--radius-panel)" }}
    >
      {children}
    </div>
  );
}

type BtnProps = {
  children: ReactNode;
  onClick?: () => void;
  href?: string;
  type?: "button" | "submit";
  variant?: "primary" | "ghost" | "danger";
  disabled?: boolean;
  className?: string;
  title?: string;
};

export function Button({ children, onClick, href, type = "button", variant = "primary", disabled, className = "", title }: BtnProps) {
  const base = "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition disabled:opacity-40 disabled:cursor-not-allowed";
  const styles = {
    // Deep-blue gradient with white text — high contrast in every theme.
    primary: "text-white bg-gradient-to-b from-[#4d8eff] to-[#005ac2] hover:shadow-[0_0_16px_rgba(76,215,246,0.35)] border border-white/10",
    ghost: "border border-[var(--color-line)] text-[var(--color-ink)] hover:bg-[var(--color-panel-2)]",
    danger: "bg-[var(--color-bad)] text-[#0b0d12] hover:brightness-110",
  }[variant];
  const cls = `${base} ${styles} ${className}`;
  if (href) return <Link href={href} className={cls} title={title}>{children}</Link>;
  return <button type={type} onClick={onClick} disabled={disabled} className={cls} title={title}>{children}</button>;
}

export function Badge({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "accent" | "good" | "warn" | "bad" }) {
  const map = {
    muted: "text-[var(--color-muted)] border-[var(--color-line)]",
    accent: "text-[var(--color-accent)] border-[var(--color-accent)]",
    good: "text-[var(--color-good)] border-[var(--color-good)]",
    warn: "text-[var(--color-warn)] border-[var(--color-warn)]",
    bad: "text-[var(--color-bad)] border-[var(--color-bad)]",
  }[tone];
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${map}`}>{children}</span>;
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-[var(--color-muted)]">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-[var(--color-faint)]">{hint}</span>}
    </label>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-studio)] px-3.5 py-2.5 text-sm text-[var(--color-ink)] outline-none placeholder:text-[var(--color-faint)] focus:border-[var(--color-accent)] ${props.className ?? ""}`}
    />
  );
}
