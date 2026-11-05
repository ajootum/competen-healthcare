"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import type { NbaRecommendation } from "@/lib/individual/scholar/next-best-action";
import { learnAction, learnBox } from "@/components/ui/scholar-learning";
import { linkBtn, pillOutline, quietBtn, summaryCls, tagCls, whenChipCls } from "./plan-style";
import { ErrorLine, callJson, errorOf } from "./plan-ui";

// SALE-2026-11 R3 / SALE-11 -- MY PLAN -> TODAY: NEXT LEARNING ACTIONS (policy scholar_next_best_action, default off).
//
// A few ACTIONS, best first, each with its short reason and "Why this?" (every rule that placed it). Each can be added to today (the
// learner's own calendar), snoozed or dismissed, and the choice is recorded (975). Start only opens it: nothing is recorded and the plan
// is untouched. Without 975 the card is read only and says so. Phone-first: one column, 44px targets. NO AI, never an assessment.

const API = "/api/individual/scholar/plan/next-action";

export function NextActionsCard({ items, canDecide, canPlan, dismissed, snoozed, studyId, title = "Next learning actions", collapseAfter }: {
  items: NbaRecommendation[]; canDecide: boolean; canPlan: boolean; dismissed: number; snoozed: number; studyId: string | null;
  title?: string;
  /** Show this many, with the rest one tap away (a screen where the suggestions are not the main task). */
  collapseAfter?: number;
}) {
  const shown = collapseAfter === undefined ? items : items.slice(0, collapseAfter);
  const more = collapseAfter === undefined ? [] : items.slice(collapseAfter);
  const uid = useId();
  return (
    <section aria-labelledby={`${uid}-h`} className={`${learnBox("next")} p-4 sm:p-5`} data-testid="plan-next-actions">
      <div className="flex items-start justify-between gap-3">
        <h2 id={`${uid}-h`} className="cmp-learn-ink text-[16px] font-bold">{title}</h2>
        <span className={tagCls}>Suggested</span>
      </div>
      <p className="mt-1 text-[13.5px] text-gray-700">From your own answers, lessons and cards. Nothing changes in your plan unless you add it.</p>
      {items.length === 0 ? (
        <p className="mt-3 text-[14px] text-gray-700">Nothing to suggest right now.{dismissed + snoozed > 0 ? ` ${hidden(dismissed, snoozed)}` : ""}</p>
      ) : (
        <ol className="mt-3 space-y-3">
          {shown.map((r, i) => <NextAction key={r.ref} r={r} first={i === 0} canDecide={canDecide} canPlan={canPlan} studyId={studyId} />)}
        </ol>
      )}
      {more.length > 0 && (
        <details className="mt-3" data-next-more>
          <summary className={summaryCls}>Show {more.length} more</summary>
          <ol className="mt-2 space-y-3">
            {more.map(r => <NextAction key={r.ref} r={r} first={false} canDecide={canDecide} canPlan={canPlan} studyId={studyId} />)}
          </ol>
        </details>
      )}
      {items.length > 0 && dismissed + snoozed > 0 && <p className="mt-3 text-[13px] text-gray-800">{hidden(dismissed, snoozed)}</p>}
      {!canDecide && <p className="mt-3 text-[13px] text-gray-800">Adding, snoozing and dismissing are not available here yet. You can still start any of these.</p>}
    </section>
  );
}

const hidden = (d: number, s: number) =>
  [d ? `${d} dismissed (back if your evidence changes)` : "", s ? `${s} snoozed` : ""].filter(Boolean).join(", ") + ".";
const withStudy = (href: string, studyId: string | null) => (studyId ? `${href}${href.includes("?") ? "&" : "?"}study=${encodeURIComponent(studyId)}` : href);

function NextAction({ r, first, canDecide, canPlan, studyId }: { r: NbaRecommendation; first: boolean; canDecide: boolean; canPlan: boolean; studyId: string | null }) {
  const router = useRouter();
  const uid = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [said, setSaid] = useState("");
  const [later, setLater] = useState(false);

  async function decide(decision: "accept" | "snooze" | "dismiss", extra: Record<string, unknown> = {}) {
    setBusy(true); setError(""); setSaid("");
    const res = await callJson(API, "POST", { ref: r.ref, decision, ...extra });
    setBusy(false);
    if (!res.ok) { setError(errorOf(res)); return; }
    setLater(false);
    setSaid(decision === "accept" ? (extra.date === "tomorrow" ? "Added to tomorrow in your calendar." : "Added to today in your calendar.")
      : decision === "snooze" ? `Snoozed until ${String(res.json.until ?? "later")}.` : "Dismissed. It comes back only if your evidence changes.");
    router.refresh();
  }

  return (
    <li className="rounded-xl bg-[var(--cmp-app-surface)] ring-1 ring-[var(--learn-border)] p-3" data-testid="next-action" data-kind={r.kind}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="min-w-0 flex-1 break-words text-[16px] font-bold leading-snug text-gray-900" id={`${uid}-t`}>{r.action}</p>
        <span className={whenChipCls}>{r.minutes} min</span>
      </div>
      {r.about && <p className="mt-0.5 break-words text-[13.5px] text-gray-700"><span className="font-semibold">About: </span>{r.about}</p>}
      <p className="mt-1 break-words text-[14px] text-gray-800" data-testid="next-action-reason">{r.reason}</p>
      <details className="mt-0.5">
        <summary className={summaryCls}>Why this?</summary>
        <ul className="mb-1 list-disc space-y-1 pl-5 text-[13.5px] text-gray-800">
          {r.because.slice(1).map(b => <li key={b}>{b}</li>)}
          <li>A suggestion from your own records, not an assessment.</li>
        </ul>
      </details>
      {r.state === "planned" && <p className="mt-1 text-[13.5px] font-semibold text-gray-900" role="status">In your plan for {r.plannedFor === null ? "today" : r.plannedFor}.</p>}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Link href={withStudy(r.href, studyId)} className={first ? learnAction.primary : pillOutline} aria-describedby={`${uid}-t`}>Start</Link>
        {canDecide && r.state === "new" && (
          <>
            {canPlan && <button type="button" className={quietBtn} disabled={busy} onClick={() => decide("accept")}>Add to today<span className="sr-only">: {r.action}</span></button>}
            <button type="button" className={quietBtn} disabled={busy} aria-expanded={later} onClick={() => setLater(v => !v)}>Later<span className="sr-only">: {r.action}</span></button>
            <button type="button" className={`${linkBtn} text-gray-700`} disabled={busy} onClick={() => decide("dismiss")}>Dismiss<span className="sr-only">: {r.action}</span></button>
          </>
        )}
      </div>
      {later && (
        <div className="mt-2 flex flex-wrap items-center gap-2" role="group" aria-label={`Snooze ${r.action}`}>
          {canPlan && <button type="button" className={quietBtn} disabled={busy} onClick={() => decide("accept", { date: "tomorrow" })}>Add to tomorrow</button>}
          <button type="button" className={quietBtn} disabled={busy} onClick={() => decide("snooze", { days: 1 })}>Snooze until tomorrow</button>
          <button type="button" className={quietBtn} disabled={busy} onClick={() => decide("snooze", { days: 3 })}>3 days</button>
          <button type="button" className={quietBtn} disabled={busy} onClick={() => decide("snooze", { days: 7 })}>A week</button>
        </div>
      )}
      {said && <p className="mt-2 text-[13.5px] text-gray-800" role="status">{said}</p>}
      {error && <div className="mt-2"><ErrorLine text={error} /></div>}
    </li>
  );
}
