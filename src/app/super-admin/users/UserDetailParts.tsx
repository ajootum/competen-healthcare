"use client";

import type { ReactNode } from "react";
import { FIELD_STATE_LABEL, FIELD_STATE_WHY, type FieldState } from "@/lib/hq/user-detail";

// Small shared pieces of the user detail workspace. Tokens only (--cmp-*), no hex.

const STATE_TONE: Record<Exclude<FieldState, "value">, string> = {
  missing: "border-[var(--cmp-color-warning)] bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)]",
  not_applicable: "border-gray-300 bg-[var(--cmp-surface-neutral)] text-gray-600",
  restricted: "border-[var(--cmp-color-information)] bg-[var(--cmp-surface-information)] text-[var(--cmp-text-information)]",
  not_set_up: "border-gray-300 bg-[var(--cmp-surface-neutral)] text-gray-600",
};

/** Missing, Not applicable, Restricted or Not set up here: the state's name, with its sentence for assistive technology. */
export function StatePill({ state, why }: { state: Exclude<FieldState, "value">; why?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-semibold ${STATE_TONE[state]}`}>
      {state === "restricted" && <span aria-hidden="true">{"\u{1F512}"}</span>}
      {FIELD_STATE_LABEL[state]}
      <span className="sr-only">. {why ?? FIELD_STATE_WHY[state]}</span>
    </span>
  );
}

/** A label above a value, or above the state that explains why there is no value. */
export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-bold uppercase tracking-wide text-gray-500">{label}</dt>
      <dd className="mt-0.5 break-words text-[13px] text-gray-900">{children}</dd>
      {hint && <p className="mt-0.5 text-[11px] text-gray-500">{hint}</p>}
    </div>
  );
}

/** A value, or the state that explains its absence. */
export function ValueOrState({ value, whenAbsent = "missing", why }: { value: string | null | undefined; whenAbsent?: Exclude<FieldState, "value" | "restricted">; why?: string }) {
  return value != null && String(value).trim() !== "" ? <>{value}</> : <StatePill state={whenAbsent} why={why} />;
}

export function SectionCard({ id, title, subtitle, children, action }: {
  id: string; title: string; subtitle?: string; children: ReactNode; action?: ReactNode;
}) {
  return (
    <section id={`ud-${id}`} aria-labelledby={`ud-${id}-h`} className="scroll-mt-28 border-b border-gray-100 py-5 first:pt-2 last:border-0">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 id={`ud-${id}-h`} className="text-[14px] font-bold text-gray-900">{title}</h3>
          {subtitle && <p className="mt-0.5 text-[12px] text-gray-600">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function SubHead({ children }: { children: ReactNode }) {
  return <h4 className="mb-2 mt-4 text-[11px] font-bold uppercase tracking-wide text-gray-500 first:mt-0">{children}</h4>;
}

/** A source that could not be read. Said as what it is, never shown as an empty list. */
export function SourceNote({ state, what }: { state: "not_set_up" | "unreadable"; what: string }) {
  return state === "not_set_up"
    ? <p className="text-[12px] text-gray-600"><StatePill state="not_set_up" /> {what} is not set up in this environment yet.</p>
    : <p role="status" className="text-[12px] text-[var(--cmp-text-warning)]">{what} could not be read just now. This is not the same as having none.</p>;
}

export const btn = "inline-flex items-center justify-center rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 pointer-coarse:min-h-[var(--cmp-touch-min)]";
export const btnPrimary = "inline-flex items-center justify-center rounded-lg bg-teal-700 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-teal-800 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 pointer-coarse:min-h-[var(--cmp-touch-min)]";
export const inputCls = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-[13px] text-gray-900 focus:outline-none focus:ring-2 focus:ring-teal-500/40 pointer-coarse:min-h-[var(--cmp-touch-min)]";

export function Notice({ kind, children }: { kind: "ok" | "err"; children: ReactNode }) {
  return (
    <p role={kind === "err" ? "alert" : "status"}
      className={`mt-2 rounded-lg border px-3 py-2 text-[12px] ${kind === "ok"
        ? "border-[var(--cmp-color-success)] bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)]"
        : "border-[var(--cmp-color-critical)] bg-[var(--cmp-surface-critical)] text-[var(--cmp-text-critical)]"}`}>
      {children}
    </p>
  );
}
