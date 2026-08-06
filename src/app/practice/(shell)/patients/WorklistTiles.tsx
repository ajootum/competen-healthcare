"use client";

import Link from "next/link";
import { Absence, Count, CARD } from "./Honesty";
import type { WorklistsView } from "./types";

// CPR-V5-006 s2 -- the six operational worklists.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// EVERY FIGURE IS THE LENGTH OF A LIST YOU CAN OPEN. The specification's own words are "these should be
// clickable and open filtered patient lists", and the engine was built for it: each worklist returns its
// patient ids alongside its count, and myPatients() takes them. So a tile is a button that filters the
// cohort below it in place -- not a number in a box, and not a link away from the workspace.
//
// WHERE A LIST ALREADY HAS A HOME, THE TILE SAYS SO TOO. Due follow-ups live at /practice/follow-ups and
// arrived documents at /practice/communication; those surfaces do things this table cannot (transition a
// follow-up, file a letter). The tile opens the filtered patient list here AND offers the destination,
// rather than quietly duplicating a screen that already exists.
//
// A TILE THAT COULD NOT BE READ SHOWS AN EM DASH, NEVER A ZERO. "Nobody is waiting" and "I could not
// find out who is waiting" are different answers, and only one of them means you can go for lunch.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

const TINT: Record<string, string> = {
  waiting: "var(--cp-warning)",
  dueFollowUps: "var(--cp-error)",
  pendingResults: "var(--cp-info)",
  walkIns: "var(--cp-accent)",
  recentPatients: "var(--cp-primary)",
  newRegistrations: "var(--cp-success)",
};

export default function WorklistTiles({ lists, selected, onSelect }: {
  lists: WorklistsView;
  selected: string | null;
  onSelect: (key: string | null) => void;
}) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[14px] font-bold text-gray-900">Operational worklists</h2>
        <p className="text-[11px] text-gray-500">
          {lists.today} · {lists.timezone} — this practice&rsquo;s own day, not the server&rsquo;s.
          {selected && (
            <button type="button" onClick={() => onSelect(null)}
              className="ml-2 font-semibold text-[var(--cp-primary-deep)] hover:underline">
              Clear filter
            </button>
          )}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {lists.worklists.map(w => {
          const tint = TINT[w.key] ?? "var(--cp-primary)";
          const active = selected === w.key;
          const elsewhere = !w.href.startsWith("/practice/patients");
          return (
            <div
              key={w.key}
              className={`${CARD} flex flex-col p-4 ${active ? "ring-2 ring-[var(--cp-primary)]/40" : ""}`}
              style={active ? { borderColor: tint } : undefined}
            >
              <button
                type="button"
                onClick={() => onSelect(active ? null : w.key)}
                aria-pressed={active}
                disabled={w.unavailable}
                className="flex items-start justify-between gap-2 text-left disabled:cursor-not-allowed"
              >
                <span className="min-w-0">
                  <span className="block text-[12px] font-semibold text-gray-600">{w.title}</span>
                  <Count
                    count={w.count}
                    atLeast={w.atLeast}
                    reason={w.reason}
                    className="block text-[26px] font-bold leading-tight"
                  />
                </span>
                {!w.unavailable && (
                  <span
                    aria-hidden
                    className="mt-1 shrink-0 rounded-lg px-2 py-1 text-[11px] font-semibold"
                    style={{ background: `color-mix(in srgb, ${tint} 12%, white)`, color: tint }}
                  >
                    {active ? "filtering" : "open list"}
                  </span>
                )}
              </button>

              <div className="mt-1.5">
                {w.unavailable
                  ? <Absence reason={w.reason} error={w.error} nothing="" />
                  : <p className="text-[11px] leading-relaxed text-gray-500">{w.note}</p>}
              </div>

              {/* THE BOUNDARY TRAVELS WITH THE FIGURE. "Pending results" means something narrower here
                  than the phrase usually does, and it has to say so where it is read. */}
              {w.key === "pendingResults" && (
                <p className="mt-1.5 border-t border-gray-100 pt-1.5 text-[11px] leading-relaxed text-gray-500">
                  {lists.pendingResultsBoundary}
                </p>
              )}

              {elsewhere && (
                <Link href={w.href} className="mt-1.5 text-[11px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
                  Work this list where it lives &rarr;
                </Link>
              )}
            </div>
          );
        })}
      </div>

      {lists.blindSpots.length > 0 && (
        <p className="rounded-lg bg-[var(--cmp-surface-warning)] px-3 py-2 text-[12px] text-[var(--cmp-text-warning)]">
          <span className="font-semibold">
            {lists.blindSpots.length === 1 ? "One worklist" : `${lists.blindSpots.length} worklists`} could not be answered:
          </span>{" "}
          {lists.blindSpots.map(b => `${b.title} (${b.reason === "capability" ? "not permitted" : b.error ?? "read failed"})`).join("; ")}.
          Treat those as unknown rather than empty.
        </p>
      )}
    </section>
  );
}
