import Link from "next/link";
import type {
  IntelDistribution, IntelProportion, IntelModule,
} from "@/lib/practice/intelligence";
import { StateNote, Provenance, ProvenanceChip } from "./Ui";

// The three shapes the CPR-V5-003 engine returns, drawn once each.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠ A DISTRIBUTION IS BARS OF COUNTS, NOT A DONUT OF PERCENTAGES.
//
// All three comps draw these as rings with slices labelled "22 (25%)", "48 (55%)", "6 (33%)". The
// parenthesis is the problem: it is the same label whether the ring holds four records or four hundred,
// and a practitioner reading "33% of my follow-ups were missed" over a base of six has been told
// something that sounds like a measurement and is not.
//
// So the bar's LENGTH carries the share -- which is what a picture is for -- and the TEXT carries the
// count and the denominator as two separate numbers. Anyone who wants the ratio can see both halves of
// it; nobody is handed a percentage they did not compute themselves.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/** Bar tints, cycled by position. NOT semantic: a distribution's slices do not rank each other. */
const BAR = [
  "bg-[var(--cp-primary)]", "bg-violet-400", "bg-emerald-400", "bg-cyan-400",
  "bg-amber-400", "bg-sky-400", "bg-rose-400", "bg-teal-400", "bg-indigo-400",
];

