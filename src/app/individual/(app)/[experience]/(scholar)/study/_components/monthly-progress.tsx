import Link from "next/link";
import { MONTHLY_STANDING_LINE, monthLabel } from "@/lib/individual/scholar/monthly-review";

// SCHOLAR-MONTHLY-REVIEW-01 -- on Progress: a reminder banner when a monthly review is open (in the app only, from the policy's
// recommended date, never when the learner opted out), and a compact "Last monthly review" card that links to its results.
// Optional and formative. Nothing waits on either.

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900";
const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export type LastReviewView = {
  id: string; month: string; createdAt: string; late: boolean; retakes: number;
  /** "x of y" answered right, or null where there were too few answers marked by code. */
  score: { correct: number; answered: number } | null;
  weak: string[];
};

export function MonthlyBanner({ nudges, evaluateHref }: { nudges: { month: string; recommended: string; late: boolean }[]; evaluateHref: string }) {
  if (!nudges.length) return null;
  return (
    <div role="status" className="mb-4 rounded-2xl border border-amber-300 bg-amber-50 p-3 text-[13.5px] text-amber-900 sm:p-4">
      <span aria-hidden="true">★ </span><span className="font-semibold">Monthly review: </span>
      {nudges.map(n => `your ${monthLabel(n.month)} review is open${n.late ? " (late)" : ` (recommended around ${day(n.recommended)})`}`).join(" and ")}. It is optional.{" "}
      <Link href={evaluateHref} className={`inline-flex min-h-[44px] items-center font-semibold underline underline-offset-2 pointer-coarse:min-h-[48px] ${focusRing}`}>Open it in Evaluate</Link>
    </div>
  );
}

export function LastMonthlyReview({ last, resultsHref, evaluateHref }: { last: LastReviewView; resultsHref: string; evaluateHref: string }) {
  return (
    <section aria-labelledby="last-mr-h" className="mb-6 rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="last-mr-h" className="text-[15px] font-bold text-gray-900">Last monthly review</h2>
        <span className="rounded-full border border-gray-300 bg-gray-50 px-2.5 py-0.5 text-[12px] font-semibold text-gray-800">{MONTHLY_STANDING_LINE}</span>
      </div>
      <p className="mt-1 text-[13.5px] text-gray-900">
        <span className="font-semibold">{monthLabel(last.month)}</span>, taken {day(last.createdAt)}{last.late ? " (late)" : ""}.{" "}
        {last.score ? <><span className="font-semibold tabular-nums">{last.score.correct} of {last.score.answered}</span> answered right.</> : "Too few answers marked by code to give a figure."}
        {last.retakes > 0 ? ` ${last.retakes} practice ${last.retakes === 1 ? "retake" : "retakes"}.` : ""}
      </p>
      {last.weak.length > 0 && <p className="mt-1 text-[13px] text-gray-700">To go over: {last.weak.slice(0, 3).join(", ")}.</p>}
      <p className="mt-2 flex flex-wrap gap-x-4">
        <Link href={resultsHref} className={`inline-flex min-h-[44px] items-center text-[13.5px] font-semibold underline underline-offset-2 pointer-coarse:min-h-[48px] ${focusRing}`}>See results by topic</Link>
        <Link href={evaluateHref} className={`inline-flex min-h-[44px] items-center text-[13.5px] font-semibold underline underline-offset-2 pointer-coarse:min-h-[48px] ${focusRing}`}>Monthly reviews in Evaluate</Link>
      </p>
    </section>
  );
}
