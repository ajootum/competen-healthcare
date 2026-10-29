"use client";

import { useCallback, useEffect, useRef, useState, type InputHTMLAttributes } from "react";
import { COMPONENT_STATUS_LABEL, OUTCOME_CLASS_LABEL, consolidatedOutcome, type DecisionDraft, type MethodContent, type ScaleLevel } from "@/lib/competency/verification-config";
import { Message, ghost, input, primary, useSend } from "../../verification-studio/_components/StudioControls";

// The write half of /super-admin/competency-assessment (migration 510). Posts to /api/hq/competency-assessment, gated by
// hq.competency.verification.assess. 510 refuses the decision unless this is the assigned assessor, under their own
// active appointment, in scope, and not the person -- and pins the criteria, the content and the evidence reviewed.
// 690 adds the working draft (kept on the server, so a tablet and a desk show the same form) and the second assessor's confirmation.

const PATH = "/api/hq/competency-assessment";
const label = "block text-[12.5px] font-semibold text-gray-700";
// CPR-MOB-001: a choice is a whole labelled row at a touch pointer (>= touch-min tall, full width), a plain inline radio at a mouse.
const choice = "flex items-center gap-1 text-[12.5px] text-gray-700 pointer-coarse:min-h-[var(--cmp-touch-min)] pointer-coarse:basis-full pointer-coarse:gap-3 pointer-coarse:rounded-lg pointer-coarse:border pointer-coarse:border-gray-300 pointer-coarse:bg-white pointer-coarse:px-3 pointer-coarse:text-[13px] pointer-coarse:has-[:checked]:border-teal-700 pointer-coarse:has-[:checked]:bg-teal-50";
const tick = "pointer-coarse:h-5 pointer-coarse:w-5 pointer-coarse:shrink-0";
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

type DraftState = { status: "idle" | "saving" | "saved" | "error"; at?: string; error?: string };

