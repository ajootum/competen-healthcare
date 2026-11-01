"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { MONTHLY_STANDING_LINE, monthLabel } from "@/lib/individual/scholar/monthly-review";
import { evaluationHref, studyHref } from "./question-view";

// SCHOLAR-MONTHLY-REVIEW-01 -- the Monthly learning review panel on Evaluate. For this month (and last month while it is still
// open): what it will cover, about how long it is, and Start, Resume, See results or Practice retake. Optional: nothing waits on it.
// The review is a Mock sitting (feedback at the end) kept as an evaluation, and the standing line is always shown.
//
// ⚠ ONE WORD AND ONE GLYPH PER STATE, never colour alone. One column, 44px targets (48px on a coarse pointer).

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900";
const btn = `inline-flex min-h-[44px] items-center justify-center rounded-xl px-4 py-2 text-[14px] font-semibold text-white hover:opacity-90 disabled:opacity-50 pointer-coarse:min-h-[48px] ${focusRing}`;
const ghost = `inline-flex min-h-[44px] items-center justify-center rounded-xl border border-gray-300 bg-white px-4 py-2 text-[14px] font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-50 pointer-coarse:min-h-[48px] ${focusRing}`;

export type ReviewRowView = { id: string; createdAt: string; late: boolean };
export type MonthPanelView = {
  month: string; lessons: number; sections: number; materials: number; subjects: string[]; estimated: number; hasActivity: boolean;
  state: "no_activity" | "ready" | "in_progress" | "done";
  original: ReviewRowView | null; retakes: ReviewRowView[]; resumeHref: string | null; recommended: string; late: boolean;
};

const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const STATE: Record<MonthPanelView["state"], { word: string; glyph: string }> = {
  no_activity: { word: "Nothing to review yet", glyph: "–" }, ready: { word: "Ready", glyph: "○" }, in_progress: { word: "In progress", glyph: "◐" }, done: { word: "Done", glyph: "✓" },
};

/** Start (or retake) one month: ask the server for the sitting, then open it in Revise to be taken. Notes are shown first when there is something to say. */
function StartReview({ month, retakeOf, label, primary, accent }: { month: string; retakeOf?: string; label: string; primary: boolean; accent: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ready, setReady] = useState<{ href: string; notes: string[]; asked: number; planned: number } | null>(null);
  async function start() {
    setBusy(true); setError(""); setReady(null);
    try {
      const res = await fetch("/api/individual/scholar/monthly-review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ month, retakeOf }) });
      const json = (await res.json().catch(() => ({}))) as { error?: string; session?: { id: string }; evscope?: unknown; notes?: string[]; asked?: number; planned?: number; shorter?: boolean };
      if (!res.ok || !json.session) { setError(json.error ?? "The review could not be started just now."); return; }
      const href = `${studyHref("revise")}?session=${json.session.id}&evaluate=fresh&evscope=${encodeURIComponent(JSON.stringify(json.evscope))}`;
      if (json.notes?.length || json.shorter) setReady({ href, notes: json.notes ?? [], asked: json.asked ?? 0, planned: json.planned ?? 0 });
      else router.push(href);
    } catch { setError("Competen could not be reached. Check your connection and try again."); }
    finally { setBusy(false); }
  }
  return (
    <div>
      <button type="button" className={primary ? btn : ghost} style={primary ? { background: accent } : undefined} disabled={busy} onClick={start}>{busy ? "Preparing…" : label}</button>
      {error && <p role="alert" className="mt-2 text-[13.5px] font-semibold text-red-800">{error}</p>}
      {ready && (
        <div role="status" className="mt-3 rounded-xl border border-sky-200 bg-sky-50/60 p-4">
          <p className="text-[14px] font-semibold text-gray-900">Your review is ready: {plural(ready.asked, "question")}{ready.asked < ready.planned ? ` (planned ${ready.planned})` : ""}.</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[13px] text-gray-800">{ready.notes.map(n => <li key={n}>{n}</li>)}</ul>
          <p className="mt-2"><Link href={ready.href} className={`${btn} no-underline`} style={{ background: accent }}>Begin the review</Link></p>
        </div>
      )}
    </div>
  );
}

function OptOut({ optedOut }: { optedOut: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function set(value: boolean) {
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/individual/scholar/study-calendar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "optout", value }) });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) { setError(json.error ?? "That could not be saved just now."); return; }
      router.refresh();
    } catch { setError("Competen could not be reached. Check your connection and try again."); }
    finally { setBusy(false); }
  }
  return (
    <div>
      <button type="button" className={ghost} disabled={busy} onClick={() => set(!optedOut)}>{busy ? "Saving…" : optedOut ? "Suggest monthly reviews again" : "Don't suggest monthly reviews"}</button>
      {error && <p role="alert" className="mt-2 text-[13.5px] font-semibold text-red-800">{error}</p>}
    </div>
  );
}

export type NudgeView = { month: string; recommended: string; late: boolean };

