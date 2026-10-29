"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  COMPONENT_STATUS_LABEL, METHOD_KINDS, METHOD_KIND_LABEL, OUTCOME_CLASSES, OUTCOME_CLASS_LABEL, STARTER_OUTCOMES, EVIDENCE_KINDS, EVIDENCE_KIND_LABEL,
  isPinned, type MethodContent, type MethodComponent, type Outcome, type Criterion, type ChecklistItem,
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
/** One competency a method can be made from. state = its clinical state (null: could not be read), stateLabel its words. */
export type MethodSource = { id: string; label: string; code: string | null; framework: string; frameworkStatus: string; state: string | null; stateLabel: string };
/** A programme catalogue entry naming a competency, with how many assessment components it configures. */
export type SourceEntry = { id: string; competencyId: string; label: string; components: number };
export type GenerateOptions = { competencies: MethodSource[]; scales: Option[]; defaultScaleId: string; entries: SourceEntry[] };

/** Why a competency cannot be the source of a method yet, in words. Null: it can. */
function sourceRefusal(c: MethodSource | undefined): string | null {
  if (!c) return "Choose a competency first.";
  switch (c.state) {
    case "approved": return null;
    case "in_review": return "Criteria still in clinical review. A method is made only from approved criteria.";
    case "changes_requested": return "A clinical reviewer asked for changes to the criteria. A method is made only from approved criteria.";
    case "stale": return "Criteria changed since their clinical approval, so they need renewed approval.";
    case null: return "The clinical state of these criteria could not be read just now. Try again shortly.";
    default: return "Criteria not yet clinically approved.";
  }
}

