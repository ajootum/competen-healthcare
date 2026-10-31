"use client";

import Link from "next/link";
import { useState } from "react";
import { criterionLabel, criterionPrefixes } from "@/lib/competency/criterion-labels";
import { CompetencyEditor, Msg, ui, useSend } from "./AuthoringControls";
import type { Reorder, StudioCompetency, StudioDomain } from "./StudioWorkspace";

// FRAMEWORK-DESIGN-STUDIO-02 S2: the unified properties panel of the selected competency. Its fields (the existing
// update_competency form) and its criteria, grouped by section, with inline edit, add, retire / restore and move, in
// the same place as the reorder handles. Every write is the governed S1 API (criteria actions on a DRAFT framework only);
// the server decides, and its refusal is shown as it is. Published and in-review frameworks: controls are disabled.

export const REVIEW_AGAIN = "This change needs clinical review again";
export const REVISION_NOTE = "Changes to a published framework go through a revision draft (coming next).";
const AUTHORING_SUBJECT = "Assessment methods & evidence";
const VERIFICATION = "/super-admin/verification-studio";

type Criterion = StudioCompetency["criteria"][number];
export type MoveTarget = { id: string; label: string };
type Mode = null | "edit" | "move" | "retire" | "restore";

const small = "text-[12.5px] font-semibold text-teal-800 hover:underline disabled:opacity-50 disabled:no-underline pointer-coarse:min-h-[var(--cmp-touch-min)]";
const note = "text-[12px] font-medium text-amber-900";

