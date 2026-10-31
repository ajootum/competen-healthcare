"use client";

import { ghost, input } from "@/app/super-admin/ai/fair-use/_components/FairUseControls";
import {
  OSCE_BOUNDS, OSCE_DESIGN_CHECKLIST, OSCE_DIFFICULTIES, OSCE_DIFFICULTY_LABEL, stationContentOf, stationFieldsOf, validateStationContent,
  type StationFields, type StationItemField,
} from "@/lib/individual/scholar/osce";

// OSCE-AUTHORING-01 (owner, 31 Oct 2026). The structured editor of an OSCE practice station, INSIDE the existing HQ
// knowledge-library authoring (KnowledgeControls), not a separate studio. It edits a draft only: what it saves goes
// through the same educator review, independent clinical approval and publication as every other knowledge kind.
//
// ONE VALIDATOR. As the author types, the content is built by stationContentOf and checked by validateStationContent,
// the very functions the server runs before saving and Scholar runs before offering a published station. So the
// reason shown here is the reason the server would give.

export type StationForm = {
  scenario: string; candidateInstructions: string; durationMinutes: string; sections: string; checklist: StationItemField[];
  profession: string; programmeCode: string; programmeLabel: string; topic: string; bodySystem: string; difficulty: string;
  learningOutcomes: string; objectives: string; expectedActivities: string; suggestedResponses: string; assessmentGuidance: string; references: string;
};

const split = (s: string) => s.split("\n").map(x => x.trim()).filter(Boolean);

/** Pure. The form from stored content (or an empty station when there is none). */
export function stationFormOf(content: unknown): StationForm {
  const f = stationFieldsOf(content);
  return {
    scenario: f.scenario, candidateInstructions: f.candidateInstructions, durationMinutes: String(f.durationMinutes), sections: f.sections.join("\n"),
    checklist: f.checklist.length ? f.checklist : [{ id: "item-1", text: "", critical: false }],
    profession: f.profession, programmeCode: f.programmeCode, programmeLabel: f.programmeLabel, topic: f.topic, bodySystem: f.bodySystem, difficulty: f.difficulty,
    learningOutcomes: f.learningOutcomes.join("\n"), objectives: f.objectives.join("\n"), expectedActivities: f.expectedActivities.join("\n"),
    suggestedResponses: f.suggestedResponses.join("\n"), assessmentGuidance: f.assessmentGuidance,
    references: f.references.map(r => (r.url ? `${r.label} | ${r.url}` : r.label)).join("\n"),
  };
}

/** Pure. The fields the route receives (lists one per line; a reference is "label | https://link"). */
export function stationFieldsFromForm(f: StationForm): StationFields {
  return {
    scenario: f.scenario, candidateInstructions: f.candidateInstructions, durationMinutes: f.durationMinutes, sections: split(f.sections), checklist: f.checklist,
    profession: f.profession, programmeCode: f.programmeCode, programmeLabel: f.programmeLabel, topic: f.topic, bodySystem: f.bodySystem, difficulty: f.difficulty,
    learningOutcomes: split(f.learningOutcomes), objectives: split(f.objectives), expectedActivities: split(f.expectedActivities),
    suggestedResponses: split(f.suggestedResponses), assessmentGuidance: f.assessmentGuidance,
    references: split(f.references).map(l => { const [label, ...rest] = l.split("|"); const url = rest.join("|").trim(); return { label: label.trim(), ...(url ? { url } : {}) }; }),
  };
}

/** Pure. The same check the server and Scholar make, on what this form would save. */
export function checkStationForm(f: StationForm): { ok: true; items: number; critical: number } | { ok: false; reason: string } {
  const v = validateStationContent(stationContentOf(stationFieldsFromForm(f) as unknown as Record<string, unknown>));
  return v.ok ? { ok: true, items: v.content.checklist.length, critical: v.content.checklist.filter(i => i.critical).length } : v;
}

const nextId = (items: StationItemField[]) => `item-${items.reduce((m, i) => Math.max(m, Number(/^item-(\d+)$/.exec(i.id)?.[1] ?? 0)), 0) + 1}`;

function Area({ label, value, set, rows = 2, hint }: { label: string; value: string; set: (v: string) => void; rows?: number; hint?: string }) {
  return <label className="text-[12.5px]">{label}{hint && <span className="block text-[11.5px] text-gray-600">{hint}</span>}<textarea rows={rows} value={value} onChange={e => set(e.target.value)} className={`${input} w-full`} /></label>;
}
function Line({ label, value, set }: { label: string; value: string; set: (v: string) => void }) {
  return <label className="text-[12.5px]">{label}<input value={value} onChange={e => set(e.target.value)} className={`${input} w-full`} /></label>;
}

