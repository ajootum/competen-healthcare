"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { MONTHLY_STANDING_LINE, monthLabel, type MonthlyBreakdown, type SectionResult } from "@/lib/individual/scholar/monthly-review";
import { evaluationHref, studyHref } from "./question-view";

// SCHOLAR-MONTHLY-REVIEW-01 -- a kept monthly review's results, on the evaluation page. By section and topic, never one blended
// number: each section says how many of its questions were answered right (answers marked by code only, the rest said apart),
// or that there are too few to say. Missed concepts link to Learn. Recommended revision links to Flashcards for that material
// and section, and to the mistake notebook. The standing line is always shown.
//
// ⚠ OPTIONAL FORMATIVE REVIEW, NOT VERIFIED COMPETENCE. The first review of a month is its original. A retake is practice.
// ⚠ One word beside every colour. 44px targets (48px on a coarse pointer).

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900";
const btn = `inline-flex min-h-[44px] items-center justify-center rounded-xl px-4 py-2 text-[14px] font-semibold text-white hover:opacity-90 disabled:opacity-50 pointer-coarse:min-h-[48px] ${focusRing}`;
const ghost = `inline-flex min-h-[44px] items-center justify-center rounded-xl border border-gray-300 bg-white px-4 py-2 text-[14px] font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-50 pointer-coarse:min-h-[48px] ${focusRing}`;
const link = `inline-flex min-h-[44px] items-center text-[13.5px] font-semibold underline underline-offset-2 pointer-coarse:min-h-[48px] ${focusRing}`;

const BAND: Record<string, { word: string; glyph: string; chip: string }> = {
  strong: { word: "Strong", glyph: "▲", chip: "border-green-300 bg-green-50 text-green-900" },
  developing: { word: "Developing", glyph: "■", chip: "border-amber-300 bg-amber-50 text-amber-900" },
  needs_work: { word: "Needs work", glyph: "▼", chip: "border-red-300 bg-red-50 text-red-900" },
};
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export type MonthlyResultsView = {
  month: string;
  breakdown: MonthlyBreakdown;
  planned: number;
  late: boolean;
  /** This is the month's original review (the first completed). Otherwise it is a practice retake. */
  original: boolean;
  originalId: string | null;
  retakes: { id: string; createdAt: string }[];
  /** The review began after its month ended, or the sitting asked for fewer questions than the blueprint. */
  blueprint: { sections: number; core: number; application: number; gaps: number; omitted: number } | null;
  /** The learner can start a retake (the review is offered here). */
  canRetake: boolean;
  /** Topics worth putting first in the study plan, and the plan itself (null: the study plan is not available here). */
  weak: string[];
  plan: { priorities: string[]; settings: Record<string, unknown> | null } | null;
  progressHref: string;
};

async function call(url: string, body: unknown): Promise<{ ok: boolean; json: Record<string, any> }> { // eslint-disable-line @typescript-eslint/no-explicit-any
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { ok: res.ok, json: await res.json().catch(() => ({})) };
  } catch { return { ok: false, json: { error: "Competen could not be reached. Check your connection and try again." } }; }
}

function Retake({ month, originalId, accent }: { month: string; originalId: string; accent: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ready, setReady] = useState<{ href: string; notes: string[] } | null>(null);
  async function go() {
    setBusy(true); setError(""); setReady(null);
    const r = await call("/api/individual/scholar/monthly-review", { month, retakeOf: originalId });
    setBusy(false);
    if (!r.ok || !r.json.session) { setError(r.json.error ?? "The retake could not be started just now."); return; }
    const href = `${studyHref("revise")}?session=${r.json.session.id}&evaluate=fresh&evscope=${encodeURIComponent(JSON.stringify(r.json.evscope))}`;
    if (r.json.notes?.length) setReady({ href, notes: r.json.notes }); else router.push(href);
  }
  return (
    <div>
      <button type="button" className={btn} style={{ background: accent }} disabled={busy} onClick={go}>{busy ? "Preparing…" : "Practice retake"}</button>
      {error && <p role="alert" className="mt-2 text-[13.5px] font-semibold text-red-800">{error}</p>}
      {ready && (
        <div role="status" className="mt-2 rounded-xl border border-sky-200 bg-sky-50/60 p-3">
          <ul className="list-disc space-y-0.5 pl-5 text-[13px] text-gray-800">{ready.notes.map(n => <li key={n}>{n}</li>)}</ul>
          <p className="mt-2"><Link href={ready.href} className={`${btn} no-underline`} style={{ background: accent }}>Begin the retake</Link></p>
        </div>
      )}
    </div>
  );
}

