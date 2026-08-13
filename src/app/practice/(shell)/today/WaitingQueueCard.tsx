"use client";

import { useState } from "react";
import Link from "next/link";
import { PANEL, QUEUE_SWATCH } from "@/lib/practice/palette";

// CPR-V5-004 s2 WAITING QUEUE -- who is in the corridor, split the way the session engine splits them.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// THE FOUR TABS ARE A LENS ON ONE LIST, NOT FOUR LISTS. Every tab count is derived from the same
// `people` array in this component, so a tab cannot say four while its own contents say three. The
// groups match the session engine's own split -- booked / walk-ins / emergency, decided from the
// appointment the queue entry points at -- because a second definition of "walk-in" living in a card is
// how two screens end up disagreeing about who walked in.
//
// EMERGENCY IS RED ONLY WHEN THERE IS AN EMERGENCY. An "Emergency (0)" tab drawn in red every morning
// is the fastest way to teach a clinic to stop reading the word, and it takes the one real emergency
// down with it. At nought the tab is slate like any other.
//
// WAITING TIME, NOT ARRIVAL TIME, IS THE FIGURE. It is the number that decides who is seen next; an
// arrival time makes the reader do the subtraction. Both are offered, but the minutes are what is bold.
//
// ⚠ A NULL WAIT IS AN EM DASH, NOT A ZERO. An entry whose arrival was never timestamped has an unknown
// wait, and "0 min" beside somebody who has been sitting there since eight is the worst available lie.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/** The engine's own three groups. Anything else would need the engine to agree to it first. */
export type QueueGroupKey = "booked" | "walk_ins" | "emergency";
export type QueueTabKey = "all" | QueueGroupKey;

export type QueuePerson = {
  id: string;
  name: string;
  group: QueueGroupKey;
  /** Queue state -- WAITING / READY / IN_CONSULTATION / PAUSED. Keys QUEUE_SWATCH. */
  status: string;
  /** Minutes waited. Null with a reason whenever the arrival time is missing or unusable. */
  waitingMinutes: number | null;
  waitingReason: string | null;
  /** Arrival time, already formatted by the caller in the practice's timezone. */
  timeLabel: string | null;
  href: string | null;
  /**
   * The PATIENT this row is about -- `id` above is the queue entry. Null for somebody in the corridor
   * who is not registered yet, and a row with no patient cannot be marked Seen, so no button is drawn.
   */
  patientId: string | null;
};

export type WaitingQueueCardProps = {
  people: QueuePerson[];
  /** Set when the queue could not be read. An empty list and an unread list are different sentences. */
  unavailableReason: string | null;
  /**
   * Set when `people` is only the front of the queue.
   *
   * ⚠ ITS OWN FIELD, NOT FOLDED INTO unavailableReason. "could not be read" and "read, but this is not
   * all of it" are different facts, and the second one still has a usable list under it -- collapsing
   * them would either hide the rows or claim the read failed when it did not. Three states, not two.
   */
  truncatedNotice?: string | null;
  /** "Full queue" destination, when the reader has one. */
  href: string | null;
  /** Drawn per row only when a handler is given -- a button that cannot act is not drawn at all. */
  onStartEncounter?: (id: string) => void;
  /**
   * CPR-ADOPT-001 s2 Capture Later: one tap records that the patient was seen and creates an encounter
   * shell asserting nothing clinical. Same rule as above -- no handler, no button.
   */
  onMarkSeen?: (patientId: string) => void;
  /** The row currently mid-action, so one click cannot become three. */
  busyId: string | null;
  error: string | null;
};

const card = "rounded-xl border border-gray-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]";

const TABS: { key: QueueTabKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "booked", label: "Booked" },
  { key: "walk_ins", label: "Walk-in" },
  { key: "emergency", label: "Emergency" },
];

/** The dot that marks how somebody reached the corridor. Emergency is red wherever it appears. */
const GROUP_DOT: Record<QueueGroupKey, string> = {
  booked: "bg-[var(--cp-primary)]",
  walk_ins: "bg-[var(--cmp-text-warning)]",
  emergency: "bg-[var(--cmp-text-danger)]",
};

