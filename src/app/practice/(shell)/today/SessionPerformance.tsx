import { PANEL, PERFORMANCE_SWATCH } from "@/lib/practice/palette";

// CPR-V5-004 s2 SESSION PERFORMANCE -- how the session actually ran, measured from records that exist.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠ THIS IS THE CARD THE COMP GETS MOST WRONG, AND THE PROPS ARE SHAPED SO IT CANNOT BE COPIED.
//
// The mockup draws four figures: "On-time Rate 62% · Goal >80%", "Utilisation 78% · Goal >80%",
// "Patients / hour 3.2", "Avg Consult 22m · Goal <20m". Every one of the four is refused, and not for
// house style:
//
//   THE PERCENTAGES. 62% on-time over a clinic of eight is five people. The percentage is the same
//   number whether it describes eight patients or eight hundred, which makes it exactly the wrong
//   figure for a practitioner deciding what to do about the afternoon. So there is a `value` and an
//   `of`, there is no `percent`, and `unit` admits only the two units metrics.ts defines. A bar may be
//   drawn from the pair; the printed figure is the pair.
//
//   THE GOALS. Nothing in this product stores a target. A "Goal: <20m" printed here would be a number
//   this file made up, rendered in the practice's own screen, in the practice's own voice -- and
//   "22m against a goal of 20m" is read as a judgement somebody made about a morning's work. There is
//   no `goal` prop and no `target` prop. If the practice ever wants one it belongs in
//   practice_configuration (migration 203), authored by a named person on a known date, and it belongs
//   here only once it can be read back.
//
//   PATIENTS PER HOUR. A rate with an implied denominator of one hour, over a session that may have run
//   fifty minutes. It is expressible as a pair -- patients seen, of hours elapsed -- and that is the
//   only form this card will take.
//
// AND NOTHING IS COMPARED. There is no yesterday here, no last week and no other practitioner: nothing
// in this product has recorded a baseline, so any such line would be a sentence about data that does not
// exist. `basis` carries the caller's own formula and sources, so each figure can be checked instead.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export type PerformanceFigure = {
  /** A PERFORMANCE_SWATCH key where one fits -- cyan for time, indigo for a count, the comp's own split. */
  key: string;
  label: string;
  /** The count, the numerator, or a duration. Null with a reason whenever it was not earned. */
  value: number | null;
  /**
   * The denominator, when the figure is "n of m". Null makes it a plain count or a duration.
   *
   * ⚠ SEPARATE FROM `value` SO A RATIO CANNOT BE PASSED IN. A caller holding only "62%" cannot fill
   * these two fields; it has to go back and find out how many it was out of, which is the point.
   */
  of: number | null;
  unit: "count" | "minutes";
  /** Why there is no value: could not read, not permitted, or nothing yet. Three different answers. */
  reason: string | null;
  /** Records measured, and records read then dropped by a documented exclusion. Both disclosed. */
  observations: number | null;
  excluded: number | null;
  /** The formula and its sources, in the caller's words. Shown on hover; never composed here. */
  basis: string | null;
};

export type SessionPerformanceProps = {
  figures: PerformanceFigure[];
  /** Set when nothing could be read, so the card says so rather than drawing four em dashes. */
  unavailableReason: string | null;
  /** A closing sentence from the caller, rendered verbatim. Null draws nothing. */
  note: string | null;
};

const card = "rounded-xl border border-gray-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]";

export default function SessionPerformance({ figures, unavailableReason, note }: SessionPerformanceProps) {
  return (
    <section className={card} aria-labelledby="session-performance-h">
      <div className="mb-3 flex items-center gap-2">
        <span aria-hidden className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[12px] ${PANEL.performance.badge}`}>
          {PANEL.performance.icon}
        </span>
        <h2 id="session-performance-h" className="text-[13px] font-bold text-gray-900">How this session ran</h2>
      </div>

      {unavailableReason ? (
        <p className="text-[12px] text-gray-500">{unavailableReason}</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {figures.map(f => {
            const barPercent = f.value !== null && f.of !== null && f.of > 0
              ? Math.min(100, Math.max(0, Math.round((f.value / f.of) * 100)))
              : null;
            return (
              <div key={f.key} className="rounded-lg bg-[var(--cp-canvas)] px-3 py-2.5"
                title={f.value === null ? (f.reason ?? undefined) : (f.basis ?? undefined)}>
                {f.value === null ? (
                  <>
                    <p className="text-[22px] font-bold leading-none text-gray-300">—</p>
                    <p className="mt-1 text-[11px] leading-tight text-gray-500">{f.label}</p>
                    {/* Three different reasons behind one em dash. The card says which. */}
                    <p className="text-[9px] leading-tight text-gray-400">{f.reason ?? "No figure available."}</p>
                  </>
                ) : (
                  <>
                    <p className={`text-[22px] font-bold leading-none tabular-nums ${PERFORMANCE_SWATCH[f.key] ?? "text-gray-900"}`}>
                      {f.value}
                      {f.unit === "minutes" && <span className="ml-0.5 text-[12px] font-semibold opacity-70">min</span>}
                      {f.of !== null && (
                        <span className="ml-1 text-[13px] font-semibold text-gray-500">of {f.of}</span>
                      )}
                    </p>
                    <p className="mt-1 text-[11px] leading-tight text-gray-600">{f.label}</p>
                    {/* THE BAR IS THE PAIR, DRAWN. It carries no figure of its own, because the figure
                        it would carry is the percentage this card exists to refuse. */}
                    {barPercent !== null && (
                      <p aria-hidden className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-gray-200/70">
                        <span className="block h-full rounded-full bg-[var(--cp-primary)]" style={{ width: `${barPercent}%` }} />
                      </p>
                    )}
                    {/* NO MEAN WITHOUT ITS DENOMINATOR, and anything dropped by an exclusion is named:
                        a mean over eight of twenty is a different claim from a mean over eight. */}
                    {f.observations !== null && (
                      <p className="text-[9px] leading-tight text-gray-400">
                        over {f.observations} {f.observations === 1 ? "measurement" : "measurements"}
                        {f.excluded !== null && f.excluded > 0 ? `, ${f.excluded} excluded` : ""}
                      </p>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      <p className="mt-2 text-[10px] leading-relaxed text-gray-400">
        Each figure is a count and the number it is out of, measured from check-in, consultation start and
        consultation end. No target is shown, because nothing here stores one.
      </p>
      {note && <p className="mt-1 text-[10px] leading-relaxed text-gray-400">{note}</p>}
    </section>
  );
}
