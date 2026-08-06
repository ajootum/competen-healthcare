import Link from "next/link";
import { PI_PANEL, PROVENANCE_BADGE, STATE_COPY } from "@/lib/practice/intelligence-constants";

// The pieces every area of Practice Intelligence is built from.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// THREE THINGS ARE ENFORCED HERE RATHER THAN REMEMBERED IN NINE PLACES.
//
//   1. A FIGURE IS NEVER JUST A NUMBER. `Figure` will not render a bare count: it takes a status, and a
//      status that is not "ok" produces a reason instead of a nought. There is no prop combination that
//      draws a zero for a read that failed -- CPR-PI-001 s12, expressed as a type rather than as care.
//
//   2. A FIGURE CARRIES WHERE IT CAME FROM. `Provenance` renders the date range and the source
//      definition under every panel -- s15's fifth acceptance criterion, which is also the fix for a
//      comp full of unexplained numbers.
//
//   3. A FIGURE IS THE LENGTH OF A LIST YOU CAN OPEN. `Openable` draws the count AND the rows behind it,
//      so a panel physically cannot show a count with nothing behind it.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export const CARD = "rounded-xl border border-gray-200 bg-white p-4";

type Status = "ok" | "unknowable" | "unreadable" | "not_permitted";

type Openable = {
  key: string; label: string; definition: string;
  count: number | null; status: Status; reason: string | null;
  sample: { id: string; label: string; note: string | null; href: string | null }[];
  sampleIsPartial: boolean; href: string;
  formula: string; sources: string[]; fromDay: string | null; toDay: string | null;
  asOf: string; provenance: "computed" | "derived" | "ai";
};

