"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// The write half of the CFCA-STUDIO-P1 pages (programme frameworks, scales and stages, assessment components).
// Each form posts to /api/hq/competency-studio/*, which re-checks the capability and every rule itself, and the
// database refuses any change to a catalogue or mapping that is no longer a draft.

const btn = "inline-flex items-center justify-center rounded-lg px-3 py-1.5 text-[13px] font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 disabled:opacity-50 pointer-coarse:min-h-[var(--cmp-touch-min)]";
export const primary = `${btn} bg-teal-700 text-white hover:bg-teal-800`;
export const ghost = `${btn} border border-gray-300 bg-white text-gray-800 hover:bg-gray-50`;
const input = "mt-1 block w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-[14px] pointer-coarse:min-h-[var(--cmp-touch-min)]";
const label = "block text-[12.5px] font-semibold text-gray-700";

type Msg = { ok: boolean; text: string } | null;
function usePost(endpoint: string) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  async function post(body: unknown, done: string): Promise<boolean> {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg({ ok: false, text: j?.error ?? "That could not be saved. Nothing has changed." }); return false; }
      setMsg({ ok: true, text: done }); router.refresh(); return true;
    } catch { setMsg({ ok: false, text: "That could not be saved. Check your connection." }); return false; } finally { setBusy(false); }
  }
  return { busy, msg, post };
}
function Note({ msg }: { msg: Msg }) {
  if (!msg) return null;
  return <p role={msg.ok ? "status" : "alert"} className={`text-[13px] ${msg.ok ? "text-green-800" : "text-[var(--cmp-text-critical)]"}`}>{msg.text}</p>;
}

export type LevelOption = { id: string; score: number; label: string; scale: string };
const levelText = (l: LevelOption) => `${l.scale}: ${l.score} ${l.label}`;

// ── Programme: qualification level ──
export function QualificationForm({ programmeCode, terms, current }: { programmeCode: string; terms: { id: string; label: string }[]; current: string | null }) {
  const { busy, msg, post } = usePost("/api/hq/competency-studio/programmes");
  const [v, setV] = useState(current ?? "");
  const id = `q-${programmeCode}`;
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={e => { e.preventDefault(); post({ action: "qualification", programmeCode, termId: v || null }, "Qualification level saved."); }}>
      <div>
        <label htmlFor={id} className={label}>Qualification level</label>
        <select id={id} className={input} value={v} onChange={e => setV(e.target.value)}>
          <option value="">Not set</option>
          {terms.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
      </div>
      <button type="submit" className={ghost} disabled={busy}>Save</button>
      <Note msg={msg} />
    </form>
  );
}