export function MonthlyReviewPanel({ panels, nudges, optedOut, canOptOut, reminders, currentMonth, accent }: {
  panels: MonthPanelView[]; nudges: NudgeView[]; optedOut: boolean; canOptOut: boolean; reminders: boolean; currentMonth: string; accent: string;
}) {
  return (
    <section aria-labelledby="mr-h" className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="mr-h" className="text-[15px] font-bold text-gray-900">Monthly learning review</h2>
        <span className="rounded-full border border-gray-300 bg-gray-50 px-2.5 py-0.5 text-[12px] font-semibold text-gray-800">{MONTHLY_STANDING_LINE}</span>
      </div>
      <p className="mt-1 text-[13px] text-gray-700">A short, balanced test of what you actually studied in a month: questions from those sections, your earlier gaps and scenarios, with feedback at the end. Optional: nothing waits on it.</p>

      {reminders && !optedOut && nudges.length > 0 && (
        <p role="status" className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-[13.5px] text-amber-900">
          <span aria-hidden="true">★ </span><span className="font-semibold">Reminder: </span>
          {nudges.map(n => `your ${monthLabel(n.month)} review is open${n.late ? " (late)" : ` (recommended around ${day(n.recommended)})`}`).join(" and ")}. It is optional.
        </p>
      )}

      {optedOut ? (
        <div className="mt-3 space-y-2">
          <p className="rounded-xl border border-dashed border-gray-300 p-3 text-[13.5px] text-gray-700">You chose not to be shown monthly review suggestions.</p>
          {canOptOut && <OptOut optedOut />}
        </div>
      ) : (
        <>
          <div className="mt-3 space-y-3">
            {panels.length === 0 && <p className="rounded-xl border border-dashed border-gray-300 p-3 text-[13.5px] text-gray-700">Nothing is recorded for this month yet. The review appears once you have studied something.</p>}
            {panels.map(p => {
              const s = STATE[p.state];
              return (
                <article key={p.month} aria-labelledby={`mr-${p.month}`} className="rounded-xl border border-gray-200 p-3 sm:p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 id={`mr-${p.month}`} className="text-[14px] font-bold text-gray-900">{monthLabel(p.month)}{p.month === currentMonth ? " (this month)" : ""}</h3>
                    <span className="inline-flex items-center gap-1 rounded-full border border-gray-300 bg-gray-50 px-2.5 py-0.5 text-[12px] font-semibold text-gray-800"><span aria-hidden="true">{s.glyph}</span>{s.word}</span>
                  </div>
                  {p.hasActivity ? (
                    <p className="mt-1 text-[13px] text-gray-800">
                      Covers {plural(p.lessons, "lesson")} and {plural(p.sections, "section")} of {plural(p.materials, "material")}
                      {p.subjects.length ? `: ${p.subjects.slice(0, 5).join(", ")}${p.subjects.length > 5 ? " and more" : ""}` : ""}. About {plural(p.estimated, "question")} at most, feedback at the end.
                    </p>
                  ) : <p className="mt-1 text-[13px] text-gray-700">Nothing studied in this month has been recorded.</p>}
                  {p.late && p.state !== "done" && p.hasActivity && <p className="mt-1 text-[13px] text-gray-700">This month has ended. You can still take the review: it is marked late.</p>}
                  {reminders && p.state === "ready" && !p.late && <p className="mt-1 text-[13px] text-gray-700">Recommended around {day(p.recommended)}.</p>}

                  <div className="mt-3 flex flex-wrap items-start gap-2">
                    {p.state === "ready" && <StartReview month={p.month} label="Start the review" primary accent={accent} />}
                    {p.state === "in_progress" && p.resumeHref && <Link href={p.resumeHref} className={`${btn} no-underline`} style={{ background: accent }}>Resume the review</Link>}
                    {p.state === "in_progress" && <StartReview month={p.month} label="Start again" primary={false} accent={accent} />}
                    {p.state === "done" && p.original && <Link href={evaluationHref(p.original.id)} className={`${btn} no-underline`} style={{ background: accent }}>See results</Link>}
                    {p.state === "done" && p.original && <StartReview month={p.month} retakeOf={p.original.id} label="Practice retake" primary={false} accent={accent} />}
                  </div>
                  {p.state === "done" && p.original && (
                    <div className="mt-2 text-[12.5px] text-gray-700">
                      <p>Taken {day(p.original.createdAt)}{p.original.late ? " (late)" : ""}. This result stays as your original. A retake is practice and never replaces it.</p>
                      {p.retakes.length > 0 && (
                        <ul className="mt-1 list-disc space-y-0.5 pl-5">
                          {p.retakes.map(r => <li key={r.id}><Link href={evaluationHref(r.id)} className={`underline ${focusRing}`}>Practice retake, {day(r.createdAt)}</Link></li>)}
                        </ul>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
          {canOptOut && <div className="mt-3"><OptOut optedOut={false} /></div>}
        </>
      )}
    </section>
  );
}