export default function WaitingQueueCard(props: WaitingQueueCardProps) {
  const { people, unavailableReason, truncatedNotice, href, onStartEncounter, onMarkSeen, busyId, error } = props;
  const [tab, setTab] = useState<QueueTabKey>("all");

  const countFor = (k: QueueTabKey) => k === "all" ? people.length : people.filter(p => p.group === k).length;
  const shown = tab === "all" ? people : people.filter(p => p.group === tab);

  return (
    <section className={card} aria-labelledby="queue-h">
      <div className="mb-3 flex items-center gap-2">
        <span aria-hidden className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[12px] ${PANEL.queue.badge}`}>
          {PANEL.queue.icon}
        </span>
        <h2 id="queue-h" className="text-[13px] font-bold text-gray-900">Waiting queue</h2>
        {/* ⚠ THE "+" IS NOT DECORATION. This badge counts the rows in hand, and when the list was
            truncated that is a floor rather than a total -- "200" and "200+" are different claims, and
            the bare one is false. The sentence below says the rest. */}
        {!unavailableReason && (
          <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-bold text-gray-600">
            {people.length}{truncatedNotice ? "+" : ""}
          </span>
        )}
        {href && (
          <Link href={href} className="ml-auto text-[11px] font-semibold text-[var(--cp-primary)] hover:underline">
            Full queue →
          </Link>
        )}
      </div>

      {unavailableReason ? (
        <p className="text-[12px] text-gray-500">{unavailableReason}</p>
      ) : (
        <>
          {/* ⚠ ABOVE THE TABS, because the tab counts are counts of what was loaded. Left below them it
              would read as a footnote to one tab rather than a caveat on all four. */}
          {truncatedNotice && (
            <p className="mb-2.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11.5px] text-amber-900">
              {truncatedNotice}
            </p>
          )}
          {/* ── THE FOUR TABS ────────────────────────────────────────────────────────────────────── */}
          <div role="tablist" aria-label="Queue groups" className="mb-2.5 flex flex-wrap gap-1">
            {TABS.map(t => {
              const n = countFor(t.key);
              const active = t.key === tab;
              // Red is spent on an emergency that exists. At nought the tab reads like any other.
              const loudEmergency = t.key === "emergency" && n > 0;
              const tone = active
                ? loudEmergency
                  ? "border-red-300 bg-red-50 text-red-700"
                  : "border-[var(--cp-primary)]/30 bg-[var(--cp-primary)]/8 text-[var(--cp-primary-deep)]"
                : loudEmergency
                  ? "border-red-200 bg-white text-red-700 hover:bg-red-50/60"
                  : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50";
              return (
                <button key={t.key} type="button" role="tab" aria-selected={active}
                  onClick={() => setTab(t.key)}
                  className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors ${tone}`}>
                  {t.label} <span className="tabular-nums opacity-70">({n})</span>
                </button>
              );
            })}
          </div>

          {shown.length === 0 ? (
            <p className="text-[12px] text-gray-500">
              {/* An empty tab and an empty queue are different facts, and only one of them means the
                  corridor is clear. */}
              {people.length === 0 ? "Nobody is waiting." : "Nobody is waiting in this group."}
            </p>
          ) : (
            <ul className="space-y-0.5">
              {shown.map(p => {
                const sw = QUEUE_SWATCH[p.status] ?? QUEUE_SWATCH.PAUSED;
                const name = p.href
                  ? <Link href={p.href} className="min-w-0 flex-1 truncate text-[12.5px] text-gray-800 hover:text-[var(--cp-primary)]">{p.name}</Link>
                  : <span className="min-w-0 flex-1 truncate text-[12.5px] text-gray-800">{p.name}</span>;
                return (
                  <li key={p.id} className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-gray-50">
                    <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${GROUP_DOT[p.group]}`} />
                    {name}
                    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold ${sw.chip}`}>
                      {p.status.replace(/_/g, " ").toLowerCase()}
                    </span>
                    {p.waitingMinutes === null ? (
                      <span className="shrink-0 text-[11px] text-gray-300" title={p.waitingReason ?? undefined}>—</span>
                    ) : (
                      <span className="shrink-0 text-[11px] tabular-nums text-gray-500"
                        title={p.timeLabel ? `Arrived ${p.timeLabel}` : undefined}>
                        {p.waitingMinutes} min
                      </span>
                    )}
                    {/* CPR-ADOPT-001 s2. Drawn only when this row HAS a patient to attach an encounter
                        to -- a queue entry for somebody not yet registered has nothing to mark. */}
                    {onMarkSeen && p.patientId && (
                      <button type="button" disabled={busyId === p.id}
                        onClick={() => onMarkSeen(p.patientId!)}
                        title="Record that you saw this patient. Complete the details later."
                        className="shrink-0 rounded-md border border-[var(--cp-primary)]/30 px-1.5 py-0.5 text-[11px] font-semibold text-[var(--cp-primary)] hover:bg-[var(--cp-primary)]/8 disabled:opacity-50">
                        Seen ✓
                      </button>
                    )}
                    {onStartEncounter && (
                      <button type="button" disabled={busyId === p.id}
                        onClick={() => onStartEncounter(p.id)}
                        className="shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-[var(--cp-primary)] hover:bg-[var(--cp-primary)]/8 disabled:opacity-50">
                        Start →
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      {error && (
        <p role="alert" className="mt-2 rounded-lg bg-[var(--cmp-surface-danger)] px-3 py-2 text-[12px] text-[var(--cmp-text-danger)]">
          {error}
        </p>
      )}
    </section>
  );
}