/** The panel header: a tinted icon badge, the title, and an optional action on the right. */
export function PanelHead({ panel, title, note, action }: {
  panel: keyof typeof PI_PANEL; title: string; note?: string;
  action?: { href: string; label: string };
}) {
  const p = PI_PANEL[panel] ?? PI_PANEL.refused;
  return (
    <div className="flex items-start gap-2">
      <span aria-hidden className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg text-[13px] ${p.badge}`}>
        {p.icon}
      </span>
      <div className="min-w-0">
        <h2 className="text-[13px] font-bold text-gray-900">{title}</h2>
        {note && <p className="mt-0.5 text-[11px] text-gray-500">{note}</p>}
      </div>
      {action && (
        <Link href={action.href}
          className="ml-auto shrink-0 rounded-lg border border-gray-200 px-2.5 py-1 text-[11px] font-semibold text-gray-700 hover:bg-gray-50">
          {action.label}
        </Link>
      )}
    </div>
  );
}

/** COMPUTED / DERIVED / AI / NOT COMPUTED. See PROVENANCE_BADGE on why arithmetic is never labelled AI. */
export function ProvenanceChip({ kind }: { kind: keyof typeof PROVENANCE_BADGE }) {
  const b = PROVENANCE_BADGE[kind];
  return (
    <span title={b.title}
      className={`inline-block rounded px-1.5 py-[1px] text-[9px] font-bold tracking-wide ${b.chip}`}>
      {b.label}
    </span>
  );
}

/**
 * The date range and source definition under a figure. s15's fifth criterion.
 *
 * Deliberately small and deliberately always present. A practitioner does not read this on a normal
 * Tuesday; they read it on the day the number surprises them, which is the only day it matters.
 */
export function Provenance({ formula, sources, fromDay, toDay }: {
  formula: string; sources: string[]; fromDay?: string | null; toDay?: string | null;
}) {
  return (
    <details className="mt-2 group">
      <summary className="cursor-pointer list-none text-[10px] text-gray-400 hover:text-gray-600">
        {fromDay && toDay ? `${fromDay} to ${toDay}` : "as of now"} · how this is counted
      </summary>
      <p className="mt-1 text-[10px] leading-relaxed text-gray-500">{formula}</p>
      {sources.length > 0 && (
        <p className="mt-1 text-[10px] text-gray-400">From: {sources.join(" · ")}</p>
      )}
    </details>
  );
}

/**
 * A status that is not "ok", rendered as the sentence it is.
 *
 * ⚠ THREE DIFFERENT SENTENCES, AND ONLY ONE OF THEM IS A PROBLEM. "Nothing happened", "you may not
 * look" and "I could not look" are three facts, and a screen that draws all three as an empty panel
 * tells a practitioner their practice is quiet because a query timed out.
 */
export function StateNote({ status, reason }: { status: Status; reason: string | null }) {
  if (status === "ok") return null;
  const copy = status === "not_permitted" ? STATE_COPY.not_permitted
    : status === "unreadable" ? STATE_COPY.unreadable
    : { title: "Not computed", body: "" };
  return (
    <div className={`mt-2 rounded-lg border px-2.5 py-2 ${
      status === "unreadable" ? "border-amber-200 bg-amber-50/60" : "border-dashed border-slate-300 bg-slate-50/60"
    }`}>
      <p className="text-[11px] font-semibold text-gray-700">{copy.title}</p>
      {reason && <p className="mt-0.5 text-[10px] leading-relaxed text-gray-600">{reason}</p>}
      {!reason && copy.body && <p className="mt-0.5 text-[10px] text-gray-500">{copy.body}</p>}
    </div>
  );
}

/**
 * A count and the list behind it.
 *
 * ⚠ THE FIGURE TAKES THE HUE IT IS GIVEN, and that is the rule that keeps being lost in this codebase:
 * a tinted badge beside a black number leaves the colour on the decoration. The number is what is being
 * read, so the number is what is coloured.
 *
 * ⚠ A NON-OK STATUS DRAWS AN EM DASH, NEVER A NOUGHT. There is no prop that makes it do otherwise.
 */
export function OpenableCountBlock({ item, figureClass, dense }: {
  item: Openable; figureClass?: string; dense?: boolean;
}) {
  const ok = item.status === "ok" && item.count !== null;
  return (
    <div>
      <div className="flex items-baseline gap-2">
        <span className={`text-2xl font-bold tabular-nums ${ok ? (figureClass ?? "text-gray-900") : "text-slate-300"}`}>
          {ok ? item.count : "—"}
        </span>
        <Link href={item.href} className="text-[12px] font-semibold text-gray-800 hover:underline">
          {item.label}
        </Link>
        <span className="ml-auto"><ProvenanceChip kind={item.provenance === "ai" ? "ai" : item.provenance === "derived" ? "derived" : "computed"} /></span>
      </div>
      {!dense && <p className="mt-0.5 text-[11px] text-gray-500">{item.definition}</p>}
      <StateNote status={item.status} reason={item.reason} />
      {/* A count with a reason attached is still a count: an "at least this many" figure keeps its
          sample. That is why the reason is drawn above the list rather than instead of it. */}
      {ok && item.reason && item.sample.length === 0 && (
        <p className="mt-1 text-[10px] text-gray-500">{item.reason}</p>
      )}
      {ok && item.sample.length > 0 && (
        <ul className="mt-2 flex flex-col">
          {item.sample.map(s => (
            <li key={`${item.key}-${s.id}`} className="flex items-baseline gap-2 border-b border-gray-100 py-1 last:border-0">
              {s.href ? (
                <Link href={s.href} className="min-w-0 truncate text-[12px] text-gray-800 hover:underline">{s.label}</Link>
              ) : (
                <span className="min-w-0 truncate text-[12px] text-gray-700">{s.label}</span>
              )}
              {s.note && <span className="ml-auto shrink-0 text-[10px] text-gray-500">{s.note}</span>}
            </li>
          ))}
          {item.sampleIsPartial && (
            <li className="pt-1">
              <Link href={item.href} className="text-[11px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
                Open all {item.count} →
              </Link>
            </li>
          )}
        </ul>
      )}
      {ok && item.count === 0 && (
        <p className="mt-1.5 text-[11px] text-gray-400">
          None. {STATE_COPY.empty.body}
        </p>
      )}
      <Provenance formula={item.formula} sources={item.sources} fromDay={item.fromDay} toDay={item.toDay} />
    </div>
  );
}

/**
 * A refusal, drawn in the position the figure would have occupied.
 *
 * ⚠ THE POINT IS THAT IT KEEPS ITS PLACE. An omitted card teaches nothing and reads as a feature nobody
 * got round to; a card that says what cannot be computed and what would make it computable is the
 * difference between a gap and a lie.
 */
export function RefusedCard({ label, why, wouldRequire }: {
  label: string; why: string; wouldRequire: string;
}) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/50 p-3">
      <div className="flex items-center gap-2">
        <span aria-hidden className="grid h-6 w-6 place-items-center rounded-lg bg-slate-100 text-[12px] text-slate-500">⊘</span>
        <p className="text-[12px] font-bold text-gray-700">{label}</p>
        <span className="ml-auto"><ProvenanceChip kind="refused" /></span>
      </div>
      <p className="mt-1.5 text-[11px] leading-relaxed text-gray-600">{why}</p>
      <p className="mt-1.5 text-[10px] leading-relaxed text-gray-500">
        <span className="font-semibold">What would make it real: </span>{wouldRequire}
      </p>
    </div>
  );
}

/**
 * A comparison against the period before -- as two counts, never as a percentage, and refused outright
 * where the previous window was not real.
 *
 * ⚠ CPR-PI-002 s5 DOES ASK FOR "time trends, comparisons", SO THIS IS NOT A BLANKET REFUSAL. The comps
 * put "▲12% vs last week" on every tile and two things are wrong with that and only two: the percentage,
 * and the assumption that last week existed. Both are fixed rather than the feature being dropped.
 */
export function Comparison({ c }: {
  c: {
    label: string; current: number | null; prior: number | null; change: number | null;
    status: Status; reason: string | null; priorFromDay: string | null; priorToDay: string | null;
    formula: string; sources: string[];
  };
}) {
  const has = c.status === "ok" && c.change !== null && c.prior !== null;
  return (
    <div className="border-b border-gray-100 py-1.5 last:border-0">
      <div className="flex items-baseline gap-2">
        <span className="text-[12px] text-gray-700">{c.label}</span>
        <span className="ml-auto text-[13px] font-bold tabular-nums text-gray-900">
          {c.current ?? "—"}
        </span>
      </div>
      {has ? (
        <p className="text-[10px] text-gray-500">
          {c.prior} in {c.priorFromDay} to {c.priorToDay}
          <span className={`ml-1.5 font-semibold ${c.change! > 0 ? "text-emerald-700" : c.change! < 0 ? "text-rose-700" : "text-gray-500"}`}>
            {/* A SIGNED COUNT. Not a percentage, and not a bare arrow: "+9" says how many more. */}
            {c.change! > 0 ? "+" : ""}{c.change}
          </span>
        </p>
      ) : (
        <p className="text-[10px] text-gray-400">
          {c.reason ?? "no comparison"}
        </p>
      )}
    </div>
  );
}
