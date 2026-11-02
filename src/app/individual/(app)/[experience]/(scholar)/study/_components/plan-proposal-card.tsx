"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import type { PlanProposal, ProposalDecision } from "@/lib/individual/scholar/plan-proposal";
import { minutesWords, sequencePreview } from "@/lib/individual/scholar/plan-view";
import { hintCls, primaryBtn, secondaryBtn } from "./plan-style";
import { ErrorLine, callJson, errorOf } from "./plan-ui";
import { PlanSetup } from "./plan-setup";

// THE READY PAGE'S "SUGGESTED STUDY PLAN" (PLP-01..04). A compact card per material, from the material's own sections: the topics in order, the
// workload and sessions it would take, the revision points. It is a suggestion. Start learning is above it and never waits for it. The learner's
// answer is kept (Accept, Not now, Decline) and shown when it exists. The first upload with no plan offers the three-question setup inline;
// later uploads offer to add the topics to the plan they already have. No AI.

const API = "/api/individual/scholar/plan/proposal";
const DECISION_WORD: Record<ProposalDecision, string> = { accepted: "You added this to My Plan.", declined: "You chose not to plan this one.", deferred: "You said not now. It stays here for later." };

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
  const shown = saidNow ?? decision;
  // A slide that repeats an earlier heading of this material is the same topic: listed once, as it is counted once.
  const { shown: steps, more } = sequencePreview(proposal.sequence.filter(s => s.minutes > 0 || s.coveredIn.length > 0), 6);
  const later = hasPlan;

  async function answer(d: ProposalDecision) {
    setBusy(true); setError("");
    const r = await callJson(API, "POST", { materialId: proposal.materialId, decision: d });
    setBusy(false);
    if (!r.ok) { setError(errorOf(r, "Your answer could not be saved just now.")); return false; }
    setSaidNow(d); router.refresh();
    return true;
  }
  async function accept() {
    // A first plan needs the three answers: ask them here, then record the acceptance. A later upload joins the plan that exists.
    if (!hasPlan) { setSetup(true); return; }
    await answer("accepted");
  }

  return (
    <section aria-labelledby={`${uid}-h`} className="mt-5 rounded-xl border border-gray-200 bg-gray-50 p-4" data-testid="plan-proposal">
      <h3 id={`${uid}-h`} className="text-[12px] font-bold uppercase tracking-[0.12em] text-gray-500">{later ? "Add to My Plan" : "Suggested study plan"}</h3>
      <p className="mt-1 text-[14px] text-gray-800">{proposal.summary}</p>
      {steps.length > 0 && (
        <ol className="mt-2 list-decimal space-y-0.5 pl-5 text-[13.5px] text-gray-800">
          {steps.map(s => <li key={s.chunkId}>{s.label}{s.coveredIn.length ? <span className="text-gray-600"> · already planned from {s.coveredIn.join(", ")}</span> : null}</li>)}
        </ol>
      )}
      {more > 0 && <p className={hintCls}>+{more} more</p>}
      <dl className="mt-2 grid gap-x-6 gap-y-1 text-[13px] text-gray-700 sm:grid-cols-3">
        <div><dt className="font-semibold text-gray-900">Estimated workload</dt><dd>{minutesWords(proposal.workloadMinutes)}</dd></div>
        <div><dt className="font-semibold text-gray-900">Suggested sessions</dt><dd>{proposal.sessions.sessionsNeeded} of {proposal.sessions.sessionMinutes} min{proposal.sessions.usingDefaults ? " (a starting guess)" : ""}</dd></div>
        <div><dt className="font-semibold text-gray-900">Revision points</dt><dd>{proposal.revisionPoints.length ? proposal.revisionPoints.map(r => r.label).join(", ") : "None suggested"}</dd></div>
      </dl>

      {shown && <p className="mt-3 text-[13.5px] font-semibold text-gray-800" aria-live="polite">{DECISION_WORD[shown]}</p>}
      {shown !== "accepted" && !setup && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className={primaryBtn} style={{ background: accent }} disabled={busy || !recordable} onClick={() => void accept()}>{later ? "Add these topics to My Plan" : "Accept"}</button>
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
