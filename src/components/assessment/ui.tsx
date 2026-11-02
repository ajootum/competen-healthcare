"use client";
// Shared look of the assessment components: theme tokens only (--cmp-*), 44px touch targets, one focus ring.
// Product-agnostic. Every colour is a token, never a hex.
import type { ReactNode } from "react";
import type { Issue } from "@/lib/assessment/core";

export const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cmp-theme-accent)]";
/** Touch target: 44px on every pointer, not only coarse ones (tablet-first). */
export const touch = "min-h-[var(--cmp-touch-min)]";
/** Builder controls are dense on a mouse and 44px on a touch screen. */
export const touchSm = "min-h-9 pointer-coarse:min-h-[var(--cmp-touch-min)]";

export const surface = "bg-[var(--cmp-app-surface)] border border-[var(--cmp-app-border)] text-[var(--cmp-app-text)]";
export const mutedText = "text-[var(--cmp-app-text-secondary)]";
export const fieldBase = `w-full rounded-lg border border-[var(--cmp-app-control-border)] bg-[var(--cmp-app-surface)] px-3 py-1.5 text-sm text-[var(--cmp-app-text)] ${focusRing}`;

export type Tone = "neutral" | "info" | "success" | "warning" | "error" | "critical" | "accent";
export const TONE: Record<Tone, string> = {
  neutral: "bg-[var(--cmp-surface-neutral)] text-[var(--cmp-text-neutral)] border-[var(--cmp-app-border)]",
  info: "bg-[var(--cmp-surface-information)] text-[var(--cmp-text-information)] border-[var(--cmp-app-border)]",
  success: "bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)] border-[var(--cmp-app-border)]",
  warning: "bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)] border-[var(--cmp-app-border)]",
  error: "bg-[var(--cmp-surface-error)] text-[var(--cmp-text-error)] border-[var(--cmp-app-border)]",
  critical: "bg-[var(--cmp-surface-critical)] text-[var(--cmp-text-critical)] border-[var(--cmp-color-critical)]",
  accent: "bg-[var(--cmp-theme-soft)] text-[var(--cmp-theme-ink)] border-[var(--cmp-theme-border)]",
};

export const classTone = (c: string): Tone => (c === "positive" ? "success" : c === "partial" ? "warning" : c === "negative" ? "error" : "neutral");

export function Chip({ children, tone = "neutral", title }: { children: ReactNode; tone?: Tone; title?: string }) {
  return <span title={title} className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold ${TONE[tone]}`}>{children}</span>;
}

type BtnKind = "primary" | "secondary" | "ghost" | "danger";
const BTN: Record<BtnKind, string> = {
  primary: "bg-[var(--cmp-theme-accent)] text-[var(--cmp-theme-on-accent)] border border-[var(--cmp-theme-accent)] hover:bg-[var(--cmp-theme-strong)]",
  secondary: "bg-[var(--cmp-app-surface)] text-[var(--cmp-app-text)] border border-[var(--cmp-app-control-border)] hover:bg-[var(--cmp-app-bg)]",
  ghost: "bg-transparent text-[var(--cmp-theme-ink)] border border-transparent hover:bg-[var(--cmp-theme-soft)]",
  danger: "bg-[var(--cmp-app-surface)] text-[var(--cmp-text-error)] border border-[var(--cmp-app-control-border)] hover:bg-[var(--cmp-surface-error)]",
};
export function Btn({ kind = "secondary", size = "md", className = "", ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { kind?: BtnKind; size?: "md" | "sm" }) {
  return (
    <button
      type="button"
      {...rest}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${size === "sm" ? touchSm : touch} ${BTN[kind]} ${focusRing} ${className}`}
    />
  );
}

/** A labelled control. The label wraps the control so the accessible name is the label text. */
export function Labelled({ label, hint, children, className = "" }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <div className={`flex min-w-0 flex-col gap-1 ${className}`}>
      <label className={`flex min-w-0 flex-col gap-1 text-xs font-semibold ${mutedText}`}>
        <span>{label}</span>
        {children}
      </label>
      {hint ? <span className={`text-xs ${mutedText}`}>{hint}</span> : null}
    </div>
  );
}

