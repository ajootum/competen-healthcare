// CPR-PD-014 "Build 1" — THE ROUTING HALF OF THE PRACTICE PRODUCT DIRECTOR WORKSPACE.
//
// ⚠ WHY EVERY PD PAGE RENDERS THIS AND NOTHING ELSE.
//
// The Product Director specifications (CPR-PD-002 … CPR-PD-012) describe roughly ninety surfaces made
// almost entirely of figures: adoption rates, retention curves, MRR, availability, P95 latency, funnel
// conversion. A gate-check of the live schema before this build found that the overwhelming majority of
// those figures have NO PRODUCER — not an empty table, not a zero: no table, no event stream, no column.
//
// This repository has a recorded failure from exactly that gap (five frozen screens shipped reading
// fields that never existed and rendered convincingly wrong numbers). So Build 1 ships the route, the
// guard and the name, and says plainly that the module is not built. It renders NO number, NO chart, NO
// sample row and NO em-dash standing in for a measured zero — an em-dash in a metric slot is a claim
// that something was measured and came back empty, which would be a lie here.
//
// The wording lives in this one component so it is written once and cannot drift page to page. Each page
// supplies only what is specific to it: its name, its spec-derived purpose, what the built module will
// show, and — where the gate-check established that the underlying data CANNOT exist today rather than
// merely being unbuilt — the specific reason, named.
//
// Build 2 replaces the body of these pages module by module. It does not replace this file: a module
// that still has no producer keeps this state until it has one.

type Props = {
  /** The module name, exactly as PD-001's frozen sidebar labels it. */
  name: string;
  /** The spec identifier this page answers to, e.g. "CPR-PD-008 §2". */
  spec: string;
  /** One line, taken from the spec's own submodule/purpose table. What this module is FOR. */
  purpose: string;
  /** What the built module will show. Descriptive prose only — never a figure, never an example value. */
  willShow: string;
  /**
   * Set ONLY where the gate-check established that the data cannot be produced today, with the reason.
   * "Not yet built" is the default and needs no sentence; "cannot be built until X exists" does.
   */
  absence?: string;
};

export default function PdNotBuilt({ name, spec, purpose, willShow, absence }: Props) {
  return (
    <div className="space-y-4">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
          Practice Product Director
        </p>
        <h1 className="mt-0.5 text-2xl font-bold text-gray-900">{name}</h1>
        <p className="mt-1 max-w-3xl text-sm text-gray-600">{purpose}</p>
        <p className="mt-1 font-mono text-[11px] text-gray-500">{spec}</p>
      </div>

      <div className="max-w-3xl rounded-xl border border-gray-200 bg-[var(--cmp-surface-neutral)] p-4">
        <p className="text-[13px] font-bold text-gray-900">This module is not built yet.</p>
        <p className="mt-1.5 text-[13px] leading-relaxed text-gray-700">
          The route, its navigation entry and its server-side authorization check exist. The module
          behind them does not. When it is built, it will show {willShow}
        </p>
        <p className="mt-2 text-[12px] leading-relaxed text-gray-500">
          Nothing on this page is a measurement. No count, rate, chart, sample row or placeholder value
          is shown, because none of them would have been measured from anything.
        </p>
      </div>

      {absence && (
        <div className="max-w-3xl rounded-xl border border-[var(--cmp-color-warning)] bg-[var(--cmp-surface-warning)] p-4">
          <p className="text-[13px] font-bold text-[var(--cmp-text-warning)]">
            Why this one is blocked rather than merely pending
          </p>
          <p className="mt-1.5 text-[13px] leading-relaxed text-gray-800">{absence}</p>
        </div>
      )}
    </div>
  );
}