// ── Programme framework entry: requirement, target level, components ──
export type ComponentValue = { code: string; passLevelId: string | null; mandatory: boolean; safetyCritical: boolean; weight: number | null };
export function EntryEditor({ catalogueId, entryId, requirement, expectedLevelId, levels, registry, components }: {
  catalogueId: string; entryId: string; requirement: string; expectedLevelId: string | null; levels: LevelOption[];
  registry: { code: string; label: string; active: boolean }[]; components: ComponentValue[];
}) {
  const { busy, msg, post } = usePost("/api/hq/competency-studio/programmes");
  const [req, setReq] = useState(requirement);
  const [lvl, setLvl] = useState(expectedLevelId ?? "");
  const init = new Map(components.map(c => [c.code, c]));
  const [comp, setComp] = useState<Record<string, ComponentValue & { on: boolean }>>(Object.fromEntries(registry.map(r => {
    const c = init.get(r.code);
    return [r.code, { code: r.code, on: !!c, passLevelId: c?.passLevelId ?? null, mandatory: c?.mandatory ?? true, safetyCritical: c?.safetyCritical ?? false, weight: c?.weight ?? null }];
  })));
  const set = (code: string, k: keyof (ComponentValue & { on: boolean }), v: unknown) => setComp(x => ({ ...x, [code]: { ...x[code], [k]: v } }));
  const id = `e-${entryId}`;
  async function save() {
    const ok = await post({ action: "overlay", catalogueId, entryId, requirement: req, expectedLevelId: lvl || null }, "Requirement saved.");
    if (!ok) return;
    const list = registry.filter(r => comp[r.code]?.on).map(r => {
      const c = comp[r.code];
      return { code: r.code, passLevelId: c.passLevelId || null, mandatory: c.mandatory || c.safetyCritical, safetyCritical: c.safetyCritical, weight: c.weight };
    });
    await post({ action: "components", catalogueId, entryId, components: list }, "Requirement and components saved. The changes are in the audit trail.");
  }
  return (
    <form className="space-y-3" onSubmit={e => { e.preventDefault(); save(); }}>
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <label htmlFor={`${id}-req`} className={label}>Requirement in this programme</label>
          <select id={`${id}-req`} className={input} value={req} onChange={e => setReq(e.target.value)}>
            <option value="required">Required</option><option value="recommended">Recommended</option><option value="optional">Optional</option>
          </select>
        </div>
        <div>
          <label htmlFor={`${id}-lvl`} className={label}>Target level in this programme</label>
          <select id={`${id}-lvl`} className={input} value={lvl} onChange={e => setLvl(e.target.value)}>
            <option value="">The competency&apos;s own expected level</option>
            {levels.map(l => <option key={l.id} value={l.id}>{levelText(l)}</option>)}
          </select>
        </div>
      </div>
      <fieldset className="rounded-lg border border-gray-200 p-3">
        <legend className="px-1 text-[12.5px] font-semibold text-gray-700">Assessment components</legend>
        <p className="mb-2 text-[12.5px] text-gray-600">A failed mandatory or safety-critical component fails the competency, whatever the weighted level. A blank pass level uses the target level.</p>
        <div className="space-y-2">
          {registry.map(r => {
            const c = comp[r.code];
            return (
              <div key={r.code} className="grid items-end gap-2 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1.6fr)_auto_auto_6rem]">
                <label className="flex items-center gap-2 text-[13.5px] font-semibold text-gray-800">
                  <input type="checkbox" checked={c.on} disabled={!r.active && !c.on} onChange={e => set(r.code, "on", e.target.checked)} /> {r.label}{!r.active && " (retired)"}
                </label>
                <select aria-label={`${r.label} pass level`} className={input} value={c.passLevelId ?? ""} disabled={!c.on} onChange={e => set(r.code, "passLevelId", e.target.value || null)}>
                  <option value="">Pass at the target level</option>
                  {levels.map(l => <option key={l.id} value={l.id}>{levelText(l)}</option>)}
                </select>
                <label className="flex items-center gap-1.5 text-[13px] text-gray-700"><input type="checkbox" checked={c.mandatory || c.safetyCritical} disabled={!c.on || c.safetyCritical} onChange={e => set(r.code, "mandatory", e.target.checked)} /> Mandatory</label>
                <label className="flex items-center gap-1.5 text-[13px] text-gray-700"><input type="checkbox" checked={c.safetyCritical} disabled={!c.on} onChange={e => set(r.code, "safetyCritical", e.target.checked)} /> Safety-critical</label>
                <input aria-label={`${r.label} weight`} type="number" min={0.01} max={100} step="any" placeholder="Weight" className={input} value={c.weight ?? ""} disabled={!c.on}
                  onChange={e => set(r.code, "weight", e.target.value === "" ? null : Number(e.target.value))} />
              </div>
            );
          })}
        </div>
      </fieldset>
      <div className="flex flex-wrap items-center gap-3"><button type="submit" className={primary} disabled={busy}>Save</button><Note msg={msg} /></div>
    </form>
  );
}

// ── Stages and mappings ──
export function StageForm({ stage }: { stage: { code: string; label: string; description: string | null; sortOrder: number; active: boolean } | null }) {
  const { busy, msg, post } = usePost("/api/hq/competency-studio/stages");
  const [d, setD] = useState(stage ?? { code: "", label: "", description: "", sortOrder: 0, active: true });
  const id = `s-${stage?.code ?? "new"}`;
  return (
    <form className="grid items-end gap-2 md:grid-cols-[8rem_minmax(0,1fr)_minmax(0,1.5fr)_5rem_auto_auto]" onSubmit={e => { e.preventDefault(); post({ action: "stage", ...d }, stage ? "Stage saved." : "Stage added."); }}>
      <div><label htmlFor={`${id}-c`} className={label}>Code</label><input id={`${id}-c`} className={input} value={d.code} readOnly={!!stage} onChange={e => setD({ ...d, code: e.target.value })} /></div>
      <div><label htmlFor={`${id}-l`} className={label}>Name</label><input id={`${id}-l`} className={input} value={d.label} onChange={e => setD({ ...d, label: e.target.value })} /></div>
      <div><label htmlFor={`${id}-d`} className={label}>Description</label><input id={`${id}-d`} className={input} value={d.description ?? ""} onChange={e => setD({ ...d, description: e.target.value })} /></div>
      <div><label htmlFor={`${id}-o`} className={label}>Order</label><input id={`${id}-o`} type="number" className={input} value={d.sortOrder} onChange={e => setD({ ...d, sortOrder: Number(e.target.value) || 0 })} /></div>
      <label className="flex items-center gap-1.5 text-[13px] text-gray-700"><input type="checkbox" checked={d.active} onChange={e => setD({ ...d, active: e.target.checked })} /> In use</label>
      <div className="flex items-center gap-2"><button type="submit" className={ghost} disabled={busy}>{stage ? "Save" : "Add"}</button><Note msg={msg} /></div>
    </form>
  );
}