export function DecisionForm({ requestId, content, levels, evidence, idPrefix, requestTargetLevelId = null, componentLabels = {}, draft = null }: {
  requestId: string; content: MethodContent; levels: ScaleLevel[]; evidence: { id: string; label: string }[]; idPrefix: string;
  /** 680: the level the request asked about, the target for a non-verified outcome, and the components' names. */
  requestTargetLevelId?: string | null; componentLabels?: Record<string, string>;
  /** 690: the working draft this assessor left on the server, if any. The form starts from it. */
  draft?: { content: DecisionDraft; updatedAt: string } | null;
}) {
  // A draft is only what the form was, so anything in it that this method version no longer offers is dropped.
  const d0 = draft?.content;
  const [outcomeCode, setOutcome] = useState(() => (d0?.outcomeCode && content.outcomes.some(o => o.code === d0.outcomeCode) ? d0.outcomeCode : ""));
  const [levelId, setLevel] = useState(() => (d0?.levelId && levels.some(l => l.id === d0.levelId) ? d0.levelId : ""));
  const [rationale, setRationale] = useState(d0?.rationale ?? "");
  const [crit, setCrit] = useState<Record<string, string>>(() => Object.fromEntries((d0?.criteria ?? []).filter(x => content.criteria.some(c => c.id === x.id) && ["met", "not_met", "not_applicable"].includes(x.result)).map(x => [x.id, x.result])));
  const [check, setCheck] = useState<Record<string, string>>(() => Object.fromEntries((d0?.checklist ?? []).filter(x => content.checklist.some(c => c.id === x.id) && ["done", "not_done"].includes(x.result)).map(x => [x.id, x.result])));
  const [reviewed, setReviewed] = useState<string[]>(() => (d0?.evidenceReviewed ?? []).filter(id => evidence.some(e => e.id === id)));
  const [comp, setComp] = useState<Record<string, string>>(() => Object.fromEntries((d0?.componentResults ?? []).filter(x => x.levelId && (content.components ?? []).some(k => k.code === x.code)).map(x => [x.code, x.levelId as string])));
  const { busy, msg, send } = useSend(PATH);
  const outcome = content.outcomes.find(o => o.code === outcomeCode);
  const offered = content.levelIds.length ? levels.filter(l => content.levelIds.includes(l.id)) : levels;
  const p = idPrefix;
  const components = content.components ?? [];
  const componentResults = components.map(k => ({ code: k.code, levelId: comp[k.code] || null }));

  // ── 690: the working draft. Saved ~1.5 s after the last change and on request; never stands between the assessor and the decision.
  const snapshot = JSON.stringify({
    outcomeCode, levelId: levelId || null, rationale,
    criteria: content.criteria.filter(c => crit[c.id]).map(c => ({ id: c.id, result: crit[c.id] })),
    checklist: content.checklist.filter(c => check[c.id]).map(c => ({ id: c.id, result: check[c.id] })),
    componentResults: components.map(k => ({ code: k.code, levelId: comp[k.code] || null })), evidenceReviewed: reviewed,
  });
  const [ds, setDs] = useState<DraftState>({ status: "idle" });
  const lastSent = useRef(snapshot); // what the server holds already (the draft it resumed from, or the blank form): no write for it
  const decided = useRef(false);
  const seq = useRef(0);
  const saveDraft = useCallback(async (body: string) => {
    const mine = ++seq.current;
    setDs(x => ({ ...x, status: "saving" }));
    try {
      const res = await fetch(PATH, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "save_draft", requestId, draft: JSON.parse(body) }) });
      const j = await res.json().catch(() => ({}));
      if (mine !== seq.current) return;
      if (!res.ok) { setDs({ status: "error", error: j?.error ?? "Your draft could not be saved. You can still record the decision." }); return; }
      lastSent.current = body;
      setDs({ status: "saved", at: typeof j?.savedAt === "string" ? j.savedAt : new Date().toISOString() });
    } catch { if (mine === seq.current) setDs({ status: "error", error: "Your draft could not be saved. Check your connection. You can still record the decision." }); }
  }, [requestId]);
  useEffect(() => {
    if (snapshot === lastSent.current || decided.current) return;
    const t = setTimeout(() => { void saveDraft(snapshot); }, 1500);
    return () => clearTimeout(t);
  }, [snapshot, saveDraft]);

  // The same rule the database applies on insert (680), shown before the decision is sent. The database's is the record.
  const preview = consolidatedOutcome(content, componentResults, levels, (outcome?.class === "verified" ? levelId || null : null) ?? requestTargetLevelId);
  const nameOf = (code: string) => componentLabels[code] ?? code;
  return (
    <div className="space-y-4">
      {draft && <p className="text-[12.5px] text-gray-600">Resumed your draft saved <time dateTime={draft.updatedAt} suppressHydrationWarning>{when(draft.updatedAt)}</time>.</p>}
      {components.length > 0 && (
        <fieldset className="space-y-2">
          <legend className={label}>Components (CCHU): the level reached in each</legend>
          {components.map(k => (
            <div key={k.code} className="flex flex-wrap items-center gap-3">
              <label htmlFor={`${p}-cc-${k.code}`} className="min-w-[14rem] flex-1 text-[13px] text-gray-800">
                {nameOf(k.code)}{k.safetyCritical ? " (safety-critical)" : k.mandatory ? " (mandatory)" : " (optional)"}
                {k.passLevelId ? ` · pass ${levels.find(l => l.id === k.passLevelId)?.score ?? "?"}` : " · pass: the level verified"}
              </label>
              <select id={`${p}-cc-${k.code}`} value={comp[k.code] ?? ""} onChange={e => setComp(x => ({ ...x, [k.code]: e.target.value }))} className={`${input} pointer-coarse:w-full`}>
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
                <label key={r} htmlFor={`${p}-c-${c.id}-${r}`} className={choice}>
                  <input id={`${p}-c-${c.id}-${r}`} type="radio" className={tick} name={`${p}-c-${c.id}`} checked={crit[c.id] === r} onChange={() => setCrit(x => ({ ...x, [c.id]: r }))} />{r === "met" ? "Met" : r === "not_met" ? "Not met" : "Not applicable"}
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
                <label key={r} htmlFor={`${p}-k-${c.id}-${r}`} className={choice}>
                  <input id={`${p}-k-${c.id}-${r}`} type="radio" className={tick} name={`${p}-k-${c.id}`} checked={check[c.id] === r} onChange={() => setCheck(x => ({ ...x, [c.id]: r }))} />{r === "done" ? "Done" : "Not done"}
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
            <label key={e.id} htmlFor={`${p}-e-${e.id}`} className="flex items-start gap-2 text-[13px] text-gray-800 pointer-coarse:mt-1.5 pointer-coarse:min-h-[var(--cmp-touch-min)] pointer-coarse:items-center pointer-coarse:gap-3 pointer-coarse:rounded-lg pointer-coarse:border pointer-coarse:border-gray-300 pointer-coarse:px-3 pointer-coarse:has-[:checked]:border-teal-700 pointer-coarse:has-[:checked]:bg-teal-50">
              <input id={`${p}-e-${e.id}`} type="checkbox" className={`mt-0.5 ${tick}`} checked={reviewed.includes(e.id)} onChange={ev => setReviewed(x => ev.target.checked ? [...x, e.id] : x.filter(y => y !== e.id))} />{e.label}
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
        }, "Decision recorded. It is kept as history with the criteria, the evidence and your appointment.").then(r => { if (r) decided.current = true; })}>Record decision</button>
        <button type="button" disabled={ds.status === "saving"} className={ghost} onClick={() => void saveDraft(snapshot)}>Save draft</button>
        <Message msg={msg} />
      </div>
      <div aria-live="polite" className="min-h-[1.25rem]">
        {ds.status === "saving" && <p className="text-[12.5px] text-gray-600">Saving…</p>}
        {ds.status === "saved" && ds.at && <p className="text-[12.5px] text-[var(--cmp-text-success)]">Saved <time dateTime={ds.at} suppressHydrationWarning>{when(ds.at)}</time></p>}
        {ds.status === "error" && <p role="alert" className="text-[12.5px] text-[var(--cmp-text-critical)]">{ds.error}</p>}
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
        <input id={`${idPrefix}-d`} value={reason} onChange={e => setReason(e.target.value)} maxLength={1000} className={`${input} w-72 max-w-full`} /></div>
      <button type="button" disabled={busy || reason.trim().length < 3} className={ghost} onClick={() => void send({ action: "decline", requestId, reason }, "Handed back to the Studio.")}>Hand back</button>
      <Message msg={msg} />
    </div>
  );
}

/**
 * 690: a second assessor confirms, or does not confirm, the first assessor's decision. The database refuses it from the person,
 * from the first assessor, and outside the second assessor's own appointment and scope.
 */
export function ConfirmForm({ requestId, decisionId, appointmentId, idPrefix }: { requestId: string; decisionId: string; appointmentId: string; idPrefix: string }) {
  const [result, setResult] = useState<"" | "confirmed" | "not_confirmed">("");
  const [rationale, setRationale] = useState("");
  const { busy, msg, send } = useSend(PATH);
  const p = idPrefix;
  return (
    <div className="space-y-3">
      <fieldset className="flex flex-wrap gap-3">
        <legend className={label}>Your view of this decision</legend>
        {(["confirmed", "not_confirmed"] as const).map(r => (
          <label key={r} htmlFor={`${p}-${r}`} className={`${choice} gap-2 text-[13px] text-gray-800`}>
            <input id={`${p}-${r}`} type="radio" className={tick} name={`${p}-result`} checked={result === r} onChange={() => setResult(r)} />{r === "confirmed" ? "Confirm" : "Not confirmed"}
          </label>
        ))}
      </fieldset>
      <p className="text-[12.5px] text-gray-600">Not confirmed sets the decision aside and the request is decided again.</p>
      <div><label htmlFor={`${p}-why`} className={label}>Your reasons (at least 10 characters; kept with the decision)</label>
        <textarea id={`${p}-why`} rows={3} maxLength={2000} value={rationale} onChange={e => setRationale(e.target.value)} className={`${input} w-full`} /></div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={busy || !result || rationale.trim().length < 10} className={primary}
          onClick={() => void send({ action: "confirm", requestId, decisionId, appointmentId, result, rationale },
            result === "confirmed" ? "Confirmed. The decision stands." : "Not confirmed. The decision is set aside and the request is decided again.")}>Send my view</button>
        <Message msg={msg} />
      </div>
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
      <summary className="cursor-pointer text-[13px] font-semibold text-teal-800 pointer-coarse:flex pointer-coarse:min-h-[var(--cmp-touch-min)] pointer-coarse:items-center">Record an observation or exam result</summary>
      <div className="mt-3 space-y-3">
        <fieldset className="flex flex-wrap gap-4">
          <legend className={label}>What you are recording</legend>
          {(["assessor_observation", "exam_result"] as const).map(k => (
            <label key={k} htmlFor={`${p}-k-${k}`} className={`${choice} gap-2 text-[13px] text-gray-800`}>
              <input id={`${p}-k-${k}`} type="radio" className={tick} name={`${p}-k`} checked={kind === k} onChange={() => setKind(k)} />{k === "assessor_observation" ? "An observation" : "An exam result"}
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
            <select id={`${p}-component`} value={f.component ?? ""} onChange={e => setF(x => ({ ...x, component: e.target.value }))} className={`${input} pointer-coarse:w-full`}>
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
