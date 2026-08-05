import Link from "next/link";
import { GLANCE_SWATCH } from "@/lib/practice/palette";

// CPR-V5-004 s2 THE SIX SESSION TILES -- the figures a practitioner scans in the first ten seconds.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠ COUNTS AND DENOMINATORS, NEVER A PERCENTAGE. The comp draws "On-time Rate 62%", "Utilisation 78%"
// and "Patients / hour 3.2". None of the three is printable here, and the props are shaped so they
// cannot be smuggled back in: there is a `value` and an `of`, there is no `percent`, and `unit` admits
// only "count" and "minutes" -- the same two units metrics.ts defines.
//
// The reason is not stylistic. 62% of eight patients is not a rate, it is five people; a percentage
// hides the denominator, and the denominator is the whole of what makes the figure actionable. "5 of 8"
// tells a practitioner both how well the morning went AND how much morning there was. A bar may be drawn
// from the pair -- a bar is a picture of a proportion, not a claim to a decimal place -- but the printed
// figure is always the pair.
//
// ⚠ THERE IS NO `goal` PROP. The comp prints "Goal: <20m" and "Goal: >80%" under these tiles. Nothing in
// this product stores a target, so any number under that word would be invented and then presented as
// the practice's own standard -- and a clinician reading "below target" reasonably takes it as a
// judgement somebody made about their work. If targets are ever wanted they belong in
// practice_configuration (migration 203) with an author and a date, and they belong in the props only
// once a real one can be read.
//
// COLOUR IS SEMANTIC AND COMES FROM palette.ts. Emergency and Cancelled are the two tiles you must not
// scan past, so they are the two that go red -- and only when they are non-zero, because a nought that
// shouts is a nought people learn to ignore, and it takes the real red down with it.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export type SessionTile = {
  /** A GLANCE_SWATCH key where one fits, so the tile wears the colour that concept already has. */
  key: string;
  label: string;
  /** The count, or the numerator of a pair. Null with a reason whenever it was not earned. */
  value: number | null;
  /**
   * The denominator, when the figure is "n of m". Null makes this a plain count.
   *
   * SEPARATE FROM `value` ON PURPOSE. A caller holding only a ratio cannot fill these two in, which is
   * the point: it has to go back and find out how many it was out of.
   */
  of: number | null;
  unit: "count" | "minutes";
  /** Why there is no value. Rendered beside the em dash; three answers hide behind that dash. */
  reason: string | null;
  /** Source records the figure was computed over, disclosed under any average. Null when none. */
  observations: number | null;
  /** The formula and its sources, already in words. Shown on hover, never invented here. */
  basis: string | null;
  href: string | null;
};

export type SessionTilesProps = {
  /** The comp shows six. The array is rendered as given -- a tile that cannot be read is still a tile. */
  tiles: SessionTile[];
  /** "This session" or "Today". The same six figures mean different things either side of that line. */
  scopeLabel: string;
  /** Set when nothing at all could be read, so the row says so instead of drawing six em dashes. */
  unavailableReason: string | null;
};

const card = "rounded-xl border border-gray-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]";

/**
 * The keys whose colour is a warning rather than a label.
 *
 * These take their red only when there is something to be red about; at nought they fall back to slate,
 * which is what GLANCE_SWATCH.no_show already does and for the same reason.
 */
const LOUD_KEYS = new Set(["emergency", "cancelled"]);

export default function SessionTiles({ tiles, scopeLabel, unavailableReason }: SessionTilesProps) {
  return (
    <section className={card} aria-labelledby="session-tiles-h">
      <div className="mb-3 flex items-center gap-2">
        <h2 id="session-tiles-h" className="text-[13px] font-bold text-gray-900">This session at a glance</h2>
        {/* THE WINDOW IS ON THE CARD, not assumed. An unlabelled figure is the wrong answer half the
            time -- the same six numbers count a clinic during a session and a day outside one. */}
        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-slate-500">
          {scopeLabel}
        </span>
      </div>

      {unavailableReason ? (
        <p className="text-[12px] text-gray-500">{unavailableReason}</p>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {tiles.map(t => {
            const s = GLANCE_SWATCH[t.key] ?? GLANCE_SWATCH.booked;
            const loud = !LOUD_KEYS.has(t.key) || (t.value !== null && t.value > 0);
            const figureTone = loud ? s.figure : "text-slate-600";
            const boxTone = loud ? s.box : "border-slate-200 bg-slate-50/60";
            const badgeTone = loud ? s.badge : "bg-slate-100 text-slate-500";
            // A pair is only a pair when there is something on both sides of the word "of". A null
            // denominator is a plain count, not a division by nothing.
            const pair = t.value !== null && t.of !== null;
            const barPercent = t.value !== null && t.of !== null && t.of > 0
              ? Math.min(100, Math.max(0, Math.round((t.value / t.of) * 100)))
              : null;

            const body = (
              <>
                <span className="flex items-center justify-between gap-1">
                  <span className={`text-[19px] font-bold leading-none tabular-nums ${t.value === null ? "text-gray-300" : figureTone}`}>
                    {/* A NULL VALUE RENDERS AN EM DASH. Never a nought: "nobody came" and "I could not
                        find out who came" are different answers, and the nought is the dangerous one. */}
                    {t.value === null ? "—" : t.value}
                    {t.value !== null && t.unit === "minutes" && (
                      <span className="ml-0.5 text-[11px] font-semibold opacity-70">min</span>
                    )}
                    {pair && (
                      <span className="ml-1 text-[11.5px] font-semibold text-gray-500">of {t.of}</span>
                    )}
                  </span>
                  <span aria-hidden className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[10px] ${badgeTone}`}>
                    {s.icon}
                  </span>
                </span>
                <span className="mt-1 block truncate text-[10.5px] text-gray-600">{t.label}</span>

                {/* THE BAR IS DRAWN FROM THE PAIR, and the pair is what is printed above it. The bar is
                    a shape; it is not a second figure and it never carries a number of its own. */}
                {barPercent !== null && (
                  <span aria-hidden className="mt-1.5 block h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
                    <span className="block h-full rounded-full bg-[var(--cp-primary)]" style={{ width: `${barPercent}%` }} />
                  </span>
                )}

                {t.value === null && (
                  <span className="mt-0.5 block truncate text-[9.5px] leading-tight text-gray-500">
                    {t.reason ?? "No figure available."}
                  </span>
                )}
                {/* NO AVERAGE WITHOUT ITS DENOMINATOR. A mean over three consultations is not a
                    measurement, and the comp shows these with no n at all. */}
                {t.value !== null && t.observations !== null && t.unit === "minutes" && (
                  <span className="block text-[9px] leading-tight text-gray-400">
                    over {t.observations} {t.observations === 1 ? "measurement" : "measurements"}
                  </span>
                )}
              </>
            );

            const title = t.value === null ? (t.reason ?? undefined) : (t.basis ?? undefined);
            const className = `block rounded-lg border px-2.5 py-2 transition-shadow ${boxTone}`;

            // A tile without a destination is not a link. Rendering it as one gives a reader a click
            // that goes nowhere, which teaches them the whole row is decorative.
            return t.href ? (
              <Link key={t.key} href={t.href} title={title} className={`${className} hover:shadow-sm`}>
                {body}
              </Link>
            ) : (
              <div key={t.key} title={title} className={className}>{body}</div>
            );
          })}
        </div>
      )}

      <p className="mt-2 text-[10px] leading-relaxed text-gray-400">
        Figures are counts and the number they are out of. No percentages, and no target to be measured
        against — nothing here stores one.
      </p>
    </section>
  );
}
