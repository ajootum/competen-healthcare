import Link from "next/link";
import { PANEL, SEVERITY } from "@/lib/practice/palette";

// CPR-V5-004 s2 SESSION SUMMARY -- the figures that describe the session as a whole, and the sentences
// the practitioner was handed about it.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠ NOTHING IN THIS FILE COMPUTES, PREDICTS OR COMPARES. The comp calls this panel "AI Session Brief"
// and prints sentences of the shape "you are running better than average". This component takes
// sentences already written by a caller that counted rows, renders them verbatim, and has no way to
// produce one of its own: `notes` is data in, not a template.
//
// That matters because a sentence you cannot check has the same shape as a sentence a model invented.
// Each note carries the number of records it was counted from and a link to them, so the reader can go
// and look -- which is the only thing that separates a brief from a plausible paragraph.
//
// ⚠ COUNTS AND DENOMINATORS. `value` and `of` are separate props for the same reason as in
// SessionTiles: a percentage hides how many it was out of, and how many it was out of is the half of
// the figure a practitioner acts on. There is no `percent` prop, and there is no `goal` prop -- nothing
// in this product stores a target, so any target rendered here would be invented and then attributed to
// the practice.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export type SummaryFigure = {
  key: string;
  label: string;
  /** The count, or the numerator. Null with a reason whenever it was not earned. */
  value: number | null;
  /** The denominator, when the figure is "n of m". Null makes it a plain count. */
  of: number | null;
  unit: "count" | "minutes";
  /** Why there is no value: could not read, not permitted, or nothing yet. Three different answers. */
  reason: string | null;
  /**
   * Source records the figure was measured over, and how many were read and then dropped.
   *
   * DISCLOSED RATHER THAN HIDDEN: a mean over eight of twenty is a different claim from a mean over
   * eight, and the comp shows every one of these figures with no n at all.
   */
  observations: number | null;
  excluded: number | null;
  href: string | null;
};

/**
 * One already-written sentence about the session.
 *
 * `sentence` is rendered exactly as given. `count` is the true total of records behind it and
 * `sourceRefs` is what can actually be pointed at, which is not always the same number -- the tooltip
 * says so rather than implying the list is complete.
 */
export type SummaryNote = {
  key: string;
  sentence: string;
  severity: "critical" | "warning" | "normal";
  href: string | null;
  count: number | null;
  sourceLabel: string | null;
};

export type SessionSummaryCardProps = {
  figures: SummaryFigure[];
  /** Sentences handed in by the caller. Empty is a valid state and is not the same as unavailable. */
  notes: SummaryNote[];
  /**
   * How the notes were produced and when, in the caller's own words -- carried in the data rather than
   * written on the page, where it would drift from what was actually done.
   */
  notesMethod: string | null;
  /** Set when the notes could not be read at all, so an empty panel is not read as a quiet morning. */
  notesUnavailableReason: string | null;
  /** Set when no figure could be read, so the card says so instead of drawing a wall of em dashes. */
  unavailableReason: string | null;
};

const card = "rounded-xl border border-gray-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]";

/** Formatting only. The number is never adjusted, rounded up, or turned into anything else. */
function figureText(value: number, unit: "count" | "minutes"): string {
  return unit === "minutes" ? `${value} min` : String(value);
}

export default function SessionSummaryCard(props: SessionSummaryCardProps) {
  const { figures, notes, notesMethod, notesUnavailableReason, unavailableReason } = props;

  return (
    <section className={card} aria-labelledby="session-summary-h">
      <div className="mb-3 flex items-center gap-2">
        <span aria-hidden className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[12px] ${PANEL.brief.badge}`}>
          {PANEL.brief.icon}
        </span>
        <h2 id="session-summary-h" className="text-[13px] font-bold text-gray-900">Session summary</h2>
      </div>

      {unavailableReason ? (
        <p className="text-[12px] text-gray-500">{unavailableReason}</p>
      ) : (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
          {figures.map(f => {
            const barPercent = f.value !== null && f.of !== null && f.of > 0
              ? Math.min(100, Math.max(0, Math.round((f.value / f.of) * 100)))
              : null;
            return (
              <div key={f.key}>
                <dt className="text-[10px] uppercase tracking-wide text-gray-400">
                  {f.href ? (
                    <Link href={f.href} className="hover:text-[var(--cp-primary)] hover:underline">{f.label}</Link>
                  ) : f.label}
                </dt>
                {f.value === null ? (
                  <>
                    <dd className="text-[17px] font-bold leading-none text-gray-300">—</dd>
                    {/* The em dash on its own is a shrug. The reason is what makes it an answer. */}
                    <dd className="mt-1 text-[9.5px] leading-tight text-gray-500">
                      {f.reason ?? "No figure available."}
                    </dd>
                  </>
                ) : (
                  <>
                    <dd className="text-[17px] font-bold leading-none tabular-nums text-gray-900">
                      {figureText(f.value, f.unit)}
                      {f.of !== null && (
                        <span className="ml-1 text-[12px] font-semibold text-gray-500">of {f.of}</span>
                      )}
                    </dd>
                    {/* A BAR, DRAWN FROM THE PAIR PRINTED ABOVE IT. It carries no number of its own,
                        because the number it would carry is the percentage this file refuses. */}
                    {barPercent !== null && (
                      <dd aria-hidden className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
                        <span className="block h-full rounded-full bg-[var(--cp-primary)]" style={{ width: `${barPercent}%` }} />
                      </dd>
                    )}
                    {f.observations !== null && (
                      <dd className="mt-1 text-[9px] leading-tight text-gray-400">
                        over {f.observations} {f.observations === 1 ? "measurement" : "measurements"}
                        {f.excluded !== null && f.excluded > 0 ? `, ${f.excluded} excluded` : ""}
                      </dd>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </dl>
      )}

      {/* ── THE SENTENCES ────────────────────────────────────────────────────────────────────────── */}
      <div className="mt-3 border-t border-gray-100 pt-3">
        <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.1em] text-gray-500">About this session</p>
        {notesUnavailableReason ? (
          <p className="text-[12px] text-gray-500">{notesUnavailableReason}</p>
        ) : notes.length === 0 ? (
          <p className="text-[12px] text-gray-500">Nothing is waiting on you in this session.</p>
        ) : (
          <ul className="space-y-2">
            {notes.map(n => {
              const dot = SEVERITY[n.severity]?.dot ?? "bg-slate-400";
              const title = n.count === null
                ? (n.sourceLabel ?? undefined)
                : `Counted from ${n.count} record${n.count === 1 ? "" : "s"}${n.sourceLabel ? `: ${n.sourceLabel}` : ""}`;
              const body = (
                <>
                  <span aria-hidden className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
                  <span>{n.sentence}</span>
                </>
              );
              return (
                <li key={n.key}>
                  {n.href ? (
                    <Link href={n.href} title={title}
                      className="flex items-start gap-2 text-[12px] leading-snug text-gray-700 hover:text-[var(--cp-primary)]">
                      {body}
                    </Link>
                  ) : (
                    <span title={title} className="flex items-start gap-2 text-[12px] leading-snug text-gray-700">
                      {body}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {notesMethod && (
          <p className="mt-2 border-t border-gray-100 pt-2 text-[10px] leading-relaxed text-gray-400">
            {notesMethod}
          </p>
        )}
      </div>
    </section>
  );
}
