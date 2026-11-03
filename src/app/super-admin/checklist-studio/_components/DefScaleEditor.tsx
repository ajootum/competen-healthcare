"use client";
// Checklist Studio: edits the levels and answer states of a DRAFT response scale. A frozen scale is shown read-only.
// Absence is a state, never a level: not answered, not observed and the like are listed under States, not as level 0.
import { useMemo, useState } from "react";
import { ReorderList } from "@/components/assessment";
import { Btn, Chip, NumIn, SelectIn, TextIn } from "@/components/assessment/ui";
import { STATE_CODES, type StateCode } from "@/lib/assessment/core";
import { STATE_CODE_LABEL } from "@/lib/assessment/studio/vocab";
import type { ScaleLevelRow, ScaleStateRow } from "@/lib/assessment/studio/types";
import { Notice, Panel, callApi, useAction } from "./studio-ui";

export interface StageBandView { stage: string; from_ordinal: number; to_ordinal: number }

type KLevel = ScaleLevelRow & { _k: string };
let keySeq = 0;
const nextKey = () => `lv${++keySeq}`;
const triValue = (v: boolean | null) => (v === true ? "yes" : v === false ? "no" : "none");
const fromTri = (s: string): boolean | null => (s === "yes" ? true : s === "no" ? false : null);

