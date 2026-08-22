"use client";

import type { Unavailable } from "./types";
import { practitionerView, type Refusal } from "@/lib/practice/refusal-presentation";

// CPR-V5-006 -- the three states, in one place.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// A FAILED READ IS NEVER A ZERO, AND THAT IS A RENDERING RULE BEFORE IT IS AN ENGINE ONE.
//
// The engine already distinguishes them: `reason` is "capability" when the caller may not see the list,
// "read_failed" when the database refused, and null when the read worked. A screen that renders all
// three as an empty section throws that distinction away at the last step -- and "nothing is waiting"
// is the most dangerous sentence a clinical workspace can say when the truth is "I could not find out".
//
// So every count and every list on this screen goes through these two components, and there is no way to
// render one without answering which of the three states it is in.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export const CARD = "rounded-xl border border-gray-200 bg-white";

/** A date or timestamp, shown as it is stored. No locale formatting -- a reformatted date is a claim. */
export const day = (v: string | null | undefined) => (v ? String(v).slice(0, 10) : null);
export const clock = (v: string | null | undefined) =>
  v && String(v).length >= 16 ? String(v).slice(11, 16) : null;

export function whenLabel(v: string | null | undefined, today: string): string {
  if (!v) return "";
  const d = day(v);
  if (d === today) {
    const t = clock(v);
    return t ? `today ${t}` : "today";
  }
  return d ?? "";
}

/**
 * The one place "there is nothing here" is allowed to be said -- and only when that is what happened.
 *
 * `nothing` is the caller's own words for the empty case, because "no results" and "nobody is waiting"
 * carry different weight and a generic phrase would flatten both.
 */
export function Absence({ reason, error, nothing, className = "" }: {
  reason: Unavailable;
  error: string | null;
  nothing: string;
  className?: string;
}) {
  if (reason === "capability") {
    return (
      <p className={`text-[12px] text-gray-500 ${className}`}>
        <span className="font-semibold text-gray-600">Not shown to you.</span>{" "}
        Your role does not carry the capability this list needs, so it was not read at all.
      </p>
    );
  }
  if (reason === "read_failed") {
    return (
      <p className={`text-[12px] text-[var(--cmp-text-warning)] ${className}`}>
        <span className="font-semibold">Could not be read.</span>{" "}
        This is not an empty list &mdash; the read did not return.
        {error && <span className="mt-0.5 block font-mono text-[11px] opacity-80">{error}</span>}
      </p>
    );
  }
  return <p className={`text-[12px] text-gray-400 ${className}`}>{nothing}</p>;
}

/**
 * A figure that cannot lie about itself.
 *
 * An unavailable read renders an em dash, never 0. A truncated one renders "at least n", because
 * `count: 50, truncated: true` means fifty were fetched and there may be more.
 */
export function Count({ count, atLeast, reason, className = "" }: {
  count: number | null;
  atLeast?: boolean;
  reason: Unavailable;
  className?: string;
}) {
  if (count === null) {
    return (
      <span className={className} title={reason === "capability" ? "Not shown to you" : "Could not be read"}>
        &mdash;
      </span>
    );
  }
  return (
    <span className={className}>
      {atLeast && <span className="mr-0.5 text-[0.6em] font-semibold align-middle">at least</span>}
      {count}
    </span>
  );
}

/** A boundary sentence that has to travel with the figure it qualifies. */
export function Boundary({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-1.5 border-t border-gray-100 pt-1.5 text-[11px] leading-relaxed text-gray-500">
      {children}
    </p>
  );
}

/**
 * The refusals, collapsed. Never a silent omission -- an omission reads as "there is nothing there".
 *
 * ⚠ CPR-HFE-REF-001: THIS COMPONENT SEES ONLY THE PRACTITIONER HALF, BY CONSTRUCTION. It maps every
 * refusal through practitionerView(), which returns a NEW object carrying title, reason and any real
 * next action -- and nothing else. It cannot render a reason code, a spec reference or a table name
 * even by accident, because it never holds them. The old version took { key, label, detail } where
 * `detail` was engineering prose shown to doctors.
 */
export function Refusals({ refuses, title, blurb }: {
  refuses: readonly Refusal[];
  title: string;
  blurb: string;
}) {
  if (refuses.length === 0) return null;
  const shown = refuses.map(practitionerView);
  return (
    <section className={`${CARD} border-dashed bg-gray-50/60 p-4`}>
      <h2 className="text-[13px] font-bold text-gray-900">{title}</h2>
      <p className="mt-0.5 text-[11px] text-gray-500">{blurb}</p>
      <ul className="mt-2 flex flex-col gap-1">
        {shown.map(r => (
          <li key={r.key}>
            <details className="group">
              <summary className="cursor-pointer list-none text-[12px] font-semibold text-gray-700 hover:text-gray-900">
                <span className="mr-1 inline-block text-gray-400 transition-transform group-open:rotate-90">&rsaquo;</span>
                {r.title}
              </summary>
              <p className="mt-0.5 pl-3 text-[11px] leading-relaxed text-gray-500">{r.reason}</p>
              {/* s10: a CTA ONLY where the practitioner can genuinely change the state. */}
              {r.nextAction && (
                {/* ⚠ WAS text-[var(--cmp-accent,#4338ca)], AND THE FALLBACK WAS DOING ALL THE WORK.
                    `--cmp-accent` is defined nowhere -- globals.css carries 55 --cmp-* tokens and that
                    is not one of them -- so the hex rendered every time. It also rendered the SAME hex
                    every time, while --cp-primary-deep is re-declared per practice accent
                    ([data-practice-accent="blue"], "cyan", ...). So a practice that chose an accent got
                    one link that stayed indigo and never said why. The design-system harness caught it
                    as a raw hex, which it was, but the raw hex was the symptom: a token name nobody
                    defined, papered over by a fallback that then became the real colour. */}
                <a href={r.nextAction.href}
                  className="mt-1 ml-3 inline-block text-[11px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
                  {r.nextAction.label} &rarr;
                </a>
              )}
            </details>
          </li>
        ))}
      </ul>
    </section>
  );
}