export function TextIn({ label, value, onChange, disabled, placeholder, hint, className }: { label: string; value: string; onChange: (v: string) => void; disabled?: boolean; placeholder?: string; hint?: string; className?: string }) {
  return (
    <Labelled label={label} hint={hint} className={className}>
      <input type="text" value={value} disabled={disabled} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className={`${fieldBase} ${touchSm}`} />
    </Labelled>
  );
}

export function NumIn({ label, value, onChange, disabled, min, max, step, className }: { label: string; value: number | null | undefined; onChange: (v: number | null) => void; disabled?: boolean; min?: number; max?: number; step?: number; className?: string }) {
  return (
    <Labelled label={label} className={className}>
      <input
        type="number" value={value ?? ""} disabled={disabled} min={min} max={max} step={step}
        onChange={(e) => { const t = e.target.value; if (t === "") onChange(null); else { const n = Number(t); if (Number.isFinite(n)) onChange(n); } }}
        className={`${fieldBase} ${touchSm}`}
      />
    </Labelled>
  );
}

export interface Opt { value: string; label: string; disabled?: boolean }
export function SelectIn({ label, value, options, onChange, disabled, className, hint }: { label: string; value: string; options: Opt[]; onChange: (v: string) => void; disabled?: boolean; className?: string; hint?: string }) {
  return (
    <Labelled label={label} className={className} hint={hint}>
      <select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} className={`${fieldBase} ${touchSm}`}>
        {options.map((o) => <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>)}
      </select>
    </Labelled>
  );
}

export function Check({ label, checked, onChange, disabled, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; hint?: string }) {
  return (
    <label className={`flex items-start gap-2 text-sm text-[var(--cmp-app-text)] ${touchSm}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className={`mt-1 h-5 w-5 shrink-0 accent-[var(--cmp-theme-accent)] ${focusRing}`} />
      <span>{label}{hint ? <span className={`block text-xs ${mutedText}`}>{hint}</span> : null}</span>
    </label>
  );
}

// ── validation display ───────────────────────────────────────────────────────────────────────────────────────
/** Issues whose path is exactly `path` or beneath it (".x" or "[n]"). */
export function issuesUnder(issues: Issue[], path: string, except: string[] = []): Issue[] {
  return issues.filter((i) => {
    if (i.path !== path && !i.path.startsWith(`${path}.`) && !i.path.startsWith(`${path}[`)) return false;
    return !except.some((e) => i.path === e || i.path.startsWith(`${e}.`) || i.path.startsWith(`${e}[`));
  });
}

export function Inline({ errors, warnings }: { errors: Issue[]; warnings: Issue[] }) {
  if (!errors.length && !warnings.length) return null;
  return (
    <ul className="mt-1 space-y-0.5 text-xs" data-inline-issues>
      {errors.map((e, i) => <li key={`e${i}`} role="alert" className="text-[var(--cmp-text-error)]">{e.message}</li>)}
      {warnings.map((w, i) => <li key={`w${i}`} className="text-[var(--cmp-text-warning)]">{w.message}</li>)}
    </ul>
  );
}

/** Errors and warnings of a document, all of them, each with its path. */
export function IssueSummary({ errors, warnings, label = "Validation" }: { errors: Issue[]; warnings: Issue[]; label?: string }) {
  const clean = errors.length === 0;
  return (
    <section aria-label={label} className={`rounded-lg border p-3 text-sm ${clean ? TONE.success : TONE.error}`}>
      <p className="font-semibold" role="status">
        {clean ? "No errors." : `${errors.length} ${errors.length === 1 ? "error" : "errors"}.`}
        {warnings.length ? ` ${warnings.length} ${warnings.length === 1 ? "warning" : "warnings"}.` : ""}
      </p>
      {(errors.length > 0 || warnings.length > 0) && (
        <ul className="mt-2 space-y-1">
          {errors.map((e, i) => <li key={`e${i}`}><span className="font-semibold">Error</span> <code className="text-xs">{e.path || "document"}</code> {e.message}</li>)}
          {warnings.map((w, i) => <li key={`w${i}`}><span className="font-semibold">Warning</span> <code className="text-xs">{w.path || "document"}</code> {w.message}</li>)}
        </ul>
      )}
    </section>
  );
}

export const humanize = (code: string): string => code.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