/** Weak topics to put first in the plan. The learner confirms which; the existing study plan route saves them (at most ten in all). */
function AddToPlan({ weak, plan, progressHref }: { weak: string[]; plan: NonNullable<MonthlyResultsView["plan"]>; progressHref: string }) {
  const router = useRouter();
  const have = new Set(plan.priorities.map(p => p.toLowerCase()));
  const fresh = weak.filter(w => !have.has(w.toLowerCase()));
  const room = Math.max(0, 10 - plan.priorities.length);
  const [chosen, setChosen] = useState<string[]>(fresh.slice(0, room));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  if (!fresh.length) return <p className="text-[13px] text-gray-700">{weak.length ? "Your plan already puts these topics first." : "Nothing in this review needs putting first in your plan."}</p>;
  if (!plan.settings) return <p className="text-[13px] text-gray-700">Set up your study plan on <Link href={progressHref} className={`underline ${focusRing}`}>Progress</Link> to put these topics first.</p>;
  if (room === 0) return <p className="text-[13px] text-gray-700">Your plan already has ten priority topics. Remove one on <Link href={progressHref} className={`underline ${focusRing}`}>Progress</Link> to add these.</p>;
  if (done) return <p role="status" className="text-[13.5px] font-semibold text-gray-900">Added to your plan priorities. <Link href={progressHref} className={`underline ${focusRing}`}>See your plan</Link></p>;
  async function add() {
    setBusy(true); setError("");
    const r = await call("/api/individual/scholar/study-plan", { ...plan.settings, priorities: [...plan.priorities, ...chosen].slice(0, 10) });
    setBusy(false);
    if (!r.ok) { setError(r.json.error ?? "Your plan could not be changed just now."); return; }
    setDone(true); router.refresh();
  }
  return (
    <fieldset>
      <legend className="text-[13px] font-semibold text-gray-800">Put these first in my study plan <span className="font-normal text-gray-600">(you choose, room for {room} more)</span></legend>
      <ul className="mt-1 grid gap-1 sm:grid-cols-2">
        {fresh.map(t => {
          const on = chosen.includes(t);
          const full = !on && chosen.length >= room;
          return (
            <li key={t}>
              <label className={`flex min-h-[44px] items-center gap-2 rounded-xl border border-gray-200 px-3 py-2 text-[13.5px] pointer-coarse:min-h-[48px] ${full ? "opacity-50" : "hover:bg-gray-50"}`}>
                <input type="checkbox" className="h-5 w-5 shrink-0" checked={on} disabled={full} onChange={() => setChosen(c => (c.includes(t) ? c.filter(x => x !== t) : [...c, t]))} />
                <span className="min-w-0 break-words">{t}</span>
              </label>
            </li>
          );
        })}
      </ul>
      <button type="button" className={`${ghost} mt-2`} disabled={busy || chosen.length === 0} onClick={add}>{busy ? "Adding…" : "Add to my plan priorities"}</button>
      {error && <p role="alert" className="mt-2 text-[13.5px] font-semibold text-red-800">{error}</p>}
    </fieldset>
  );
}

