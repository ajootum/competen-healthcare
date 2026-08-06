"use client";

import { CARD, Count } from "./Honesty";
import { CARE_CARD_SWATCH } from "@/lib/practice/palette";
import type { CohortView, WorklistsView } from "./types";

// CPR-PAT-002 -- the comp's "Patient insights" and "AI Practice Assistant" panels.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// THE COMP DRAWS FIVE THINGS HERE. THREE OF THEM ARE REFUSED AND THE PANEL SAYS SO.
//
// It shows a sparkline, then "New patients 8 ↑14%", "Follow-ups kept 87% ↑6%", "Overdue reviews 14 ↓3%".
//
//   THE PERCENTAGES. 87% hides both its numerator and its denominator, and a rate over a small clinic's
//   week moves violently for reasons that are not clinical -- two cancellations in a quiet week is a
//   fifteen-point swing. Counts are shown, each labelled with what it counts.
//
//   THE ARROWS. They are period-over-period and there is no prior period in the payload: this screen
//   holds one snapshot of now, with no history and no window parameter. A delta computed from nothing is
//   not a rounding error, it is a fabricated trend sitting beside a clinical figure. Period-over-period
//   IS computable in principle -- but only gated, with the prior window proven to have existed for its
//   whole length and both windows carrying enough records, and none of those conditions can even be
//   evaluated from what is here.
//
//   THE SPARKLINE. It needs a series. Every figure on this screen is a single count of the present.
//
// THE ASSISTANT PANEL IS NOT LABELLED AI, AND ITS CONTENT IS FINE. "3 patients with overdue follow-ups
// and 2 unreviewed results" is ARITHMETIC over the cards above it -- true, useful, and produced by no
// model. command-centre.ts renders the same kind of line with aiGenerated: false; this follows it. A
// badge saying AI on a sum is a claim about provenance, and provenance is the one thing a clinical
// assistant panel has to be right about.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/** A figure with its own honesty, in the hue of the card it comes from. */
function Figure({ label, count, atLeast, reason, swatch, note }: {
  label: string;
  count: number | null;
  atLeast: boolean;
  reason: "capability" | "read_failed" | null;
  swatch: string;
  note: string;
}) {
  return (
    <li className="flex items-baseline justify-between gap-3 border-t border-gray-100 py-2 first:border-t-0">
      <span className="min-w-0">
        <span className="block text-[12px] font-semibold text-gray-700">{label}</span>
        <span className="block text-[10.5px] leading-tight text-gray-400">{note}</span>
      </span>
      <Count
        count={count}
        atLeast={atLeast}
        reason={reason}
        className={`shrink-0 text-[20px] font-bold leading-none ${count === null ? "text-slate-300" : swatch}`}
      />
    </li>
  );
}