export function OsceStationFields({ value: f, set }: { value: StationForm; set: (f: StationForm) => void }) {
  const put = <K extends keyof StationForm>(k: K) => (v: StationForm[K]) => set({ ...f, [k]: v });
  const items = f.checklist;
  const setItems = (next: StationItemField[]) => set({ ...f, checklist: next });
  const move = (i: number, d: -1 | 1) => { const n = [...items]; const j = i + d; if (j < 0 || j >= n.length) return; [n[i], n[j]] = [n[j], n[i]]; setItems(n); };
  const outcomes = split(f.learningOutcomes);
  const check = checkStationForm(f);
  const len = items.length;
  return (
    <div className="grid gap-3">
      <fieldset className="grid gap-2 md:grid-cols-2">
        <legend className="mb-1 text-[12.5px] font-semibold text-gray-800">Who and what it is for</legend>
        <Line label="Profession" value={f.profession} set={put("profession")} />
        <Line label="Topic" value={f.topic} set={put("topic")} />
        <Line label="Programme code" value={f.programmeCode} set={put("programmeCode")} />
        <Line label="Programme" value={f.programmeLabel} set={put("programmeLabel")} />
        <Line label="Body system" value={f.bodySystem} set={put("bodySystem")} />
        <label className="text-[12.5px]">Difficulty
          <select value={f.difficulty} onChange={e => put("difficulty")(e.target.value)} className={`${input} w-full`}>
            <option value="">Not stated</option>{OSCE_DIFFICULTIES.map(d => <option key={d} value={d}>{OSCE_DIFFICULTY_LABEL[d]}</option>)}
          </select>
        </label>
      </fieldset>
      <p className="text-[11.5px] text-gray-600">The CFCA competencies the station assesses are linked with “Set competencies” on the draft: clinical review is scoped by them, and a station names at least one before it is submitted.</p>
      <Area label="Learning outcomes (one per line)" value={f.learningOutcomes} set={put("learningOutcomes")} rows={3} />
      <Area label="Objectives (one per line)" value={f.objectives} set={put("objectives")} rows={2} />
      <Area label="Candidate instructions" value={f.candidateInstructions} set={put("candidateInstructions")} rows={2} hint="What the candidate is asked to do. 10 to 2000 characters." />
      <Area label="Simulated scenario" value={f.scenario} set={put("scenario")} rows={4} hint="The simulated situation, with no real patient details. 20 to 4000 characters." />
      <label className="text-[12.5px]">Duration (minutes, {OSCE_BOUNDS.durationMin} to {OSCE_BOUNDS.durationMax})
        <input type="number" min={OSCE_BOUNDS.durationMin} max={OSCE_BOUNDS.durationMax} step={1} value={f.durationMinutes} onChange={e => put("durationMinutes")(e.target.value)} className={`${input} block w-28`} />
      </label>
      <Area label="Expected candidate activities (one per line)" value={f.expectedActivities} set={put("expectedActivities")} rows={3} />
      <Area label="Response sections (one heading per line, up to 6)" value={f.sections} set={put("sections")} rows={2} hint="Leave empty for the Scholar defaults." />

      <fieldset className="space-y-2">
        <legend className="text-[12.5px] font-semibold text-gray-800">Checklist ({len} item{len === 1 ? "" : "s"})</legend>
        <p className="text-[11.5px] text-gray-600">{OSCE_DESIGN_CHECKLIST.min} to {OSCE_DESIGN_CHECKLIST.max} items is the usual design. A station may have {OSCE_BOUNDS.checklistMin} to {OSCE_BOUNDS.checklistMax} where that is clinically justified. Mark an item critical when missing it would be unsafe or defeat the task.</p>
        <ol className="space-y-2">
          {items.map((it, i) => (
            <li key={it.id} className="grid gap-1.5 rounded-lg border border-gray-200 p-2 md:grid-cols-[minmax(0,1fr)_auto]">
              <div className="grid gap-1.5">
                <input aria-label={`Checklist item ${i + 1} text`} value={it.text} onChange={e => setItems(items.map(x => (x.id === it.id ? { ...x, text: e.target.value } : x)))} placeholder="Something the candidate says or does" className={`${input} w-full`} />
                <div className="flex flex-wrap items-center gap-3 text-[12.5px]">
                  <label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={it.critical} onChange={e => setItems(items.map(x => (x.id === it.id ? { ...x, critical: e.target.checked } : x)))} />Critical</label>
                  <label className="inline-flex items-center gap-1.5">Outcome
                    <select aria-label={`Checklist item ${i + 1} outcome`} value={it.outcome ?? ""} onChange={e => setItems(items.map(x => { if (x.id !== it.id) return x; const { outcome: _drop, ...rest } = x; void _drop; return e.target.value ? { ...rest, outcome: e.target.value } : rest; }))} className={`${input} max-w-[16rem]`}>
                      <option value="">None</option>
                      {[...new Set([...(it.outcome && !outcomes.includes(it.outcome) ? [it.outcome] : []), ...outcomes])].map(o => <option key={o} value={o}>{o.length > 60 ? `${o.slice(0, 60)}…` : o}</option>)}
                    </select>
                  </label>
                </div>
              </div>
              <div className="flex items-start gap-1">
                <button type="button" className={ghost} disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move item ${i + 1} up`}>↑</button>
                <button type="button" className={ghost} disabled={i === len - 1} onClick={() => move(i, 1)} aria-label={`Move item ${i + 1} down`}>↓</button>
                <button type="button" className={ghost} disabled={len <= 1} onClick={() => setItems(items.filter(x => x.id !== it.id))} aria-label={`Remove item ${i + 1}`}>Remove</button>
              </div>
            </li>
          ))}
        </ol>
        <button type="button" className={ghost} disabled={len >= OSCE_BOUNDS.checklistMax} onClick={() => setItems([...items, { id: nextId(items), text: "", critical: false }])}>Add item</button>
      </fieldset>

      <Area label="Suggested responses (one per line)" value={f.suggestedResponses} set={put("suggestedResponses")} rows={3} hint="Shown to the learner only after a run, never before or during it." />
      <Area label="Scoring guidance" value={f.assessmentGuidance} set={put("assessmentGuidance")} rows={3} hint="How the checklist is judged. Shown only after a run." />
      <Area label="References (one per line: label | https://link)" value={f.references} set={put("references")} rows={2} />
      <p role="status" className={`text-[12.5px] ${check.ok ? "text-[var(--cmp-text-success)]" : "text-[var(--cmp-text-critical)]"}`}>
        {check.ok ? `Ready to save: ${check.items} items, ${check.critical} critical. Saving keeps it a draft, not clinically reviewed.` : `Not ready to save: ${check.reason}`}
      </p>
    </div>
  );
}