/** The code a competency's own code suggests: lower-case letters, digits and underscores, starting with a letter. */
const codeFrom = (raw: string | null) => {
  const c = (raw ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return /^[a-z]/.test(c) && c.length >= 3 ? c.slice(0, 61) : "";
};

/**
 * 690: a method DRAFT made from one competency's criteria exactly as the competency has them. The server refuses unless
 * the competency's current content is clinically approved; this form says so up front rather than after a click. The
 * draft then goes through clinical review and independent publication like any other.
 */
export function GenerateMethod({ options }: { options: GenerateOptions }) {
  const [competencyId, setCompetencyId] = useState("");
  const [code, setCode] = useState(""); const [name, setName] = useState(""); const [kind, setKind] = useState<string>("structured_assessment");
  const [scaleId, setScaleId] = useState(options.defaultScaleId); const [entryId, setEntryId] = useState("");
  const [touched, setTouched] = useState({ code: false, name: false });
  const [made, setMade] = useState<{ methodId: string; problems: string[] } | null>(null);
  const { busy, msg, send } = useSend(PATH);
  const chosen = options.competencies.find(c => c.id === competencyId);
  const entries = options.entries.filter(e => e.competencyId === competencyId);
  const refusal = sourceRefusal(chosen);
  const frameworks = [...new Set(options.competencies.map(c => c.framework))];

  function pick(id: string) {
    setCompetencyId(id); setEntryId("");
    const c = options.competencies.find(x => x.id === id);
    if (c && !touched.code) setCode(codeFrom(c.code));
    if (c && !touched.name) setName(c.label);
  }

  // After the refresh the new draft is on the page: bring it into view and focus it, so it is clear where it went.
  useEffect(() => {
    if (!made) return;
    let tries = 0;
    const t = setInterval(() => {
      const el = document.getElementById(`method-${made.methodId}`);
      if (el) { clearInterval(t); el.scrollIntoView({ block: "start" }); el.focus({ preventScroll: true }); }
      else if (++tries > 20) clearInterval(t);
    }, 250);
    return () => clearInterval(t);
  }, [made]);

  async function submit() {
    setMade(null);
    const j = await send({ action: "generate_method", competencyId, code, name, kind, scaleId: scaleId || undefined, entryId: entryId || undefined },
      "Draft made from the competency criteria. It is opened below: put it forward for clinical review, then another administrator publishes it.");
    if (j && typeof j.methodId === "string") setMade({ methodId: j.methodId, problems: (j.problems as string[]) ?? [] });
  }

  return (
    <form className="grid gap-3 md:grid-cols-2" onSubmit={e => { e.preventDefault(); if (!refusal) void submit(); }}>
      <div className="md:col-span-2"><label htmlFor="gm-comp" className={label}>Competency</label>
        <select id="gm-comp" required value={competencyId} onChange={e => pick(e.target.value)} aria-describedby="gm-comp-note" className={`${input} w-full`}>
          <option value="">Choose a competency…</option>
          {frameworks.map(f => {
            const group = options.competencies.filter(c => c.framework === f);
            return <optgroup key={f} label={`${f}${group[0].frameworkStatus !== "published" ? ` (${group[0].frameworkStatus})` : ""}`}>{group.map(c => <option key={c.id} value={c.id}>{c.label} · {c.stateLabel}</option>)}</optgroup>;
          })}
        </select>
        <p id="gm-comp-note" className={`mt-1 text-[12.5px] ${chosen && !refusal ? "text-[var(--cmp-text-success)]" : "text-gray-600"}`}>
          {chosen ? (refusal ?? "Criteria clinically approved. The method starts from them exactly as the competency has them.") : "Only a competency whose current criteria are clinically approved can be the source of a method."}
        </p></div>
      <div><label htmlFor="gm-name" className={label}>Method name</label>
        <input id="gm-name" required minLength={3} maxLength={160} value={name} onChange={e => { setName(e.target.value); setTouched(t => ({ ...t, name: true })); }} className={`${input} w-full`} /></div>
      <div><label htmlFor="gm-code" className={label}>Code <span className="font-normal text-gray-500">(lower-case letters, digits, underscores)</span></label>
        <input id="gm-code" required pattern="[a-z][a-z0-9_]{2,60}" value={code} onChange={e => { setCode(e.target.value.toLowerCase()); setTouched(t => ({ ...t, code: true })); }} className={`${input} w-full font-mono`} placeholder="ecg_structured_assessment" /></div>
      <div><label htmlFor="gm-kind" className={label}>Kind of method</label>
        <select id="gm-kind" value={kind} onChange={e => setKind(e.target.value)} className={`${input} w-full`}>{METHOD_KINDS.map(k => <option key={k} value={k}>{METHOD_KIND_LABEL[k]}</option>)}</select></div>
      <div><label htmlFor="gm-scale" className={label}>Proficiency scale</label>
        <select id="gm-scale" value={scaleId} onChange={e => setScaleId(e.target.value)} className={`${input} w-full`}>
          <option value="">No scale: this method does not verify at a level</option>{options.scales.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select></div>
      <div className="md:col-span-2"><label htmlFor="gm-entry" className={label}>Programme catalogue entry <span className="font-normal text-gray-500">(optional: prefills the assessment components)</span></label>
        <select id="gm-entry" value={entryId} onChange={e => setEntryId(e.target.value)} disabled={!entries.length} className={`${input} w-full`}>
          <option value="">{competencyId && !entries.length ? "No programme names this competency" : "No programme: components are set in the editor"}</option>
          {entries.map(e => <option key={e.id} value={e.id}>{e.label} · {e.components} component{e.components === 1 ? "" : "s"}</option>)}
        </select></div>
      <div className="flex flex-wrap items-center gap-2 md:col-span-2">
        <button type="submit" disabled={busy || !!refusal} className={primary}>Make the method draft</button>
        <Message msg={msg} />
      </div>
      {made && made.problems.length > 0 && (
        <div className="text-[12.5px] text-amber-900 md:col-span-2">
          <p className="font-semibold">To settle before this draft can be put forward:</p>
          <ul className="list-disc pl-5">{made.problems.map(x => <li key={x}>{x}</li>)}</ul>
        </div>
      )}
    </form>
  );
}

/** components: the active CCHU components of the 660 registry, id = code (680). */
export type EditorOptions = { frameworks: Option[]; competencies: Option[]; professions: Option[]; specialties: Option[]; scales: (Option & { levels: Option[] })[]; components: Option[] };

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

/**
 * The no-code editor of one DRAFT version. Saving checks the form and records you as an editor. Publishing makes the
 * criteria fixed, and (680) is never done by the author or an editor: `mayPublish` false hides the button, and the
 * database refuses it whatever is sent.
 */
export function MethodEditor({ versionId, initial, options, idPrefix, mayPublish = true, reviewApproved = true, reviewLabel = "" }: {
  versionId: string; initial: MethodContent; options: EditorOptions; idPrefix: string; mayPublish?: boolean;
  /** 690: publication needs clinical approval of the exact saved draft (the database refuses otherwise). */
  reviewApproved?: boolean; reviewLabel?: string;
}) {
  const [c, setC] = useState<MethodContent>({ ...initial, components: initial.components ?? [], outcomes: initial.outcomes?.length ? initial.outcomes : STARTER_OUTCOMES });
  const [problems, setProblems] = useState<string[] | null>(null);
  const { busy, msg, send } = useSend(PATH);
  const set = <K extends keyof MethodContent>(k: K, v: MethodContent[K]) => setC(x => ({ ...x, [k]: v }));
  const scale = options.scales.find(s => s.id === c.scaleId);
  const p = idPrefix;
  const canPublish = mayPublish && reviewApproved;
  const componentLabel = (code: string) => options.components.find(o => o.id === code)?.label ?? code;
  // Removing a component clears it from the items that use it, which would change a pinned item's component.
  const pinnedUse = (code: string) => [...c.criteria, ...c.checklist].some(it => isPinned(it) && it.component === code);
  const setComponent = (i: number, patch: Partial<MethodComponent>) => set("components", c.components.map((x, j) => {
    if (j !== i) return x;
    const next = { ...x, ...patch };
    return next.safetyCritical ? { ...next, mandatory: true } : next;
  }));

  const listEditor = <T extends Criterion | ChecklistItem>(title: string, key: "criteria" | "checklist", flag: "required" | "critical", flagLabel: string) => (
    <fieldset className="space-y-2">
      <legend className={label}>{title}</legend>
      {(c[key] as T[]).map((it, i) => {
        // 690: an item pinned to a competency criterion keeps that criterion's words and component, which the database
        // checks on review, publication and every request. Editing them here would break the pin, so they are read-only.
        const pinned = isPinned(it);
        const pinNote = `${p}-${key}-${i}-pin`;
        return (
        <div key={i} className="grid gap-2 sm:grid-cols-[8rem_1fr_11rem_auto_auto] sm:items-center">
          <label htmlFor={`${p}-${key}-${i}-id`} className="sr-only">Id</label>
          <input id={`${p}-${key}-${i}-id`} value={it.id} readOnly={pinned} onChange={e => set(key, (c[key] as T[]).map((x, j) => (j === i ? { ...x, id: e.target.value.toLowerCase() } : x)) as never)} className={`${input} font-mono ${pinned ? "bg-gray-50 text-gray-600" : ""}`} placeholder="id" />
          <label htmlFor={`${p}-${key}-${i}-t`} className="sr-only">Words</label>
          <input id={`${p}-${key}-${i}-t`} value={it.text} readOnly={pinned} aria-describedby={pinned ? pinNote : undefined} onChange={e => set(key, (c[key] as T[]).map((x, j) => (j === i ? { ...x, text: e.target.value } : x)) as never)} className={`${input} ${pinned ? "bg-gray-50 text-gray-700" : ""}`} placeholder="What the assessor decides" />
          <label htmlFor={`${p}-${key}-${i}-cmp`} className="sr-only">Component</label>
          <select id={`${p}-${key}-${i}-cmp`} value={it.component ?? ""} disabled={pinned || !c.components.length} title={pinned ? "Fixed by the competency criteria" : c.components.length ? undefined : "Add a component below first"}
            onChange={e => set(key, (c[key] as T[]).map((x, j) => (j === i ? { ...x, component: e.target.value || null } : x)) as never)} className={input}>
            <option value="">No component</option>
            {it.component && !c.components.some(k => k.code === it.component) && <option value={it.component}>{componentLabel(it.component)}</option>}
            {c.components.map(k => <option key={k.code} value={k.code}>{componentLabel(k.code)}</option>)}
          </select>
          <label htmlFor={`${p}-${key}-${i}-f`} className="flex items-center gap-1.5 text-[12.5px] text-gray-700">
            <input id={`${p}-${key}-${i}-f`} type="checkbox" checked={(it as Record<string, unknown>)[flag] === true} onChange={e => set(key, (c[key] as T[]).map((x, j) => (j === i ? { ...x, [flag]: e.target.checked } : x)) as never)} />{flagLabel}
          </label>
          <button type="button" className={ghost} onClick={() => set(key, (c[key] as T[]).filter((_, j) => j !== i) as never)}>Remove</button>
          {pinned && (
            <p id={pinNote} className="flex flex-wrap items-center gap-2 text-[12.5px] text-gray-600 sm:col-span-5">
              <span className="rounded-full border border-teal-200 bg-teal-50 px-2 py-0.5 text-[11.5px] font-semibold text-teal-900">From the competency criteria</span>
              {it.sourceRef ? <span>Source: {it.sourceRef}</span> : <span>No source reference recorded.</span>}
              <span>Its words and component are fixed. You may still mark it {flagLabel.toLowerCase()}.</span>
            </p>
          )}
        </div>
        );
      })}
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
        <legend className={label}>Assessment components (CCHU)</legend>
        <p className="text-[12.5px] text-gray-600">
          Optional. Each component is scored on the proficiency scale above. A verified outcome needs every mandatory component at its pass level
          (blank: the level verified) and the weighted level at the level verified. A weighted level never overrides a failed safety-critical or mandatory component.
          Pass levels, weights and which components are mandatory are clinical settings: set them as clinically approved.
        </p>
        {c.components.map((k, i) => (
          <div key={k.code} className="grid gap-2 sm:grid-cols-[12rem_12rem_auto_auto_6rem_auto] sm:items-center">
            <span className="text-[13px] font-medium text-gray-900">{componentLabel(k.code)}</span>
            <label htmlFor={`${p}-k-${i}-pass`} className="sr-only">Pass level for {componentLabel(k.code)}</label>
            <select id={`${p}-k-${i}-pass`} value={k.passLevelId ?? ""} onChange={e => setComponent(i, { passLevelId: e.target.value || null })} className={input} disabled={!scale}>
              <option value="">Pass level: the level verified</option>{(scale?.levels ?? []).map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
            </select>
            <label htmlFor={`${p}-k-${i}-m`} className="flex items-center gap-1.5 text-[12.5px] text-gray-700">
              <input id={`${p}-k-${i}-m`} type="checkbox" checked={k.mandatory} disabled={k.safetyCritical} onChange={e => setComponent(i, { mandatory: e.target.checked })} />Mandatory
            </label>
            <label htmlFor={`${p}-k-${i}-s`} className="flex items-center gap-1.5 text-[12.5px] text-gray-700">
              <input id={`${p}-k-${i}-s`} type="checkbox" checked={k.safetyCritical} onChange={e => setComponent(i, { safetyCritical: e.target.checked })} />Safety-critical
            </label>
            <label htmlFor={`${p}-k-${i}-w`} className="sr-only">Weight for {componentLabel(k.code)}</label>
            <input id={`${p}-k-${i}-w`} type="number" min={0.01} max={100} step={0.01} value={k.weight ?? ""} placeholder="weight 1" onChange={e => setComponent(i, { weight: e.target.value ? Number(e.target.value) : null })} className={input} />
            <button type="button" className={ghost} disabled={pinnedUse(k.code)} title={pinnedUse(k.code) ? "A criterion from the competency uses this component, so it stays" : undefined}
              onClick={() => setC(x => ({ ...x, components: x.components.filter((_, j) => j !== i),
              criteria: x.criteria.map(it => (it.component === k.code ? { ...it, component: null } : it)), checklist: x.checklist.map(it => (it.component === k.code ? { ...it, component: null } : it)) }))}>Remove</button>
          </div>
        ))}
        {options.components.filter(o => !c.components.some(k => k.code === o.id)).length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor={`${p}-k-add`} className="sr-only">Add a component</label>
            <select id={`${p}-k-add`} value="" onChange={e => { if (e.target.value) set("components", [...c.components, { code: e.target.value, passLevelId: null, mandatory: true, safetyCritical: false, weight: null }]); }} className={input}>
              <option value="">Add a component…</option>{options.components.filter(o => !c.components.some(k => k.code === o.id)).map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          </div>
        )}
      </fieldset>

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
          <label htmlFor={`${p}-sa`} className="mt-1 flex items-center gap-2 text-[13px] text-gray-800"><input id={`${p}-sa`} type="checkbox" checked={c.workflow.secondAssessor === true} aria-describedby={`${p}-sa-note`} onChange={e => set("workflow", { ...c.workflow, secondAssessor: e.target.checked })} />Second assessor required</label>
          <p id={`${p}-sa-note`} className="text-[12.5px] text-gray-600">A verified or partial outcome then stands only once a second appointed assessor confirms it.</p>
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
        <button type="button" disabled={busy} className={ghost} onClick={async () => { const j = await send({ action: "save_draft", versionId, content: c }, "Draft saved. You are recorded as an editor, so another administrator publishes it."); if (j) setProblems((j.problems as string[]) ?? []); }}>Save draft</button>
        <button type="button" disabled={busy || !canPublish} aria-describedby={`${p}-pub-note`} className={primary} onClick={() => void send({ action: "publish", versionId }, "Published as saved. These criteria are now fixed for every decision made under this version.")}>Publish the saved draft</button>
        <Message msg={msg} />
      </div>
      <p id={`${p}-pub-note`} className="text-[12.5px] text-gray-600">
        {mayPublish
          ? "Publishing publishes the draft as last saved, not unsaved changes on this page. Saving a change makes you an editor, and an editor never publishes."
          : "You created or edited this version, so another administrator reviews and publishes it."}
        {!reviewApproved && ` It also needs clinical approval of the saved draft (now: ${reviewLabel || "not approved"}), so publishing is not available yet.`}
      </p>
    </div>
  );
}

/**
 * 680: a decision's component results and the consolidated outcome the DATABASE computed and stored. Nothing is
 * recomputed here. Not assessed is said in words, never shown as a zero.
 */
export function DecisionComponents({ results, outcome, labels }: {
  results: { code: string; score: number | null; label: string | null; note: string | null }[];
  outcome: { status: "achieved" | "not_achieved" | "incomplete"; overall: number | null; target: number | null; failedMandatory: string[]; failedSafetyCritical: string[]; missingMandatory: string[] } | null;
  labels: Record<string, string>;
}) {
  if (!outcome) return null;
  const name = (c: string) => labels[c] ?? c;
  const tone = outcome.status === "achieved" ? "text-[var(--cmp-text-success)]" : "text-[var(--cmp-text-critical)]";
  return (
    <div className="mt-1 space-y-1">
      <p className={`text-[12.5px] font-semibold ${tone}`}>
        Components: {COMPONENT_STATUS_LABEL[outcome.status]}{outcome.overall !== null ? ` · weighted level ${outcome.overall}` : " · no component assessed"}{outcome.target !== null ? ` against ${outcome.target}` : ""}
      </p>
      <ul className="text-[12.5px] text-gray-700">
        {results.map(r => (
          <li key={r.code}>
            {name(r.code)}: {r.score === null ? "not assessed" : `${r.score}${r.label ? ` · ${r.label}` : ""}`}
            {outcome.failedSafetyCritical.includes(r.code) ? " · safety-critical, below its pass level" : outcome.failedMandatory.includes(r.code) ? " · below its pass level"
              : r.score !== null && outcome.missingMandatory.includes(r.code) ? " · no pass level or target to judge it against" : ""}
            {r.note ? ` · ${r.note}` : ""}
          </li>
        ))}
        {outcome.missingMandatory.filter(c => !results.some(r => r.code === c && r.score !== null)).map(c => <li key={`m-${c}`}>{name(c)}: mandatory, not assessed</li>)}
      </ul>
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