export default function InsightsPanel({ lists, cohort }: {
  lists: WorklistsView;
  cohort: CohortView | null;
}) {
  const wl = (key: string) => lists.worklists.find(w => w.key === key) ?? null;
  const due = wl("dueFollowUps");
  const results = wl("pendingResults");
  const registered = wl("newRegistrations");
  const waiting = wl("waiting");

  // ── The assistant line ────────────────────────────────────────────────────────────────────────────
  // ONLY THE READABLE FIGURES GO IN THE SENTENCE. A count that could not be read must not appear as a
  // number in prose, where it loses the em dash that would have made it honest; it is named separately
  // as something the sentence does not cover.
  const said: string[] = [];
  if (due && !due.unavailable && due.count !== null && due.count > 0) {
    said.push(`${due.atLeast ? "at least " : ""}${due.count} ${due.count === 1 ? "patient" : "patients"} with a follow-up due or overdue`);
  }
  if (results && !results.unavailable && results.count !== null && results.count > 0) {
    said.push(`${results.atLeast ? "at least " : ""}${results.count} unreviewed ${results.count === 1 ? "result" : "result"}${results.count === 1 ? "" : "s"}`);
  }
  if (waiting && !waiting.unavailable && waiting.count !== null && waiting.count > 0) {
    said.push(`${waiting.atLeast ? "at least " : ""}${waiting.count} in the queue`);
  }
  const unread = [due, results, waiting, registered]
    .filter(w => w && w.unavailable)
    .map(w => w!.title);

  return (
    <div className="flex flex-col gap-4">
      <section className={`${CARD} p-4`}>
        <h2 className="text-[13.5px] font-bold text-gray-900">Patient insights</h2>
        <p className="mt-0.5 text-[10.5px] leading-relaxed text-gray-400">
          Counts of right now. No rates and no comparison against an earlier period &mdash; there is no
          earlier period in what this screen reads.
        </p>
        <ul className="mt-2 flex flex-col">
          <Figure
            label="On the register"
            count={cohort && !cohort.unavailable ? cohort.total : null}
            atLeast={false}
            reason={cohort?.unavailable ? cohort.reason : null}
            swatch="text-[var(--cp-primary-deep)]"
            note={cohort?.scope === "mine" ? "patients you have consulted" : "every active record at this practice"}
          />
          <Figure
            label="Registered today"
            count={registered?.count ?? null}
            atLeast={registered?.atLeast ?? false}
            reason={registered?.reason ?? null}
            swatch={CARE_CARD_SWATCH.newRegistrations.figure}
            note="this practice's own calendar day, not a 7-day window"
          />
          <Figure
            label="Follow-ups due & overdue"
            count={due?.count ?? null}
            atLeast={due?.atLeast ?? false}
            reason={due?.reason ?? null}
            swatch={CARE_CARD_SWATCH.overdueFollowUps.figure}
            note="open obligations dated today or earlier"
          />
          <Figure
            label="Results to review"
            count={results?.count ?? null}
            atLeast={results?.atLeast ?? false}
            reason={results?.reason ?? null}
            swatch={CARE_CARD_SWATCH.resultsToReview.figure}
            note="documents that arrived and nobody has read"
          />
        </ul>
        <details className="group mt-2 border-t border-gray-100 pt-2">
          <summary className="cursor-pointer list-none text-[10.5px] font-semibold text-gray-500 hover:text-gray-700">
            <span className="mr-1 inline-block transition-transform group-open:rotate-90">&rsaquo;</span>
            The design shows percentages and trend arrows here
          </summary>
          <p className="mt-1 text-[10.5px] leading-relaxed text-gray-500">
            &ldquo;Follow-ups kept 87% &uarr;6%&rdquo; is two claims and neither can be made. A percentage
            hides its numerator and its denominator, and over a clinic&rsquo;s week it swings on two
            cancellations. The arrow is period-over-period, and this screen holds one snapshot of now
            &mdash; no history, no window &mdash; so there is nothing to compare against. The sparkline
            above them needs a series, and every figure here is a single count of the present.
          </p>
        </details>
      </section>

      <section className={`${CARD} border-[var(--cp-primary)]/25 bg-[var(--cp-primary)]/[0.04] p-4`}>
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className="flex h-6 w-6 items-center justify-center rounded-lg bg-[var(--cp-primary)]/12 text-[13px] text-[var(--cp-primary-deep)]"
          >
            ✧
          </span>
          <h2 className="text-[13.5px] font-bold text-[var(--cp-primary-deep)]">Practice assistant</h2>
          {/* NOT AN "AI" BADGE. Nothing generated this. */}
          <span className="ml-auto rounded-md bg-white/70 px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-gray-500">
            computed
          </span>
        </div>

        <p className="mt-2 text-[12.5px] leading-relaxed text-gray-700">
          {said.length > 0
            ? <>You have {said.slice(0, -1).join(", ")}{said.length > 1 ? " and " : ""}{said[said.length - 1]}.</>
            : unread.length > 0
              ? "Nothing can be summarised — the lists this would add up could not be read."
              : "Nothing is due, waiting or unreviewed right now."}
        </p>

        {unread.length > 0 && (
          <p className="mt-1.5 text-[10.5px] leading-relaxed text-[var(--cmp-text-warning)]">
            Not counted in that sentence: {unread.join(", ")} &mdash; {unread.length === 1 ? "it" : "they"} could not be
            read, so {unread.length === 1 ? "it is" : "they are"} unknown rather than nought.
          </p>
        )}

        <p className="mt-2 border-t border-[var(--cp-primary)]/15 pt-2 text-[10.5px] leading-relaxed text-gray-500">
          This is arithmetic over the cards above, not a generated brief. No model produced it and it is
          not labelled as one.
        </p>
      </section>
    </div>
  );
}
