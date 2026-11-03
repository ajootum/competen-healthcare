"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useMemo, useState } from "react";
import { hoursWords, type PlanProposal, type ProposalDecision } from "@/lib/individual/scholar/plan-proposal";
import { estimateBasis, mergeUnits, splitUnit, toStored, toggleExcluded, togglePriority, unitTotals, type ProposedUnit } from "@/lib/individual/scholar/plan-units";
import { minutesWords, sequencePreview } from "@/lib/individual/scholar/plan-view";
import { fieldCls, hintCls, primaryBtn, quietBtn, secondaryBtn, tagCls } from "./plan-style";
import { ErrorLine, callJson, errorOf } from "./plan-ui";
import { PlanSetup } from "./plan-setup";

// THE READY PAGE'S "SUGGESTED STUDY PLAN" (PLP-01..04). A compact card per material. It is a suggestion. Start learning is above it and never
// waits for it. The learner's answer is kept (Accept, Not now, Decline) and shown when it exists. The first upload with no plan offers the
// three-question setup inline; later uploads offer to add the topics to the plan they already have. No AI.
//
// SCHOLAR-PLAN-UNITS-01 (owner, 3 Nov 2026): where Scholar could read the notes, the card is a REVIEW STEP over the proposed LEARNING UNITS
// (plan-units.ts): each unit's title, where it is in the notes, what it covers, and its estimated reading, learning, revision and practice
// time with the basis stated. The learner can merge a unit with the next, split one before a section, leave one out or put one first, and
// the totals follow, before "Add to My Plan". What is added is the units as reviewed. The sections themselves are untouched.

const API = "/api/individual/scholar/plan/proposal";
const COMPLEXITY_WORD = { plain: "plain text", moderate: "moderately dense text", dense: "dense text" } as const;

