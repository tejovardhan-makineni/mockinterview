"use client";
import Link from "next/link";
import {
  cloneElement,
  isValidElement,
  useId,
  type ReactElement,
  type ReactNode,
  type ButtonHTMLAttributes,
} from "react";
export function Panel({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={
        "mi-panel border border-[var(--color-line)] bg-[var(--color-panel)] " +
        className
      }
    >
      {children}
    </div>
  );
}
type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  href?: string;
  variant?: "primary" | "ghost" | "danger";
};
export function Button({
  children,
  href,
  type = "button",
  variant = "primary",
  disabled,
  className = "",
  ...rest
}: BtnProps) {
  const colors =
    variant === "primary"
      ? "bg-[var(--color-accent)] text-[var(--color-panel)] border-[var(--color-accent)]"
      : variant === "danger"
        ? "text-[var(--color-bad)] border-[var(--color-bad)] bg-transparent"
        : "border-[var(--color-line)] bg-[var(--color-panel)] text-[var(--color-ink)]";
  const cls =
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-semibold transition hover:brightness-95 disabled:opacity-50 " +
    colors +
    " " +
    className;
  if (href)
    return (
      <Link
        href={href}
        className={cls}
        title={rest.title}
        aria-disabled={disabled || undefined}
        onClick={(e) => {
          if (disabled) e.preventDefault();
        }}
      >
        {children}
      </Link>
    );
  return (
    <button {...rest} type={type} disabled={disabled} className={cls}>
      {children}
    </button>
  );
}
export function Badge({
  children,
  tone = "muted",
}: {
  children: ReactNode;
  tone?: "muted" | "accent" | "good" | "warn" | "bad";
}) {
  const color =
    tone === "muted" ? "var(--color-muted)" : "var(--color-" + tone + ")";
  return (
    <span
      className="inline-flex items-center rounded-md bg-[var(--color-panel-2)] px-2 py-1 text-xs font-medium"
      style={{ color }}
    >
      {children}
    </span>
  );
}
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  const generated = useId();
  const control = isValidElement(children)
    ? (children as ReactElement<{ id?: string; "aria-describedby"?: string }>)
    : null;
  const id = control?.props.id ?? generated;
  const hintId = generated + "-hint";
  return (
    <div className="block text-sm">
      <label htmlFor={id} className="mb-2 block font-medium">
        {label}
      </label>
      {control
        ? cloneElement(control, {
            id,
            "aria-describedby":
              [control.props["aria-describedby"], hint ? hintId : undefined]
                .filter(Boolean)
                .join(" ") || undefined,
          })
        : children}
      {hint && (
        <span
          id={hintId}
          className="mt-2 block text-xs text-[var(--color-muted)]"
        >
          {hint}
        </span>
      )}
    </div>
  );
}
export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input {...props} className={"field-select " + (props.className ?? "")} />
  );
}
export function ErrorNotice({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="notice border-[var(--color-bad)] text-[var(--color-bad)]"
    >
      <p>{message}</p>
      {onRetry && (
        <Button variant="ghost" onClick={onRetry} className="mt-3">
          Try again
        </Button>
      )}
    </div>
  );
}
