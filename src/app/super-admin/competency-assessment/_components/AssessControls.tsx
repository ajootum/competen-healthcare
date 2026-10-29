"use client";

import { useState, type InputHTMLAttributes } from "react";
import { COMPONENT_STATUS_LABEL, OUTCOME_CLASS_LABEL, consolidatedOutcome, type MethodContent, type ScaleLevel } from "@/lib/competency/verification-config";
import { Message, ghost, input, primary, useSend } from "../../verification-studio/_components/StudioControls";

// The write half of /super-admin/competency-assessment (migration 510). Posts to /api/hq/competency-assessment, gated by
// hq.competency.verification.assess. 510 refuses the decision unless this is the assigned assessor, under their own
// active appointment, in scope, and not the person -- and pins the criteria, the content and the evidence reviewed.

const PATH = "/api/hq/competency-assessment";
const label = "block text-[12.5px] font-semibold text-gray-700";

export function DecisionForm({ requestId, content, levels, evidence, idPrefix, requestTargetLevelId = null, componentLabels = {} }: {
  requestId: string; content: MethodContent; levels: ScaleLevel[]; evidence: { id: string; label: string }[]; idPrefix: string;
  /** 680: the level the request asked about, the target for a non-verified outcome, and the components' names. */
  requestTargetLevelId?: string | null; componentLabels?: Record<string, string>;
}) {
  const [outcomeCode, setOutcome] = useState("");
  const [levelId, setLevel] = useState("");
  const [rationale, setRationale] = useState("");
  const [crit, setCrit] = useState<Record<string, string>>({});
  const [check, setCheck] = useState<Record<string, string>>({});
  const [reviewed, setReviewed] = useState<string[]>([]);
  const [comp, setComp] = useState<Record<string, string>>({});
  const { busy, msg, send } = useSend(PATH);
  const outcome = content.outcomes.find(o => o.code === outcomeCode);
  const offered = content.levelIds.length ? levels.filter(l => content.levelIds.includes(l.id)) : levels;
  const p = idPrefix;
  const components = content.components ?? [];
  const componentResults = components.map(k => ({ code: k.code, levelId: comp[k.code] || null }));
  // The same rule the database applies on insert (680), shown before the decision is sent. The database's is the record.
  const preview = consolidatedOutcome(content, componentResults, levels, (outcome?.class === "verified" ? levelId || null : null) ?? requestTargetLevelId);
  const nameOf = (code: string) => componentLabels[code] ?? code;
  return (
    <div className="space-y-4">
      {components.length > 0 && (
        <fieldset className="space-y-2">
          <legend className={label}>Components (CCHU): the level reached in each</legend>
          {components.map(k => (
            <div key={k.code} className="flex flex-wrap items-center gap-3">
              <label htmlFor={`${p}-cc-${k.code}`} className="min-w-[14rem] flex-1 text-[13px] text-gray-800">
                {nameOf(k.code)}{k.safetyCritical ? " (safety-critical)" : k.mandatory ? " (mandatory)" : " (optional)"}
                {k.passLevelId ? ` · pass ${levels.find(l => l.id === k.passLevelId)?.score ?? "?"}` : " · pass: the level verified"}
              </label>
              <select id={`${p}-cc-${k.code}`} value={comp[k.code] ?? ""} onChange={e => setComp(x => ({ ...x, [k.code]: e.target.value }))} className={input}>
                <option value="">Not assessed</option>{levels.map(l => <option key={l.id} value={l.id}>{l.score} · {l.label}</option>)}
              </select>
            </div>
          ))}
          {preview && (
            <p role="status" className={`text-[12.5px] font-semibold ${preview.status === "achieved" ? "text-[var(--cmp-text-success)]" : "text-[var(--cmp-text-critical)]"}`}>
              {COMPONENT_STATUS_LABEL[preview.status]}{preview.overall !== null ? ` · weighted level ${preview.overall}` : ""}
              {preview.reasons.length ? ` · ${preview.reasons.join(" ")}` : ""}
              {outcome?.class === "verified" && preview.status !== "achieved" ? " A verified outcome cannot be recorded." : ""}
            </p>
          )}
        </fieldset>
      )}
      {content.criteria.length > 0 && (
        <fieldset className="space-y-2">
          <legend className={label}>Criteria</legend>
          {content.criteria.map(c => (
            <div key={c.id} role="radiogroup" aria-labelledby={`${p}-c-${c.id}`} className="flex flex-wrap items-center gap-3">
              <span id={`${p}-c-${c.id}`} className="min-w-[14rem] flex-1 text-[13px] text-gray-800">{c.text}{c.required ? "" : " (optional)"}{c.component ? <span className="text-gray-500"> · {nameOf(c.component)}</span> : null}</span>
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
            <select id={`${p}-l`} value={levelId} onChange={e => setLevel(e.target.value)} className={`${input} w-full`}><option value="">Choose…</option>{offered.map(l => <option key={l.id} value={l.id}>{l.score} · {l.label}</option>)}</select></div>
        )}
      </div>
      <div><label htmlFor={`${p}-r`} className={label}>Reasons for the outcome: what you observed or reviewed (the person sees this)</label>
        <textarea id={`${p}-r`} rows={4} maxLength={4000} value={rationale} onChange={e => setRationale(e.target.value)} className={`${input} w-full`} /></div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={busy || !outcomeCode} className={primary} onClick={() => void send({
          action: "decide", requestId, outcomeCode, levelId: levelId || null, rationale,
          criteria: Object.entries(crit).map(([id, result]) => ({ id, result })), checklist: Object.entries(check).map(([id, result]) => ({ id, result })), evidenceReviewed: reviewed,
          ...(components.length ? { componentResults } : {}),
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

/**
 * 680: an assessor observation or exam result, recorded by you as the assigned assessor under the method version of the
 * request. The database refuses it on your own request, outside your appointment or scope, or once the request is decided.
 */
export function AssessorEvidenceForm({ requestId, idPrefix, components }: { requestId: string; idPrefix: string; components: { code: string; label: string }[] }) {
  const [kind, setKind] = useState<"assessor_observation" | "exam_result">("assessor_observation");
  const [f, setF] = useState<Record<string, string>>({});
  const { busy, msg, send } = useSend(PATH);
  const p = idPrefix;
  const field = (k: string, text: string, props: InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div><label htmlFor={`${p}-${k}`} className={label}>{text}</label>
      <input id={`${p}-${k}`} value={f[k] ?? ""} onChange={e => setF(x => ({ ...x, [k]: e.target.value }))} className={`${input} w-full`} {...props} /></div>
  );
  return (
    <details className="rounded-lg border border-gray-200 p-3">
      <summary className="cursor-pointer text-[13px] font-semibold text-teal-800">Record an observation or exam result</summary>
      <div className="mt-3 space-y-3">
        <fieldset className="flex flex-wrap gap-4">
          <legend className={label}>What you are recording</legend>
          {(["assessor_observation", "exam_result"] as const).map(k => (
            <label key={k} htmlFor={`${p}-k-${k}`} className="flex items-center gap-2 text-[13px] text-gray-800">
              <input id={`${p}-k-${k}`} type="radio" name={`${p}-k`} checked={kind === k} onChange={() => setKind(k)} />{k === "assessor_observation" ? "An observation" : "An exam result"}
            </label>
          ))}
        </fieldset>
        {kind === "assessor_observation" ? (
          <div className="grid gap-3 md:grid-cols-2">
            <div className="md:col-span-2"><label htmlFor={`${p}-summary`} className={label}>What you observed (the person sees this)</label>
              <textarea id={`${p}-summary`} rows={3} maxLength={4000} value={f.summary ?? ""} onChange={e => setF(x => ({ ...x, summary: e.target.value }))} className={`${input} w-full`} /></div>
            {field("observedOn", "Day observed", { type: "date" })}
            {field("setting", "Setting (optional)", { maxLength: 200 })}
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-3">
            <div className="md:col-span-3">{field("title", "Examination", { maxLength: 200 })}</div>
            {field("score", "Score", { type: "number", min: 0, step: "any" })}
            {field("maxScore", "Maximum score", { type: "number", min: 0, step: "any" })}
            {field("passMark", "Pass mark (optional)", { type: "number", min: 0, step: "any" })}
            {field("takenOn", "Day taken", { type: "date" })}
          </div>
        )}
        {components.length > 0 && (
          <div><label htmlFor={`${p}-component`} className={label}>Component it evidences (optional)</label>
            <select id={`${p}-component`} value={f.component ?? ""} onChange={e => setF(x => ({ ...x, component: e.target.value }))} className={input}>
              <option value="">None</option>{components.map(k => <option key={k.code} value={k.code}>{k.label}</option>)}
            </select></div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" disabled={busy} className={primary} onClick={() => void send({ action: "record_evidence", requestId, kind, ...f, component: f.component || undefined },
            "Recorded with this request, against its method version. It is kept as history.")}>Record</button>
          <Message msg={msg} />
        </div>
      </div>
    </details>
  );
}