function CriterionRow({ k, label, comp, code, on, rx, g, i, targets, components, sections }: {
  k: Criterion; label: string | null; comp: StudioCompetency; code: string; on: boolean; rx: Reorder; g: ReturnType<Reorder["criteriaGroup"]> | null; i: number;
  targets: MoveTarget[]; components: Record<string, string>; sections: string[];
}) {
  const { busy, msg, send } = useSend();
  const [mode, setMode] = useState<Mode>(null);
  const [text, setText] = useState(k.text);
  const [ref, setRef] = useState(k.sourceRef ?? "");
  const [toComp, setToComp] = useState(comp.id);
  const [toSec, setToSec] = useState(code);
  const retired = k.active === false;
  const can = on && !!k.id && !busy;
  const same = toComp === comp.id && toSec === code;
  const close = () => setMode(null);
  const rowProps = g ? rx.row(g, i) : null;

  return (
    <li {...(rowProps ?? {})} className={`rounded-lg border border-gray-200 p-2 ${retired ? "bg-gray-50" : "bg-white"} ${rowProps?.className ?? ""}`}>
      <div className="flex items-start gap-2">
        {g && !retired && rx.grip(g, i)}
        <span className="mt-0.5 inline-flex h-7 min-w-9 shrink-0 items-center justify-center rounded-md bg-teal-50 px-1.5 font-mono text-[11.5px] font-semibold text-teal-900">{retired ? "off" : label}</span>
        <div className="min-w-0 flex-1">
          <p className={`whitespace-pre-wrap break-words text-[13.5px] ${retired ? "text-gray-500 line-through" : "text-gray-900"}`}>{k.text}</p>
          {k.sourceRef && <p className="mt-0.5 break-words font-mono text-[11.5px] text-gray-500">{k.sourceRef}</p>}
          {retired && <p className="mt-0.5 text-[12px] text-gray-600">Retired. Kept for history and evidence.</p>}
        </div>
        {g && !retired && <span className="mt-0.5">{rx.buttons(g, i)}</span>}
      </div>
      {k.id && (
        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 pl-1">
          {!retired && <button type="button" className={small} disabled={!can} onClick={() => { setText(k.text); setRef(k.sourceRef ?? ""); setMode(mode === "edit" ? null : "edit"); }}>Edit</button>}
          {!retired && <button type="button" className={small} disabled={!can || targets.length === 0} onClick={() => setMode(mode === "move" ? null : "move")}>Move to…</button>}
          {!retired
            ? <button type="button" className={small} disabled={!can} onClick={() => setMode(mode === "retire" ? null : "retire")}>Retire</button>
            : <button type="button" className={small} disabled={!can} onClick={() => setMode(mode === "restore" ? null : "restore")}>Restore</button>}
        </div>
      )}
      {mode === "edit" && (
        <form className="mt-2 space-y-2" onSubmit={async e => { e.preventDefault(); if (await send({ action: "update_criterion", criterionId: k.id, text, sourceRef: ref }, "Criterion saved.")) close(); }}>
          <label className={ui.label}>Criterion text<textarea className={ui.input} rows={3} value={text} onChange={e => setText(e.target.value)} required minLength={3} maxLength={2000} /></label>
          <label className={ui.label}>Source reference (optional)<input className={ui.input} value={ref} onChange={e => setRef(e.target.value)} maxLength={300} /></label>
          <p className={note}>{REVIEW_AGAIN}.</p>
          <div className="flex flex-wrap items-center gap-2"><button className={ui.primary} disabled={!can || (text === k.text && ref === (k.sourceRef ?? ""))}>Save criterion</button><button type="button" className={ui.ghost} onClick={close}>Cancel</button></div>
        </form>
      )}
      {mode === "move" && (
        <form className="mt-2 space-y-2" onSubmit={async e => {
          e.preventDefault();
          if (await send({ action: "move_criterion", criterionId: k.id, ...(toSec !== code ? { component: toSec } : {}), ...(toComp !== comp.id ? { competencyId: toComp } : {}) }, "Criterion moved.")) close();
        }}>
          <label className={ui.label}>Competency<select className={ui.input} value={toComp} onChange={e => setToComp(e.target.value)}>
            {targets.map(t => <option key={t.id} value={t.id}>{t.id === comp.id ? `${t.label} (this one)` : t.label}</option>)}
          </select></label>
          <label className={ui.label}>Section<select className={ui.input} value={toSec} onChange={e => setToSec(e.target.value)}>
            {sections.filter(s => s in components).map(s => <option key={s} value={s}>{components[s]}</option>)}
          </select></label>
          <p className={note}>{REVIEW_AGAIN}. It is added at the end of the section it moves to. To change only its place in a section, use the arrows or drag it.</p>
          <div className="flex flex-wrap items-center gap-2"><button className={ui.primary} disabled={!can || same || !toSec}>Move criterion</button><button type="button" className={ui.ghost} onClick={close}>Cancel</button></div>
        </form>
      )}
      {(mode === "retire" || mode === "restore") && (
        <div className="mt-2 space-y-2">
          <p className={note}>{REVIEW_AGAIN}.</p>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={ui.primary} disabled={!can} onClick={async () => { if (await send({ action: mode === "retire" ? "retire_criterion" : "restore_criterion", criterionId: k.id }, mode === "retire" ? "Criterion retired." : "Criterion restored.")) close(); }}>{mode === "retire" ? "Retire criterion" : "Restore criterion"}</button>
            <button type="button" className={ui.ghost} onClick={close}>Cancel</button>
          </div>
        </div>
      )}
      <div className="mt-1"><Msg msg={msg} /></div>
    </li>
  );
}

function AddCriterion({ comp, code, label, on }: { comp: StudioCompetency; code: string; label: string; on: boolean }) {
  const { busy, msg, send } = useSend();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [ref, setRef] = useState("");
  return (
    <div className="mt-2">
      {!open
        ? <button type="button" className={small} disabled={!on} onClick={() => setOpen(true)}>Add a criterion to {label}</button>
        : (
          <form className="space-y-2 rounded-lg border border-dashed border-gray-300 p-2" onSubmit={async e => {
            e.preventDefault();
            if (await send({ action: "create_criterion", competencyId: comp.id, component: code, text, ...(ref.trim() ? { sourceRef: ref } : {}) }, "Criterion added.")) { setText(""); setRef(""); setOpen(false); }
          }}>
            <label className={ui.label}>New criterion ({label})<textarea className={ui.input} rows={3} value={text} onChange={e => setText(e.target.value)} required minLength={3} maxLength={2000} /></label>
            <label className={ui.label}>Source reference (optional)<input className={ui.input} value={ref} onChange={e => setRef(e.target.value)} maxLength={300} /></label>
            <p className={note}>{REVIEW_AGAIN}.</p>
            <div className="flex flex-wrap items-center gap-2"><button className={ui.primary} disabled={!on || busy}>Add criterion</button><button type="button" className={ui.ghost} onClick={() => setOpen(false)}>Cancel</button></div>
          </form>
        )}
      {!open && <Msg msg={msg} />}
    </div>
  );
}