function SectionRow({ s }: { s: SectionResult }) {
  const band = s.band ? BAND[s.band] : null;
  const topic = s.topics[0];
  const missed = s.answered > s.correct;
  return (
    <li className="rounded-xl border border-gray-200 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="break-words text-[14px] font-semibold text-gray-900">{topic ?? s.materialTitle}</p>
          <p className="text-[12.5px] text-gray-600">{s.materialTitle}, {s.label}{s.topics.length > 1 ? ` · also ${s.topics.slice(1).join(", ")}` : ""}</p>
        </div>
        {band
          ? <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[12px] font-semibold ${band.chip}`}><span aria-hidden="true">{band.glyph}</span>{band.word}</span>
          : <span className="inline-flex rounded-full border border-gray-300 bg-gray-50 px-2.5 py-0.5 text-[12px] font-semibold text-gray-800">{s.state === "none" ? "Not answered" : "Too few to say"}</span>}
      </div>
      <p className="mt-1 text-[13px] text-gray-800">
        {s.answered > 0 ? <><span className="font-semibold tabular-nums">{s.correct} of {s.answered}</span> answered right{s.percent !== null ? ` (${s.percent}%)` : ""}.</> : "No answer marked by code here."}
        {s.other > 0 ? ` ${plural(s.other, "answer")} marked by you or by AI, shown apart and not counted.` : ""}
        {s.state === "too_few" ? " One answer is too few to say how this topic is going." : ""}
      </p>
      {(missed || s.band === "needs_work" || s.band === "developing" || s.state !== "ok") && (
        <p className="mt-1 flex flex-wrap gap-x-4">
          <Link href={`${studyHref("learn")}?section=${encodeURIComponent(s.chunkId)}`} className={link}>{missed ? "Go over the missed concepts in Learn" : "Learn this section"}</Link>
          <Link href={`${studyHref("revise/flashcards")}?material=${encodeURIComponent(s.materialId)}&section=${encodeURIComponent(s.chunkId)}`} className={link}>Revise it with flashcards</Link>
        </p>
      )}
    </li>
  );
}

export function MonthlyResults({ v, accent }: { v: MonthlyResultsView; accent: string }) {
  const o = v.breakdown.overall;
  const weakest = v.breakdown.bySection.filter(s => s.band === "needs_work" || s.band === "developing");
  const materialId = weakest[0]?.materialId || v.breakdown.bySection[0]?.materialId || "";
  return (
    <section aria-labelledby="mr-res-h" className="mb-6 space-y-4">
      <div className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="mr-res-h" className="text-[15px] font-bold text-gray-900">Monthly learning review: {monthLabel(v.month)}</h2>
          <span className="rounded-full border border-gray-300 bg-gray-50 px-2.5 py-0.5 text-[12px] font-semibold text-gray-800">{MONTHLY_STANDING_LINE}</span>
        </div>
        <p className="mt-1 flex flex-wrap gap-2 text-[12.5px]">
          <span className="rounded-full border border-gray-300 bg-gray-50 px-2.5 py-0.5 font-semibold text-gray-800">{v.original ? "Original result for the month" : "Practice retake"}</span>
          {v.late && <span className="rounded-full border border-amber-300 bg-amber-50 px-2.5 py-0.5 font-semibold text-amber-900">Taken late, after the month ended</span>}
        </p>
        <p className="mt-3 text-[14px] text-gray-900">
          {o.percent !== null
            ? <><span className="font-bold tabular-nums">{o.correct} of {o.answered}</span> questions answered right (answers marked by code).</>
            : <>Too few answers marked by code to give a figure ({plural(o.answered, "answer")}).</>}
          {" "}{plural(o.asked, "question")} asked{v.planned > o.asked ? ` of ${v.planned} planned` : ""}
          {o.other > 0 ? `, ${o.other} marked by you or by AI and shown apart` : ""}{o.unanswered > 0 ? `, ${o.unanswered} not answered` : ""}.
        </p>
        <p className="mt-1 text-[13px] text-gray-700">
          Core knowledge: {v.breakdown.byType.core.correct} of {v.breakdown.byType.core.answered} right{v.breakdown.byType.application.asked > 0 ? ` · Application: ${v.breakdown.byType.application.correct} of ${v.breakdown.byType.application.answered} right` : " · No application questions were available."}
        </p>
        {v.blueprint && (
          <details className="mt-2 text-[13px] text-gray-700">
            <summary className={`min-h-[44px] cursor-pointer py-2 font-semibold pointer-coarse:min-h-[48px] ${focusRing}`}>How this review was balanced</summary>
            <p>It was planned over {plural(v.blueprint.sections, "section")} you worked on: {v.blueprint.core} core knowledge, {v.blueprint.application} application and {v.blueprint.gaps} earlier gaps{v.blueprint.omitted ? `, and ${plural(v.blueprint.omitted, "lighter section")} left out to keep it short` : ""}. Where no stored question fitted a place, core knowledge took it.</p>
          </details>
        )}
        {!v.original && v.originalId && <p className="mt-2 text-[13px]"><Link href={evaluationHref(v.originalId)} className={`underline ${focusRing}`}>See the original result</Link></p>}
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
        <h2 className="text-[15px] font-bold text-gray-900">By topic</h2>
        <p className="mt-1 text-[13px] text-gray-700">Weakest first. Each topic is shown with its own count: there is no single score.</p>
        {v.breakdown.bySection.length === 0 ? <p className="mt-2 text-[13.5px] text-gray-700">No questions could be read for this review.</p> : (
          <ul className="mt-3 space-y-2">{v.breakdown.bySection.map(s => <SectionRow key={s.chunkId} s={s} />)}</ul>
        )}
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
        <h2 className="text-[15px] font-bold text-gray-900">What to do next</h2>
        <ul className="mt-2 space-y-1 text-[13.5px] text-gray-800">
          {weakest.length > 0
            ? <li>Revise {weakest.slice(0, 3).map(s => s.topics[0] ?? s.label).join(", ")}: use the links under each topic above, or <Link href={`${studyHref("revise/flashcards")}${materialId ? `?material=${encodeURIComponent(materialId)}` : ""}`} className={`underline ${focusRing}`}>open Flashcards for that material</Link>.</li>
            : <li>Nothing here is marked as needing work. Keep it fresh with your spaced review.</li>}
          {v.breakdown.missed.length > 0 && <li><Link href={`${studyHref("revise/mistakes")}${materialId ? `?material=${encodeURIComponent(materialId)}` : ""}`} className={`underline ${focusRing}`}>Revise your mistakes</Link> ({plural(v.breakdown.missed.length, "question")} missed in this review).</li>}
        </ul>
        {v.plan && <div className="mt-3"><AddToPlan weak={v.weak} plan={v.plan} progressHref={v.progressHref} /></div>}
        <div className="mt-4 flex flex-wrap items-start gap-3">
          {v.canRetake && v.originalId && <Retake month={v.month} originalId={v.originalId} accent={accent} />}
          <Link href={evaluationHref()} className={ghost}>Back to Evaluate</Link>
        </div>
        {v.retakes.length > 0 && v.original && (
          <div className="mt-3 text-[12.5px] text-gray-700">
            <p className="font-semibold">Practice retakes</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">{v.retakes.map(r => <li key={r.id}><Link href={evaluationHref(r.id)} className={`underline ${focusRing}`}>Practice retake, {day(r.createdAt)}</Link></li>)}</ul>
          </div>
        )}
      </div>
    </section>
  );
}