export function Distribution({ d, max }: { d: IntelDistribution; max?: number }) {
  const shown = d.slices.filter(s => s.total > 0);
  // ⚠ EVERY MEMBER OF THE VOCABULARY IS EMITTED BY THE ENGINE EVEN AT ZERO, and this hides the empty
  // ones only when at least one is non-empty. Hiding them all would make an empty distribution look
  // like a missing one, and showing the zeroes on a full distribution buries the signal.
  const rows = shown.length > 0 ? shown : d.slices;
  const top = Math.max(1, ...rows.map(s => s.total));
  const total = d.of ?? 0;

  return (
    <div>
      <div className="flex items-baseline gap-2">
        <h3 className="text-[12px] font-bold text-gray-800">{d.label}</h3>
        {d.status === "ok" && d.of !== null && (
          <span className="ml-auto text-[10px] text-gray-500">of {d.of}</span>
        )}
      </div>
      <StateNote status={d.status} reason={d.reason} />
      {d.status === "ok" && (
        <>
          {total === 0 ? (
            <p className="mt-1.5 text-[11px] text-gray-400">
              Nothing in this period. A fact about the period, not a gap in the data.
            </p>
          ) : (
            <ul className="mt-1.5 flex flex-col gap-1">
              {rows.slice(0, max ?? 9).map((s, i) => (
                <li key={s.key} className="flex items-center gap-2">
                  <span className="w-28 shrink-0 truncate text-[11px] text-gray-700" title={s.label}>{s.label}</span>
                  <span className="h-2 flex-1 overflow-hidden rounded-full bg-gray-100">
                    <span className={`block h-full rounded-full ${BAR[i % BAR.length]}`}
                      style={{ width: `${Math.max(s.total === 0 ? 0 : 4, (s.total / top) * 100)}%` }} />
                  </span>
                  {/* THE COUNT AND THE DENOMINATOR AS TWO NUMBERS. Never "25%". */}
                  <span className="w-16 shrink-0 text-right text-[11px] font-semibold tabular-nums text-gray-900">
                    {s.total} <span className="font-normal text-gray-400">of {total}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {d.unrecorded > 0 && (
            <p className="mt-1 text-[10px] text-amber-700">
              {d.unrecorded} record{d.unrecorded === 1 ? "" : "s"} could not be classified and {d.unrecorded === 1 ? "is" : "are"} not
              in any bar above. Disclosed rather than filed under &ldquo;other&rdquo;, because a column
              nobody fills in makes every bar look more complete than it is.
            </p>
          )}
        </>
      )}
      <Provenance formula={d.formula} sources={d.sources} />
    </div>
  );
}

/** A proportion, as a numerator and a denominator and nothing else. There is no rate field to render. */
export function Proportion({ p }: { p: IntelProportion }) {
  const ok = p.status === "ok" && p.numerator !== null && p.denominator !== null;
  return (
    <div className="border-b border-gray-100 py-2 last:border-0">
      <div className="flex items-baseline gap-2">
        <span className="text-[12px] text-gray-700">{p.label}</span>
        <span className="ml-auto text-[13px] font-bold tabular-nums text-gray-900">
          {ok ? <>{p.numerator} <span className="text-[11px] font-normal text-gray-500">of {p.denominator}</span></> : "—"}
        </span>
      </div>
      <StateNote status={p.status} reason={p.reason} />
      {ok && p.caveat && <p className="mt-0.5 text-[10px] leading-relaxed text-amber-700">{p.caveat}</p>}
      <Provenance formula={p.formula} sources={p.sources} />
    </div>
  );
}

/** One of metrics.ts's twelve. Null is an em dash and a reason, never a nought. */
export function MetricLine({ m, figureClass }: {
  m: { label: string; value: number | null; unit: string; status: string; reason: string | null; formula: string; sources: string[]; observations: number | null };
  figureClass?: string;
}) {
  const ok = m.status === "ok" && m.value !== null;
  return (
    <div className="border-b border-gray-100 py-1.5 last:border-0">
      <div className="flex items-baseline gap-2">
        <span className="text-[12px] text-gray-700">{m.label}</span>
        <span className={`ml-auto text-[14px] font-bold tabular-nums ${ok ? (figureClass ?? "text-gray-900") : "text-slate-300"}`}>
          {ok ? m.value : "—"}
          {ok && m.unit === "minutes" && <span className="ml-0.5 text-[10px] font-normal text-gray-500">min</span>}
        </span>
      </div>
      {!ok && m.reason && <p className="text-[10px] leading-relaxed text-gray-500">{m.reason}</p>}
      <Provenance formula={m.formula} sources={m.sources} />
    </div>
  );
}

/**
 * A module that is unavailable, or one whose reads had problems.
 *
 * ⚠ `problems` IS NOT `unavailableReason`. A module carrying a problem still produced its data -- the
 * disclosure sits BESIDE the figures rather than instead of them, because "this is what I found, and
 * here is what I could not see" is a more useful sentence than either half alone.
 */
export function ModuleNote({ module }: { module: IntelModule<unknown> }) {
  if (module.available && module.problems.length === 0) return null;
  return (
    <div className={`mt-2 rounded-lg border px-2.5 py-2 ${
      module.available ? "border-amber-200 bg-amber-50/50" : "border-dashed border-slate-300 bg-slate-50/60"
    }`}>
      <p className="text-[11px] font-semibold text-gray-700">
        {module.available ? "What this panel could not see" : "Not available"}
      </p>
      {module.unavailableReason && (
        <p className="mt-0.5 text-[10px] leading-relaxed text-gray-600">{module.unavailableReason}</p>
      )}
      {module.problems.length > 0 && (
        <ul className="mt-1 flex flex-col gap-0.5">
          {module.problems.map((p, i) => (
            <li key={i} className="text-[10px] leading-relaxed text-gray-600">— {p}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A row of diagnosis or procedure labels, counted as typed. */
export function LabelList({ rows, empty, hrefFor }: {
  rows: { label: string; total: number; patients?: number }[];
  empty: string;
  hrefFor?: (label: string) => string;
}) {
  if (rows.length === 0) return <p className="mt-2 text-[12px] text-gray-400">{empty}</p>;
  const top = Math.max(1, ...rows.map(r => r.total));
  return (
    <ul className="mt-2 flex flex-col">
      {rows.map((r, i) => (
        <li key={r.label} className="flex items-center gap-2 border-b border-gray-100 py-1 last:border-0">
          {hrefFor ? (
            <Link href={hrefFor(r.label)} className="w-32 shrink-0 truncate text-[12px] text-gray-800 hover:underline" title={r.label}>
              {r.label}
            </Link>
          ) : (
            <span className="w-32 shrink-0 truncate text-[12px] text-gray-800" title={r.label}>{r.label}</span>
          )}
          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-100">
            <span className={`block h-full rounded-full ${BAR[i % BAR.length]}`}
              style={{ width: `${Math.max(4, (r.total / top) * 100)}%` }} />
          </span>
          <span className="w-8 shrink-0 text-right text-[12px] font-bold tabular-nums text-gray-900">{r.total}</span>
          {r.patients !== undefined && (
            <span className="w-16 shrink-0 text-right text-[10px] text-gray-500">
              {r.patients} {r.patients === 1 ? "patient" : "patients"}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

/** The AI panel's header line: it says COMPUTED because arithmetic is not AI. See PROVENANCE_BADGE. */
export function ComputedNotAi() {
  return (
    <p className="mt-1 flex items-center gap-1.5 text-[10px] text-gray-500">
      <ProvenanceChip kind="computed" />
      <span>
        Every line below is arithmetic over your own rows. No model wrote any of it, and labelling it AI
        because it sits in a panel with that word on it would teach you to discount a count you could
        check yourself.
      </span>
    </p>
  );
}