export function PlanProposalCard({ accent, today, proposal, decision, hasPlan, recordable, extras, planHref }: {
  accent: string; today: string;
  proposal: PlanProposal; decision: ProposalDecision | null;
  /** A plan (study plan settings) already exists: this is a later upload. */
  hasPlan: boolean;
  /** Migration 840 present: the answer can be remembered. */
  recordable: boolean;
  extras: boolean;
  planHref: string;
}) {
  const router = useRouter();
  const uid = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [setup, setSetup] = useState(false);
  const [saidNow, setSaidNow] = useState<ProposalDecision | null>(null);
  const [units, setUnits] = useState<ProposedUnit[] | null>(proposal.units);
  const [splitting, setSplitting] = useState<{ index: number; before: number } | null>(null);
  const [added, setAdded] = useState<number | null>(null);
  const shown = saidNow ?? decision;
  const later = hasPlan;
  const ctx = useMemo(() => ({ unit: proposal.unit, emptyUnits: (units ?? []).flatMap(u => u.pictureOnly) }), [proposal.unit, units]);
  const totals = useMemo(() => (units ? unitTotals(units) : null), [units]);
  const basis = useMemo(() => (units && totals
    ? estimateBasis(totals, { unread: units.reduce((n, u) => n + u.estimate.unread, 0), imageSlides: units.filter(u => !u.excluded).reduce((n, u) => n + u.estimate.imageSlides, 0), unit: proposal.unit })
    : proposal.basis), [units, totals, proposal.basis, proposal.unit]);
  // A slide that repeats an earlier heading of this material is the same topic: listed once, as it is counted once (the no-units path).
  const { shown: steps, more } = sequencePreview(proposal.sequence.filter(s => s.minutes > 0 || s.coveredIn.length > 0), 6);
  const planned = totals?.planned ?? 0;
  const decisionWord: Record<ProposalDecision, string> = {
    accepted: units ? `You added ${added ?? planned} learning ${(added ?? planned) === 1 ? "unit" : "units"} to My Plan.` : "You added this to My Plan.",
    declined: "You chose not to plan this one.", deferred: "You said not now. It stays here for later.",
  };

  async function answer(d: ProposalDecision) {
    setBusy(true); setError("");
    const body = d === "accepted" && units ? { materialId: proposal.materialId, decision: d, units: toStored(units) } : { materialId: proposal.materialId, decision: d };
    const r = await callJson(API, "POST", body);
    setBusy(false);
    if (!r.ok) { setError(errorOf(r, "Your answer could not be saved just now.")); return false; }
    if (d === "accepted") setAdded(planned);
    setSaidNow(d); router.refresh();
    return true;
  }
  async function accept() {
    if (units && planned === 0) { setError("Keep at least one learning unit, or choose not to plan these notes."); return; }
    // A first plan needs the three answers: ask them here, then record the acceptance. A later upload joins the plan that exists.
    if (!hasPlan) { setSetup(true); return; }
    await answer("accepted");
  }
  const editable = shown !== "accepted" && !setup && !busy;

  return (
    <section aria-labelledby={`${uid}-h`} className="mt-5 rounded-xl border border-gray-200 bg-gray-50 p-4" data-testid="plan-proposal">
      <h3 id={`${uid}-h`} className="text-[12px] font-bold uppercase tracking-[0.12em] text-gray-500">{later ? "Add to My Plan" : "Suggested study plan"}</h3>
      <p className="mt-1 text-[14px] text-gray-800">{units && totals ? summaryOf(totals, proposal) : proposal.summary}</p>

      {units && totals ? (
        <>
          <p className={`${hintCls} mt-1`}>Review the units before you add them: merge, split, leave one out, or put one first. The sections of your notes stay as they are.</p>
          <ol className="mt-3 space-y-2" aria-label="Proposed learning units">
            {units.map((u, i) => {
              const e = u.estimate;
              return (
                <li key={u.id} className={`rounded-lg border border-gray-200 bg-white p-3 ${u.excluded ? "opacity-70" : ""}`} data-testid="plan-unit">
                  <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0 flex-1">
                      <p className={`text-[14.5px] font-semibold text-gray-900 ${u.excluded ? "line-through" : ""}`}>
                        {u.priority && !u.excluded && <span className={`${tagCls} mr-2 align-middle`}>First</span>}
                        {u.excluded && <span className={`${tagCls} mr-2 align-middle`}>Not planned</span>}
                        {i + 1}. {u.title}
                      </p>
                      <p className="mt-0.5 text-[12.5px] text-gray-600">
                        {u.cite} · {u.parts.length} {u.parts.length === 1 ? "section" : "sections"}{u.pictureOnly.length ? ` · ${u.pictureOnly.length} picture-only ${u.pictureOnly.length === 1 ? proposal.unit : `${proposal.unit}s`}` : ""}{e.imageSlides ? ` · ${e.imageSlides} image-based` : ""}
                      </p>
                      {u.covers.length > 0 && <p className="mt-1 text-[13px] text-gray-700"><span className="font-semibold">Covers:</span> {u.covers.join(" · ")}</p>}
                      <p className="mt-1 text-[13px] text-gray-800">
                        <span className="font-semibold">About {hoursWords(e.total)}</span>: read {e.reading} · learn {e.learning} · revise {e.revision} · practise {e.practice} min · {COMPLEXITY_WORD[e.complexity]}
                      </p>
                    </div>
                    {editable && (
                      <div className="flex flex-wrap gap-1.5 md:max-w-[46%] md:justify-end">
                        {!u.excluded && <button type="button" className={quietBtn} onClick={() => setUnits(togglePriority(units, i))}>{u.priority ? "Not first" : "Put first"}</button>}
                        {!u.excluded && i < units.length - 1 && <button type="button" className={quietBtn} onClick={() => { setSplitting(null); setUnits(mergeUnits(units, i, ctx)); }}>Merge with next</button>}
                        {!u.excluded && u.parts.length > 1 && <button type="button" className={quietBtn} aria-expanded={splitting?.index === i} onClick={() => setSplitting(splitting?.index === i ? null : { index: i, before: u.parts[Math.floor(u.parts.length / 2)].ordinal })}>Split</button>}
                        <button type="button" className={quietBtn} onClick={() => { setSplitting(null); setUnits(toggleExcluded(units, i)); }}>{u.excluded ? "Include" : "Leave out"}</button>
                      </div>
                    )}
                  </div>
                  {editable && splitting?.index === i && (
                    <div className="mt-2 flex flex-col gap-2 border-t border-gray-100 pt-2 md:flex-row md:items-end">
                      <label className="block flex-1 text-[13px] font-semibold text-gray-800">
                        Split before
                        <select className={`${fieldCls} mt-1 font-normal`} value={splitting.before} onChange={ev => setSplitting({ index: i, before: Number(ev.target.value) })}>
                          {u.parts.slice(1).map(p => <option key={p.chunkId} value={p.ordinal}>{p.page !== null ? `${proposal.unit} ${p.page}` : `section ${p.ordinal}`}{p.heading ? ` · ${p.heading}` : ""}</option>)}
                        </select>
                      </label>
                      <div className="flex gap-1.5">
                        <button type="button" className={secondaryBtn} onClick={() => { setUnits(splitUnit(units, i, splitting.before, ctx)); setSplitting(null); }}>Split here</button>
                        <button type="button" className={quietBtn} onClick={() => setSplitting(null)}>Cancel</button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
          <dl className="mt-3 grid gap-x-6 gap-y-1 text-[13px] text-gray-700 sm:grid-cols-2 lg:grid-cols-4" data-testid="plan-unit-totals">
            <div><dt className="font-semibold text-gray-900">Reading</dt><dd>{hoursWords(totals.reading)}</dd></div>
            <div><dt className="font-semibold text-gray-900">Learning</dt><dd>{hoursWords(totals.learning)}</dd></div>
            <div><dt className="font-semibold text-gray-900">Revision</dt><dd>{hoursWords(totals.revision)}</dd></div>
            <div><dt className="font-semibold text-gray-900">Practice</dt><dd>{hoursWords(totals.practice)}</dd></div>
          </dl>
        </>
      ) : (
        <>
          {steps.length > 0 && (
            <ol className="mt-2 list-decimal space-y-0.5 pl-5 text-[13.5px] text-gray-800">
              {steps.map(s => <li key={s.chunkId}>{s.label}{s.coveredIn.length ? <span className="text-gray-600"> · already planned from {s.coveredIn.join(", ")}</span> : null}</li>)}
            </ol>
          )}
          {more > 0 && <p className={hintCls}>+{more} more</p>}
        </>
      )}
      <dl className="mt-2 grid gap-x-6 gap-y-1 text-[13px] text-gray-700 sm:grid-cols-3">
        <div><dt className="font-semibold text-gray-900">Estimated workload</dt><dd>{minutesWords(totals ? totals.total : proposal.workloadMinutes)}{units ? ` over ${planned} ${planned === 1 ? "unit" : "units"}` : ""}</dd></div>
        <div><dt className="font-semibold text-gray-900">Suggested sessions</dt><dd>{sessionsOf(totals ? totals.total : proposal.workloadMinutes, proposal.sessions.sessionMinutes)} of {proposal.sessions.sessionMinutes} min{proposal.sessions.usingDefaults ? " (a starting guess)" : ""}</dd></div>
        <div><dt className="font-semibold text-gray-900">Revision points</dt><dd>{proposal.revisionPoints.length ? proposal.revisionPoints.map(r => r.label).join(", ") : "None suggested"}</dd></div>
      </dl>
      <details className="mt-2">
        <summary className="inline-flex min-h-[44px] cursor-pointer items-center text-[13px] font-semibold text-gray-800 pointer-coarse:min-h-[var(--cmp-touch-min)]">How these estimates are made</summary>
        <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[12.5px] text-gray-700">{basis.map((b, i) => <li key={i}>{b}</li>)}</ul>
      </details>

      {shown && <p className="mt-3 text-[13.5px] font-semibold text-gray-800" aria-live="polite">{decisionWord[shown]}</p>}
      {shown !== "accepted" && !setup && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className={primaryBtn} style={{ background: accent }} disabled={busy || !recordable} onClick={() => void accept()}>
            {units ? `Add ${planned} ${planned === 1 ? "unit" : "units"} to My Plan` : later ? "Add these topics to My Plan" : "Accept"}
          </button>
          {!later && <Link href={planHref} className={secondaryBtn}>Personalise</Link>}
          {shown !== "deferred" && <button type="button" className={secondaryBtn} disabled={busy || !recordable} onClick={() => void answer("deferred")}>Not now</button>}
          {shown !== "declined" && <button type="button" className={secondaryBtn} disabled={busy || !recordable} onClick={() => void answer("declined")}>{later ? "Don’t add" : "Decline"}</button>}
        </div>
      )}
      {!recordable && <p className={`${hintCls} mt-2`}>Your answer cannot be remembered here yet, so these choices are not available. You can still learn from this material.</p>}
      <div className="mt-2"><ErrorLine text={error} /></div>
      {setup && (
        <div className="mt-3">
          <PlanSetup accent={accent} today={today} initial={null} extras={extras} onDone={() => setSetup(false)} afterSave={() => answer("accepted")} />
        </div>
      )}
    </section>
  );
}

/** Pure. Sessions of `sessionMinutes` a workload needs. */
const sessionsOf = (minutes: number, sessionMinutes: number) => (minutes > 0 ? Math.ceil(minutes / Math.max(1, sessionMinutes)) : 0);

/** The summary line as the review changes it: the server's wording, with the live totals. */
function summaryOf(t: ReturnType<typeof unitTotals>, p: PlanProposal): string {
  if (t.planned === 0) return `${t.units} learning ${t.units === 1 ? "unit" : "units"} proposed, none kept. Include at least one to add these notes to My Plan.`;
  const sessions = sessionsOf(t.total, p.sessions.sessionMinutes);
  const weeks = sessions > 0 ? Math.ceil(sessions / Math.max(1, p.sessions.daysPerWeek)) : 0;
  return `${t.sections} ${t.sections === 1 ? "section" : "sections"} grouped into ${t.planned} learning ${t.planned === 1 ? "unit" : "units"}${t.excluded ? ` (${t.excluded} left out)` : ""}, about ${hoursWords(t.total)} in all: ${sessions} ${sessions === 1 ? "session" : "sessions"} of ${p.sessions.sessionMinutes} minutes${p.sessions.usingDefaults ? " (a starting suggestion: you can change it)" : ""}, about ${weeks} ${weeks === 1 ? "week" : "weeks"} at ${p.sessions.daysPerWeek} ${p.sessions.daysPerWeek === 1 ? "day" : "days"} a week.`;
}