export function DefScaleEditor({ versionId, initialLevels, initialStates, description, scaleKind, bands, stages, editable }: {
  versionId: string; initialLevels: ScaleLevelRow[]; initialStates: ScaleStateRow[]; description: string | null;
  scaleKind: "rating" | "stage"; bands: StageBandView[]; stages: { code: string; label: string; ordinal: number }[]; editable: boolean;
}) {
  const [levels, setLevels] = useState<KLevel[]>([...initialLevels].sort((a, b) => a.ordinal - b.ordinal).map((l) => ({ ...l, _k: nextKey() })));
  const [states, setStates] = useState<ScaleStateRow[]>(initialStates);
  const [desc, setDesc] = useState(description ?? "");
  const [dirty, setDirty] = useState(false);
  const { busy, msg, run } = useAction();
  const mark = <T,>(set: (v: T) => void) => (v: T) => { set(v); setDirty(true); };

  const setLevel = (k: string, patch: Partial<ScaleLevelRow>) => mark(setLevels)(levels.map((l) => (l._k === k ? { ...l, ...patch } : l)));
  const reorder = (next: KLevel[]) => {
    const ords = levels.map((l) => l.ordinal).sort((a, b) => a - b);
    mark(setLevels)(next.map((l, i) => ({ ...l, ordinal: ords[i] })));
  };
  const addLevel = () => {
    const nextOrd = levels.length ? Math.max(...levels.map((l) => l.ordinal)) + 1 : 0;
    let n = levels.length + 1;
    while (levels.some((l) => l.code === `L${n}`)) n++;
    mark(setLevels)([...levels, { code: `L${n}`, label: "", description: null, ordinal: nextOrd, numeric_value: nextOrd, satisfactory: null, colour_token: null, source_level_id: null, _k: nextKey() }]);
  };
  const free = useMemo(() => (STATE_CODES as readonly StateCode[]).filter((s) => !states.some((x) => x.state === s)), [states]);

  const save = () => run("save", () => callApi(`/api/hq/checklist-studio/definitions/scale/${versionId}`, "PUT", {
    description: desc, levels: levels.map(({ _k, ...l }) => { void _k; return { ...l, label: l.label.trim() }; }), states,
  }), { ok: "Saved.", onOk: () => setDirty(false) });

  const problems: string[] = [];
  if (levels.some((l) => !l.label.trim())) problems.push("Every level needs a label.");
  if (levels.some((l) => !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,40}$/.test(l.code))) problems.push("A level code is letters, numbers, dots, dashes and underscores.");
  if (new Set(levels.map((l) => l.code)).size !== levels.length) problems.push("Level codes must differ.");
  if (new Set(levels.map((l) => l.ordinal)).size !== levels.length) problems.push("Level ordinals must differ.");
  if (states.some((s) => !s.label.trim())) problems.push("Every state needs a label.");

  return (
    <div className="space-y-4">
      {!editable && <Notice tone="info">This version is read-only. Only a draft can be edited, and only by someone who holds the author capability. Duplicate it to make a new draft.</Notice>}
      <Panel title="About">
        <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--cmp-app-text-secondary)]">Description
          <textarea value={desc} disabled={!editable} onChange={(e) => mark(setDesc)(e.target.value)} rows={2} className="rounded-lg border border-[var(--cmp-app-control-border)] bg-[var(--cmp-app-surface)] px-3 py-2 text-sm text-[var(--cmp-app-text)]" />
        </label>
      </Panel>

      <Panel title={`Levels (${levels.length})`} right={editable ? <Btn size="sm" onClick={addLevel}>Add a level</Btn> : undefined}>
        <p className="mb-3 text-xs text-[var(--cmp-app-text-secondary)]">Drag, or use Move up and Move down. The order sets the ordinals. Met or not met is what scoring uses. Leave it blank when a level carries no pass or fail meaning.</p>
        <ReorderList
          items={levels} getKey={(l) => l._k} getLabel={(l) => `${l.code} ${l.label}`} ariaLabel="Scale levels" listKey="scale-levels" disabled={!editable}
          onReorder={(next) => reorder(next)}
          renderItem={(l) => (
            <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2 lg:grid-cols-6">
              <TextIn label="Code" value={l.code} disabled={!editable} onChange={(v) => setLevel(l._k, { code: v })} />
              <TextIn label="Label" value={l.label} disabled={!editable} onChange={(v) => setLevel(l._k, { label: v })} className="lg:col-span-2" />
              <NumIn label="Ordinal" value={l.ordinal} disabled onChange={() => {}} />
              <NumIn label="Numeric value" value={l.numeric_value} disabled={!editable} onChange={(v) => setLevel(l._k, { numeric_value: v })} />
              <SelectIn label="Met" value={triValue(l.satisfactory)} disabled={!editable} onChange={(v) => setLevel(l._k, { satisfactory: fromTri(v) })}
                options={[{ value: "none", label: "No meaning" }, { value: "yes", label: "Met" }, { value: "no", label: "Not met" }]} />
              <TextIn label="Description (anchor text)" value={l.description ?? ""} disabled={!editable} onChange={(v) => setLevel(l._k, { description: v || null })} className="sm:col-span-2 lg:col-span-5" />
              {editable && <div className="flex items-end"><Btn kind="danger" size="sm" onClick={() => mark(setLevels)(levels.filter((x) => x._k !== l._k))}>Remove</Btn></div>}
            </div>
          )}
        />
        {levels.length === 0 && <p className="text-sm text-[var(--cmp-app-text-secondary)]">No levels yet.</p>}
      </Panel>

      <Panel title="Answer states" right={editable && free.length > 0 ? <Btn size="sm" onClick={() => mark(setStates)([...states, { state: free[0], label: STATE_CODE_LABEL[free[0]] }])}>Add a state</Btn> : undefined}>
        <p className="mb-3 text-xs text-[var(--cmp-app-text-secondary)]">Ways to answer that are not a level. A state is never level zero.</p>
        <ul className="space-y-2">
          {states.map((s) => (
            <li key={s.state} className="grid gap-2 sm:grid-cols-[14rem_1fr_auto] sm:items-end">
              <SelectIn label="State" value={s.state} disabled={!editable} onChange={(v) => mark(setStates)(states.map((x) => (x.state === s.state ? { ...x, state: v } : x)))}
                options={[s.state, ...free].map((c) => ({ value: c, label: STATE_CODE_LABEL[c as StateCode] ?? c }))} />
              <TextIn label="Label shown to the person answering" value={s.label} disabled={!editable} onChange={(v) => mark(setStates)(states.map((x) => (x.state === s.state ? { ...x, label: v } : x)))} />
              {editable && <Btn kind="danger" size="sm" onClick={() => mark(setStates)(states.filter((x) => x.state !== s.state))}>Remove</Btn>}
            </li>
          ))}
          {states.length === 0 && <li className="text-sm text-[var(--cmp-app-text-secondary)]">No states. Every answer must then be one of the levels.</li>}
        </ul>
      </Panel>

      {scaleKind === "stage" && (
        <Panel title="Stage bands (read only)">
          {stages.length === 0 ? <p className="text-sm text-[var(--cmp-app-text-secondary)]">No stages.</p> : (
            <ul className="space-y-1 text-sm">
              {stages.map((s) => {
                const b = bands.filter((x) => x.stage === s.code);
                return <li key={s.code}><span className="font-semibold">{s.label}</span> <Chip>{s.code}</Chip> {b.length ? b.map((x) => `rating levels ${x.from_ordinal} to ${x.to_ordinal}`).join(", ") : "no rating levels map here"}</li>;
              })}
            </ul>
          )}
          <p className="mt-2 text-xs text-[var(--cmp-app-text-secondary)]">Bands come with an imported stage mapping and are frozen with the version.</p>
        </Panel>
      )}

      {editable && (
        <div className="space-y-2">
          {problems.length > 0 && <Notice tone="warning"><ul className="list-disc pl-5">{problems.map((p) => <li key={p}>{p}</li>)}</ul></Notice>}
          {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
          <div className="flex items-center gap-3">
            <Btn kind="primary" disabled={!dirty || problems.length > 0 || busy !== null} onClick={save}>{busy ? "Saving…" : "Save scale"}</Btn>
            {dirty && <span className="text-xs text-[var(--cmp-app-text-secondary)]">Unsaved changes</span>}
          </div>
        </div>
      )}
    </div>
  );
}
