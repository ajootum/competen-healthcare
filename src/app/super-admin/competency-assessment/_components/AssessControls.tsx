"use client";

import { useState } from "react";
import { OUTCOME_CLASS_LABEL, type MethodContent } from "@/lib/competency/verification-config";
import { Message, ghost, input, primary, useSend } from "../../verification-studio/_components/StudioControls";

// The write half of /super-admin/competency-assessment (migration 510). Posts to /api/hq/competency-assessment, gated by
// hq.competency.verification.assess. 510 refuses the decision unless this is the assigned assessor, under their own
// active appointment, in scope, and not the person -- and pins the criteria, the content and the evidence reviewed.

const PATH = "/api/hq/competency-assessment";
const label = "block text-[12.5px] font-semibold text-gray-700";

export function DecisionForm({ requestId, content, levels, evidence, idPrefix }: {
  requestId: string; content: MethodContent; levels: { id: string; label: string }[]; evidence: { id: string; label: string }[]; idPrefix: string;
}) {
  const [outcomeCode, setOutcome] = useState("");
  const [levelId, setLevel] = useState("");
  const [rationale, setRationale] = useState("");
  const [crit, setCrit] = useState<Record<string, string>>({});
  const [check, setCheck] = useState<Record<string, string>>({});
  const [reviewed, setReviewed] = useState<string[]>([]);
  const { busy, msg, send } = useSend(PATH);
  const outcome = content.outcomes.find(o => o.code === outcomeCode);
  const offered = content.levelIds.length ? levels.filter(l => content.levelIds.includes(l.id)) : levels;
  const p = idPrefix;
  return (
    <div className="space-y-4">
      {content.criteria.length > 0 && (
        <fieldset className="space-y-2">
          <legend className={label}>Criteria</legend>
          {content.criteria.map(c => (
            <div key={c.id} role="radiogroup" aria-labelledby={`${p}-c-${c.id}`} className="flex flex-wrap items-center gap-3">
              <span id={`${p}-c-${c.id}`} className="min-w-[14rem] flex-1 text-[13px] text-gray-800">{c.text}{c.required ? "" : " (optional)"}</span>
              {(["met", "not_met", "not_applicable"] as const).map(r => (
                <label key={r} htmlFor={`${p}-c-${c.id}-${r}`} className="flex items-center gap-1 text-[12.5px] text-gray-700">
                  <input id={`${p}-c-${c.id}-${r}`} type="radio" name={`${p}-c-${c.id}`} checked={crit[c.id] === r} onChange={() => setCrit(x => ({ ...x, [c.id]: r }))} />{r === "met" ? "Met" : r === "not_met" ? "Not met" : "Not applicable"}
                </label>
              ))}
            </div>
          ))}
        </fieldset>
      )}
      {content.checklist.length > 0 && (
        <fieldset className="space-y-2">
          <legend className={label}>Checklist</legend>
          {content.checklist.map(c => (
            <div key={c.id} role="radiogroup" aria-labelledby={`${p}-k-${c.id}`} className="flex flex-wrap items-center gap-3">
              <span id={`${p}-k-${c.id}`} className="min-w-[14rem] flex-1 text-[13px] text-gray-800">{c.text}{c.critical ? " (critical)" : ""}</span>
              {(["done", "not_done"] as const).map(r => (
                <label key={r} htmlFor={`${p}-k-${c.id}-${r}`} className="flex items-center gap-1 text-[12.5px] text-gray-700">
                  <input id={`${p}-k-${c.id}-${r}`} type="radio" name={`${p}-k-${c.id}`} checked={check[c.id] === r} onChange={() => setCheck(x => ({ ...x, [c.id]: r }))} />{r === "done" ? "Done" : "Not done"}
                </label>
              ))}
            </div>
          ))}
        </fieldset>
      )}
      {evidence.length > 0 && (
        <fieldset>
          <legend className={label}>Evidence you reviewed</legend>
          {evidence.map(e => (
            <label key={e.id} htmlFor={`${p}-e-${e.id}`} className="flex items-start gap-2 text-[13px] text-gray-800">
              <input id={`${p}-e-${e.id}`} type="checkbox" className="mt-0.5" checked={reviewed.includes(e.id)} onChange={ev => setReviewed(x => ev.target.checked ? [...x, e.id] : x.filter(y => y !== e.id))} />{e.label}
            </label>
          ))}
        </fieldset>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        <div><label htmlFor={`${p}-o`} className={label}>Outcome of this assessment</label>
          <select id={`${p}-o`} value={outcomeCode} onChange={e => { setOutcome(e.target.value); setLevel(""); }} className={`${input} w-full`}>
            <option value="">Choose…</option>{content.outcomes.map(o => <option key={o.code} value={o.code}>{o.label} ({OUTCOME_CLASS_LABEL[o.class]})</option>)}
          </select></div>
        {outcome?.class === "verified" && (
          <div><label htmlFor={`${p}-l`} className={label}>Level verified</label>
            <select id={`${p}-l`} value={levelId} onChange={e => setLevel(e.target.value)} className={`${input} w-full`}><option value="">Choose…</option>{offered.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}</select></div>
        )}
      </div>
      <div><label htmlFor={`${p}-r`} className={label}>Reasons for the outcome: what you observed or reviewed (the person sees this)</label>
        <textarea id={`${p}-r`} rows={4} maxLength={4000} value={rationale} onChange={e => setRationale(e.target.value)} className={`${input} w-full`} /></div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={busy || !outcomeCode} className={primary} onClick={() => void send({
          action: "decide", requestId, outcomeCode, levelId: levelId || null, rationale,
          criteria: Object.entries(crit).map(([id, result]) => ({ id, result })), checklist: Object.entries(check).map(([id, result]) => ({ id, result })), evidenceReviewed: reviewed,
        }, "Decision recorded. It is kept as history with the criteria, the evidence and your appointment.")}>Record decision</button>
        <Message msg={msg} />
      </div>
    </div>
  );
}

export function Claim({ requestId, appointmentId }: { requestId: string; appointmentId: string }) {
  const { busy, msg, send } = useSend(PATH);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button type="button" disabled={busy} className={primary} onClick={() => void send({ action: "claim", requestId, appointmentId }, "Claimed. It is now with you.")}>Take this request</button>
      <Message msg={msg} />
    </span>
  );
}

export function Decline({ requestId, idPrefix }: { requestId: string; idPrefix: string }) {
  const [reason, setReason] = useState("");
  const { busy, msg, send } = useSend(PATH);
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div><label htmlFor={`${idPrefix}-d`} className={label}>Why you hand it back</label>
        <input id={`${idPrefix}-d`} value={reason} onChange={e => setReason(e.target.value)} maxLength={1000} className={`${input} w-72`} /></div>
      <button type="button" disabled={busy || reason.trim().length < 3} className={ghost} onClick={() => void send({ action: "decline", requestId, reason }, "Handed back to the Studio.")}>Hand back</button>
      <Message msg={msg} />
    </div>
  );
}
