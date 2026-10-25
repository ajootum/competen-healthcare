"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  METHOD_KINDS, METHOD_KIND_LABEL, OUTCOME_CLASSES, OUTCOME_CLASS_LABEL, STARTER_OUTCOMES, EVIDENCE_KINDS, EVIDENCE_KIND_LABEL,
  type MethodContent, type Outcome, type Criterion, type ChecklistItem,
} from "@/lib/competency/verification-config";

// The write half of /super-admin/verification-studio (migration 510). Every control posts to
// /api/hq/competency-verification, which re-checks hq.competency.verification.manage, and 510's triggers decide every
// write: an active appointment, never the assessor scoping themselves, and published criteria that never change.

const btn = "inline-flex items-center justify-center rounded-lg px-3 py-1.5 text-[13px] font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 disabled:opacity-50 pointer-coarse:min-h-[var(--cmp-touch-min)]";
export const primary = `${btn} bg-teal-700 text-white hover:bg-teal-800`;
export const ghost = `${btn} border border-gray-300 bg-white text-gray-800 hover:bg-gray-50`;
export const input = "rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-[13px] text-gray-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700 pointer-coarse:min-h-[var(--cmp-touch-min)]";
const label = "block text-[12.5px] font-semibold text-gray-700";

export function useSend(path: string) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function send(body: Record<string, unknown>, done: string): Promise<Record<string, unknown> | null> {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg({ ok: false, text: j?.error ?? "That could not be saved. Nothing has changed." }); return null; }
      setMsg({ ok: true, text: done });
      router.refresh();
      return j;
    } catch { setMsg({ ok: false, text: "That could not be saved. Check your connection." }); return null; } finally { setBusy(false); }
  }
  return { busy, msg, send };
}

export function Message({ msg }: { msg: { ok: boolean; text: string } | null }) {
  if (!msg) return null;
  return <p role={msg.ok ? "status" : "alert"} className={`text-[12.5px] ${msg.ok ? "text-[var(--cmp-text-success)]" : "text-[var(--cmp-text-critical)]"}`}>{msg.text}</p>;
}

const PATH = "/api/hq/competency-verification";

export function NewMethod() {
  const [code, setCode] = useState(""); const [name, setName] = useState(""); const [kind, setKind] = useState<string>("direct_observation");
  const { busy, msg, send } = useSend(PATH);
  return (
    <form className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end" onSubmit={e => { e.preventDefault(); void send({ action: "create_method", code, name, kind }, "Method created with an empty draft. Fill in its criteria below."); }}>
      <div><label htmlFor="nm-name" className={label}>Method name</label><input id="nm-name" required minLength={3} maxLength={160} value={name} onChange={e => setName(e.target.value)} className={`${input} w-full`} placeholder="e.g. ECG interpretation, observed" /></div>
      <div><label htmlFor="nm-code" className={label}>Code</label><input id="nm-code" required pattern="[a-z][a-z0-9_]{2,60}" value={code} onChange={e => setCode(e.target.value.toLowerCase())} className={`${input} w-full font-mono`} placeholder="ecg_direct_observation" /></div>
      <div><label htmlFor="nm-kind" className={label}>Kind of method</label>
        <select id="nm-kind" value={kind} onChange={e => setKind(e.target.value)} className={`${input} w-full`}>{METHOD_KINDS.map(k => <option key={k} value={k}>{METHOD_KIND_LABEL[k]}</option>)}</select></div>
      <button type="submit" disabled={busy} className={primary}>Create method</button>
      <div className="sm:col-span-4"><Message msg={msg} /></div>
    </form>
  );
}

type Option = { id: string; label: string };
export type EditorOptions = { frameworks: Option[]; competencies: Option[]; professions: Option[]; specialties: Option[]; scales: (Option & { levels: Option[] })[] };