export function NewDraftButton({ scaleId, disabled }: { scaleId: string; disabled?: boolean }) {
  const { busy, msg, post } = usePost("/api/hq/competency-studio/stages");
  return <div className="flex flex-wrap items-center gap-2"><button type="button" className={ghost} disabled={busy || disabled} onClick={() => post({ action: "draft", scaleId }, "Draft version created from the published one.")}>Draft a new version</button><Note msg={msg} /></div>;
}

export function DraftBandEditor({ mappingId, levels, bands, stages }: {
  mappingId: string; levels: { id: string; score: number; label: string }[]; bands: { levelId: string; stageCode: string }[]; stages: { code: string; label: string }[];
}) {
  const { busy, msg, post } = usePost("/api/hq/competency-studio/stages");
  const at = new Map(bands.map(b => [b.levelId, b.stageCode]));
  return (
    <div className="space-y-2">
      <table className="w-full text-left text-[13.5px]">
        <thead><tr className="text-[12px] uppercase tracking-wide text-gray-500"><th className="py-1">Level</th><th className="py-1">Stage</th></tr></thead>
        <tbody>
          {levels.map(l => (
            <tr key={l.id} className="border-t border-gray-100">
              <td className="py-1.5 pr-3">{l.score} {l.label}</td>
              <td className="py-1.5">
                <select aria-label={`Stage for level ${l.score}`} className={input} value={at.get(l.id) ?? ""} disabled={busy}
                  onChange={e => e.target.value && post({ action: "band", mappingId, levelId: l.id, stageCode: e.target.value }, `Level ${l.score} set.`)}>
                  <option value="">No stage yet</option>
                  {stages.map(s => <option key={s.code} value={s.code}>{s.label}</option>)}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={ghost} disabled={busy} onClick={() => post({ action: "discard", mappingId }, "Draft discarded.")}>Discard draft</button>
        <Note msg={msg} />
      </div>
    </div>
  );
}

export function PublishMappingButton({ mappingId, label: text }: { mappingId: string; label: string }) {
  const { busy, msg, post } = usePost("/api/hq/competency-studio/stages");
  return <div className="flex flex-wrap items-center gap-2"><button type="button" className={primary} disabled={busy} onClick={() => post({ action: "publish", mappingId }, "Published. The previous version is retired and kept.")}>{text}</button><Note msg={msg} /></div>;
}

// ── Assessment component registry ──
export function ComponentForm({ def }: { def: { code: string; label: string; description: string | null; sortOrder: number; active: boolean } | null }) {
  const { busy, msg, post } = usePost("/api/hq/competency-studio/components");
  const [d, setD] = useState(def ?? { code: "", label: "", description: "", sortOrder: 0, active: true });
  const id = `c-${def?.code ?? "new"}`;
  return (
    <form className="grid items-end gap-2 md:grid-cols-[10rem_minmax(0,1fr)_minmax(0,1.6fr)_5rem_auto_auto]" onSubmit={e => { e.preventDefault(); post(d, def ? "Component saved." : "Component added."); }}>
      <div><label htmlFor={`${id}-c`} className={label}>Code</label><input id={`${id}-c`} className={input} value={d.code} readOnly={!!def} onChange={e => setD({ ...d, code: e.target.value })} /></div>
      <div><label htmlFor={`${id}-l`} className={label}>Name</label><input id={`${id}-l`} className={input} value={d.label} onChange={e => setD({ ...d, label: e.target.value })} /></div>
      <div><label htmlFor={`${id}-d`} className={label}>Description</label><input id={`${id}-d`} className={input} value={d.description ?? ""} onChange={e => setD({ ...d, description: e.target.value })} /></div>
      <div><label htmlFor={`${id}-o`} className={label}>Order</label><input id={`${id}-o`} type="number" className={input} value={d.sortOrder} onChange={e => setD({ ...d, sortOrder: Number(e.target.value) || 0 })} /></div>
      <label className="flex items-center gap-1.5 text-[13px] text-gray-700"><input type="checkbox" checked={d.active} onChange={e => setD({ ...d, active: e.target.checked })} /> In use</label>
      <div className="flex items-center gap-2"><button type="submit" className={ghost} disabled={busy}>{def ? "Save" : "Add"}</button><Note msg={msg} /></div>
    </form>
  );
}