export default function PropertiesPanel({ comp, domain, levels, components, sections, targets, rx, editable, criteriaEditable }: {
  comp: StudioCompetency; domain: StudioDomain; levels: { id: string; score: number; label: string }[];
  components: Record<string, string>; sections: string[]; targets: MoveTarget[]; rx: Reorder;
  /** The competency's own fields can be saved (as before: a draft or a published framework). */
  editable: boolean;
  /** Criteria can be added, edited, retired and moved: a DRAFT framework only. */
  criteriaEditable: boolean;
}) {
  const prefixes = criterionPrefixes(components);
  const all = comp.criteria;
  const present = new Set(all.map(k => k.component ?? ""));
  const codes = [...sections.filter(s => s in components), ...(present.has("") ? [""] : [])];
  const active = all.filter(k => k.active !== false).length;

  return (
    <section aria-label="Properties" className="min-w-0 space-y-5">
      {!criteriaEditable && <p role="note" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[12.5px] font-medium text-amber-950">{editable ? REVISION_NOTE : `${REVISION_NOTE} This framework is under governance review or archived, so nothing here is edited.`}</p>}

      <details className="rounded-xl border border-gray-200 p-4" open>
        <summary className="cursor-pointer text-[14px] font-semibold text-gray-900">Details: name, code, description, outcomes, level and risk</summary>
        <p className="mt-1 text-[12.5px] text-gray-600">Saving changes the content version. A reviewed or pending version then needs review again.</p>
        <fieldset disabled={!editable} className="m-0 mt-3 min-w-0 border-0 p-0">
          <CompetencyEditor key={comp.id} c={comp} levels={levels} approved={comp.status === "approved"} cpus={domain.cpus} />
        </fieldset>
      </details>

      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-[15px] font-bold text-gray-900">Assessment criteria</h3>
          <span className="text-[12px] text-gray-500">{active} active · source wording{rx.on ? " · drag or use the arrows to reorder within a section" : ""}</span>
        </div>
        {codes.length === 0 && <p className="mt-2 text-[13px] text-gray-600">No assessment sections are set up for this framework.</p>}
        <div className="mt-2 space-y-4">
          {codes.map(code => {
            const items = all.filter(k => (k.component ?? "") === code);
            const live = items.filter(k => k.active !== false), gone = items.filter(k => k.active === false);
            const heading = code ? components[code] ?? code : "Not classified";
            const g = rx.on && live.length > 1 && live.every(k => k.id) ? rx.criteriaGroup(comp, code || null) : null;
            return (
              <section key={code || "none"} aria-label={heading}>
                <h4 className="text-[12px] font-bold uppercase tracking-wide text-gray-500">{heading} ({live.length})</h4>
                {items.length === 0 && <p className="mt-1 text-[12.5px] text-gray-600">No criteria in this section yet.</p>}
                <ol className="mt-1 space-y-2">
                  {live.map((k, i) => <CriterionRow key={k.id ?? `${code}-${i}`} k={k} label={criterionLabel(prefixes, code || null, i)} comp={comp} code={code} on={criteriaEditable} rx={rx} g={g} i={i} targets={targets} components={components} sections={sections} />)}
                  {gone.map(k => <CriterionRow key={k.id ?? `${code}-x-${k.text}`} k={k} label={null} comp={comp} code={code} on={criteriaEditable} rx={rx} g={null} i={0} targets={targets} components={components} sections={sections} />)}
                </ol>
                {code && <AddCriterion comp={comp} code={code} label={heading} on={criteriaEditable} />}
              </section>
            );
          })}
        </div>
      </div>

      <p className="text-[13px]"><Link href={VERIFICATION} className="font-semibold text-teal-800 hover:underline">{AUTHORING_SUBJECT} →</Link> <span className="text-gray-600">(Verification Studio, for {comp.code ?? comp.name})</span></p>
    </section>
  );
}