function MultiPick({ id, title, options, value, onChange }: { id: string; title: string; options: Option[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <fieldset className="min-w-0">
      <legend className={label}>{title} <span className="font-normal text-gray-500">(none chosen: any)</span></legend>
      <div className="mt-1 max-h-40 overflow-y-auto rounded-lg border border-gray-200 bg-white p-2">
        {options.length === 0 ? <p className="text-[12.5px] text-gray-500">None available.</p> : options.map(o => (
          <label key={o.id} htmlFor={`${id}-${o.id}`} className="flex items-start gap-2 py-0.5 text-[13px] text-gray-800">
            <input id={`${id}-${o.id}`} type="checkbox" checked={value.includes(o.id)} onChange={e => onChange(e.target.checked ? [...value, o.id] : value.filter(x => x !== o.id))} className="mt-0.5" />{o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** The no-code editor of one DRAFT version. Saving checks the form; publishing makes the criteria fixed. */
export function MethodEditor({ versionId, initial, options, idPrefix }: { versionId: string; initial: MethodContent; options: EditorOptions; idPrefix: string }) {
  const [c, setC] = useState<MethodContent>({ ...initial, outcomes: initial.outcomes?.length ? initial.outcomes : STARTER_OUTCOMES });
  const [problems, setProblems] = useState<string[] | null>(null);
  const { busy, msg, send } = useSend(PATH);
  const set = <K extends keyof MethodContent>(k: K, v: MethodContent[K]) => setC(x => ({ ...x, [k]: v }));
  const scale = options.scales.find(s => s.id === c.scaleId);
  const p = idPrefix;

  const listEditor = <T extends Criterion | ChecklistItem>(title: string, key: "criteria" | "checklist", flag: "required" | "critical", flagLabel: string) => (
    <fieldset className="space-y-2">
      <legend className={label}>{title}</legend>
      {(c[key] as T[]).map((it, i) => (
        <div key={i} className="grid gap-2 sm:grid-cols-[8rem_1fr_auto_auto] sm:items-center">
          <label htmlFor={`${p}-${key}-${i}-id`} className="sr-only">Id</label>
          <input id={`${p}-${key}-${i}-id`} value={it.id} onChange={e => set(key, (c[key] as T[]).map((x, j) => (j === i ? { ...x, id: e.target.value.toLowerCase() } : x)) as never)} className={`${input} font-mono`} placeholder="id" />
          <label htmlFor={`${p}-${key}-${i}-t`} className="sr-only">Words</label>
          <input id={`${p}-${key}-${i}-t`} value={it.text} onChange={e => set(key, (c[key] as T[]).map((x, j) => (j === i ? { ...x, text: e.target.value } : x)) as never)} className={input} placeholder="What the assessor decides" />
          <label htmlFor={`${p}-${key}-${i}-f`} className="flex items-center gap-1.5 text-[12.5px] text-gray-700">
            <input id={`${p}-${key}-${i}-f`} type="checkbox" checked={(it as Record<string, unknown>)[flag] === true} onChange={e => set(key, (c[key] as T[]).map((x, j) => (j === i ? { ...x, [flag]: e.target.checked } : x)) as never)} />{flagLabel}
          </label>
          <button type="button" className={ghost} onClick={() => set(key, (c[key] as T[]).filter((_, j) => j !== i) as never)}>Remove</button>
        </div>
      ))}
      <button type="button" className={ghost} onClick={() => set(key, [...(c[key] as T[]), { id: `${key === "criteria" ? "c" : "k"}${(c[key] as T[]).length + 1}`, text: "", [flag]: flag === "required" }] as never)}>Add {key === "criteria" ? "a criterion" : "a checklist item"}</button>
    </fieldset>
  );

  return (
    <div className="space-y-5">
      <div><label htmlFor={`${p}-sum`} className={label}>What this method is, and when it is used</label>
        <textarea id={`${p}-sum`} rows={2} maxLength={2000} value={c.summary} onChange={e => set("summary", e.target.value)} className={`${input} w-full`} /></div>

      <div className="grid gap-4 md:grid-cols-2">
        <MultiPick id={`${p}-fw`} title="Frameworks it applies to" options={options.frameworks} value={c.applicability.frameworkIds} onChange={v => set("applicability", { ...c.applicability, frameworkIds: v })} />
        <MultiPick id={`${p}-comp`} title="Competencies it applies to" options={options.competencies} value={c.applicability.competencyIds} onChange={v => set("applicability", { ...c.applicability, competencyIds: v })} />
        <MultiPick id={`${p}-prof`} title="Professions" options={options.professions} value={c.applicability.professionTermIds} onChange={v => set("applicability", { ...c.applicability, professionTermIds: v })} />
        <MultiPick id={`${p}-spec`} title="Specialties" options={options.specialties} value={c.applicability.specialtyTermIds} onChange={v => set("applicability", { ...c.applicability, specialtyTermIds: v })} />
      </div>
      <div><label htmlFor={`${p}-ctx`} className={label}>Verification contexts (comma separated, lower-case codes)</label>
        <input id={`${p}-ctx`} value={c.applicability.contexts.join(", ")} onChange={e => set("applicability", { ...c.applicability, contexts: e.target.value.split(",").map(s => s.trim().toLowerCase()).filter(Boolean) })} className={`${input} w-full font-mono`} placeholder="independent" /></div>

      <div className="grid gap-4 md:grid-cols-2">
        <div><label htmlFor={`${p}-scale`} className={label}>Proficiency scale (CFCA)</label>
          <select id={`${p}-scale`} value={c.scaleId ?? ""} onChange={e => setC(x => ({ ...x, scaleId: e.target.value || null, levelIds: [] }))} className={`${input} w-full`}>
            <option value="">No scale: this method does not verify at a level</option>
            {options.scales.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select></div>
        {scale && <MultiPick id={`${p}-lv`} title="Levels it can verify" options={scale.levels} value={c.levelIds} onChange={v => set("levelIds", v)} />}
      </div>

      <fieldset className="space-y-2">
        <legend className={label}>Outcomes the assessor may record</legend>
        <p className="text-[12.5px] text-gray-600">Each outcome is of one fixed kind. Name it in your own words: what this assessment found, never that a person is or is not competent.</p>
        {c.outcomes.map((o, i) => (
          <div key={i} className="grid gap-2 sm:grid-cols-[9rem_14rem_1fr_auto] sm:items-center">
            <label htmlFor={`${p}-o-${i}-c`} className="sr-only">Code</label>
            <input id={`${p}-o-${i}-c`} value={o.code} onChange={e => set("outcomes", c.outcomes.map((x, j) => (j === i ? { ...x, code: e.target.value.toLowerCase() } : x)))} className={`${input} font-mono`} />
            <label htmlFor={`${p}-o-${i}-k`} className="sr-only">Kind</label>
            <select id={`${p}-o-${i}-k`} value={o.class} onChange={e => set("outcomes", c.outcomes.map((x, j) => (j === i ? { ...x, class: e.target.value as Outcome["class"] } : x)))} className={input}>
              {OUTCOME_CLASSES.map(k => <option key={k} value={k}>{OUTCOME_CLASS_LABEL[k]}</option>)}
            </select>
            <label htmlFor={`${p}-o-${i}-l`} className="sr-only">Label</label>
            <input id={`${p}-o-${i}-l`} value={o.label} onChange={e => set("outcomes", c.outcomes.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} className={input} />
            <button type="button" className={ghost} onClick={() => set("outcomes", c.outcomes.filter((_, j) => j !== i))}>Remove</button>
          </div>
        ))}
        <button type="button" className={ghost} onClick={() => set("outcomes", [...c.outcomes, { code: `outcome_${c.outcomes.length + 1}`, class: "unable_to_determine", label: "" }])}>Add an outcome</button>
      </fieldset>

      {listEditor<Criterion>("Assessment criteria (the rubric)", "criteria", "required", "Required")}
      {listEditor<ChecklistItem>("Assessment checklist", "checklist", "critical", "Critical")}

      <fieldset className="space-y-2">
        <legend className={label}>Evidence required</legend>
        {c.requiredEvidence.map((r, i) => (
          <div key={i} className="grid gap-2 sm:grid-cols-[14rem_6rem_1fr_auto] sm:items-center">
            <label htmlFor={`${p}-re-${i}-k`} className="sr-only">Kind</label>
            <select id={`${p}-re-${i}-k`} value={r.kind} onChange={e => set("requiredEvidence", c.requiredEvidence.map((x, j) => (j === i ? { ...x, kind: e.target.value as never } : x)))} className={input}>
              <option value="any">Any of the person&apos;s records</option>{EVIDENCE_KINDS.map(k => <option key={k} value={k}>{EVIDENCE_KIND_LABEL[k]}</option>)}
            </select>
            <label htmlFor={`${p}-re-${i}-m`} className="sr-only">At least</label>
            <input id={`${p}-re-${i}-m`} type="number" min={1} max={20} value={r.min} onChange={e => set("requiredEvidence", c.requiredEvidence.map((x, j) => (j === i ? { ...x, min: Number(e.target.value) } : x)))} className={input} />
            <label htmlFor={`${p}-re-${i}-d`} className="sr-only">Description</label>
            <input id={`${p}-re-${i}-d`} value={r.description} onChange={e => set("requiredEvidence", c.requiredEvidence.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} className={input} placeholder="What it should show" />
            <button type="button" className={ghost} onClick={() => set("requiredEvidence", c.requiredEvidence.filter((_, j) => j !== i))}>Remove</button>
          </div>
        ))}
        <button type="button" className={ghost} onClick={() => set("requiredEvidence", [...c.requiredEvidence, { kind: "any", min: 1, description: "" }])}>Add an evidence requirement</button>
        <div className="flex flex-wrap items-center gap-2"><label htmlFor={`${p}-min`} className={label}>At least this many evidence items reviewed for a verified or partial outcome</label>
          <input id={`${p}-min`} type="number" min={0} max={50} value={c.minEvidence} onChange={e => set("minEvidence", Number(e.target.value))} className={`${input} w-20`} /></div>
      </fieldset>

      <div><label htmlFor={`${p}-guide`} className={label}>Decision guidance for the assessor</label>
        <textarea id={`${p}-guide`} rows={3} maxLength={4000} value={c.decisionGuidance} onChange={e => set("decisionGuidance", e.target.value)} className={`${input} w-full`} /></div>

      <div className="grid gap-4 md:grid-cols-3">
        <fieldset><legend className={label}>Who assigns a request</legend>
          {(["administrator", "self_claim"] as const).map(v => (
            <label key={v} htmlFor={`${p}-as-${v}`} className="flex items-center gap-2 text-[13px] text-gray-800"><input id={`${p}-as-${v}`} type="radio" name={`${p}-as`} checked={c.workflow.assignment === v} onChange={() => set("workflow", { ...c.workflow, assignment: v })} />{v === "administrator" ? "An administrator assigns it" : "An assessor in scope may claim it"}</label>
          ))}
          <label htmlFor={`${p}-fe`} className="mt-1 flex items-center gap-2 text-[13px] text-gray-800"><input id={`${p}-fe`} type="checkbox" checked={c.workflow.allowFurtherEvidence} onChange={e => set("workflow", { ...c.workflow, allowFurtherEvidence: e.target.checked })} />The assessor may ask for further evidence</label>
        </fieldset>
        <div><label htmlFor={`${p}-val`} className={label}>A verified or partial outcome is valid for (months, blank: no expiry)</label>
          <input id={`${p}-val`} type="number" min={1} max={240} value={c.validity.months ?? ""} onChange={e => set("validity", { ...c.validity, months: e.target.value ? Number(e.target.value) : null })} className={`${input} w-24`} />
          <label htmlFor={`${p}-ren`} className={`${label} mt-2`}>Renewal</label>
          <select id={`${p}-ren`} value={c.validity.renewal ?? ""} onChange={e => set("validity", { ...c.validity, renewal: (e.target.value || null) as MethodContent["validity"]["renewal"] })} className={input}>
            <option value="">Not set</option><option value="reassessment">By reassessment</option><option value="evidence_review">By review of current evidence</option>
          </select></div>
        <div><label htmlFor={`${p}-wait`} className={label}>After an outcome that is not verified, reassessment after (days, blank: any time)</label>
          <input id={`${p}-wait`} type="number" min={0} max={3650} value={c.reassessment.waitDays ?? ""} onChange={e => set("reassessment", { waitDays: e.target.value ? Number(e.target.value) : null })} className={`${input} w-24`} /></div>
      </div>

      {problems && problems.length > 0 && <ul className="list-disc pl-5 text-[12.5px] text-amber-900">{problems.map(x => <li key={x}>{x}</li>)}</ul>}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={busy} className={ghost} onClick={async () => { const j = await send({ action: "save_draft", versionId, content: c }, "Draft saved."); if (j) setProblems((j.problems as string[]) ?? []); }}>Save draft</button>
        <button type="button" disabled={busy} className={primary} onClick={async () => { const j = await send({ action: "save_draft", versionId, content: c }, "Draft saved."); if (j) await send({ action: "publish", versionId }, "Published. These criteria are now fixed for every decision made under this version."); }}>Save and publish</button>
        <Message msg={msg} />
      </div>
    </div>
  );
}

export function VersionAction({ action, body, label: text, done, confirm }: { action: string; body: Record<string, string>; label: string; done: string; confirm?: string }) {
  const { busy, msg, send } = useSend(PATH);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button type="button" disabled={busy} className={ghost} onClick={() => { if (!confirm || window.confirm(confirm)) void send({ action, ...body }, done); }}>{text}</button>
      <Message msg={msg} />
    </span>
  );
}

export function GrantScope({ appointmentId, options, idPrefix }: { appointmentId: string; options: { kind: string; ref: string; label: string }[]; idPrefix: string }) {
  const [pick, setPick] = useState(""); const [context, setContext] = useState(""); const [until, setUntil] = useState(""); const [reason, setReason] = useState("");
  const { busy, msg, send } = useSend(PATH);
  const [kind, ref] = pick.split("|");
  return (
    <div className="grid gap-2 md:grid-cols-[1fr_9rem_9rem_1fr_auto] md:items-end">
      <div><label htmlFor={`${idPrefix}-k`} className={label}>Scope</label>
        <select id={`${idPrefix}-k`} value={pick} onChange={e => setPick(e.target.value)} className={`${input} w-full`}>
          <option value="">Choose…</option>{options.map(o => <option key={`${o.kind}|${o.ref}`} value={`${o.kind}|${o.ref}`}>{o.label}</option>)}<option value="context|">A verification context (narrows)</option>
        </select></div>
      <div><label htmlFor={`${idPrefix}-v`} className={label}>Context code</label>
        <input id={`${idPrefix}-v`} disabled={kind !== "context"} value={context} onChange={e => setContext(e.target.value.toLowerCase())} className={`${input} w-full font-mono`} placeholder="independent" /></div>
      <div><label htmlFor={`${idPrefix}-u`} className={label}>Valid until</label>
        <input id={`${idPrefix}-u`} type="date" value={until} onChange={e => setUntil(e.target.value)} className={`${input} w-full`} /></div>
      <div><label htmlFor={`${idPrefix}-r`} className={label}>Why this scope</label>
        <input id={`${idPrefix}-r`} value={reason} onChange={e => setReason(e.target.value)} maxLength={500} className={`${input} w-full`} /></div>
      <button type="button" disabled={busy || !pick || reason.trim().length < 3} className={primary}
        onClick={() => void send({ action: "grant_scope", appointmentId, kind, ref: ref || null, value: kind === "context" ? context : null, validUntil: until || null, reason }, "Scope granted.")}>Grant</button>
      <div className="md:col-span-5"><Message msg={msg} /></div>
    </div>
  );
}

export function ReasonAction({ action, body, label: text, done, idPrefix, reasonLabel }: { action: string; body: Record<string, string>; label: string; done: string; idPrefix: string; reasonLabel: string }) {
  const [reason, setReason] = useState("");
  const { busy, msg, send } = useSend(PATH);
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div><label htmlFor={`${idPrefix}-r`} className={label}>{reasonLabel}</label>
        <input id={`${idPrefix}-r`} value={reason} onChange={e => setReason(e.target.value)} maxLength={1000} className={`${input} w-72`} /></div>
      <button type="button" disabled={busy || reason.trim().length < 3} className={ghost} onClick={() => void send({ action, ...body, reason }, done)}>{text}</button>
      <Message msg={msg} />
    </div>
  );
}

export function Assign({ requestId, assessors, idPrefix }: { requestId: string; assessors: { appointmentId: string; label: string }[]; idPrefix: string }) {
  const [pick, setPick] = useState("");
  const { busy, msg, send } = useSend(PATH);
  if (!assessors.length) return <p className="text-[12.5px] text-gray-600">No assessor appointment is active. The owner appoints Competency Assessors; you then scope them here.</p>;
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div><label htmlFor={`${idPrefix}-a`} className={label}>Assign to</label>
        <select id={`${idPrefix}-a`} value={pick} onChange={e => setPick(e.target.value)} className={input}><option value="">Choose an assessor…</option>{assessors.map(a => <option key={a.appointmentId} value={a.appointmentId}>{a.label}</option>)}</select></div>
      <button type="button" disabled={busy || !pick} className={primary} onClick={() => void send({ action: "assign", requestId, appointmentId: pick }, "Assigned. The database checked the assessor's appointment and scope.")}>Assign</button>
      <Message msg={msg} />
    </div>
  );
}
