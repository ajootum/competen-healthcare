"use client";
// Checklist Studio: "Add from framework criteria". This is the ONE place the Studio screens know about frameworks and competencies,
// and it reaches them only through the adapter (the API route and src/lib/assessment/adapters). Picking creates an item whose prompt is
// the criterion wording plus a typed mapping carrying a frozen snapshot, the competency hash and the framework version.
import { useEffect, useMemo, useState } from "react";
import { Btn, Check, Chip, SelectIn } from "@/components/assessment/ui";
import { criterionToItem, type CriterionRow, type CriterionTree, type FrameworkOption } from "@/lib/assessment/adapters/scholar/criteria";
import { newKey } from "@/lib/assessment/studio/vocab";
import type { ScaleChoice } from "@/lib/assessment/studio/read";
import type { EditorItem, InstrumentGroup, InstrumentSection } from "@/lib/assessment/studio/types";
import { DefModal } from "./DefShared";
import { Notice, callApi } from "./studio-ui";

export interface PickResult { sections: InstrumentSection[]; items: EditorItem[] }

export function CriterionPicker({ sections, groups, existingRefIds, scaleChoices, firstPosition, onAdd, onClose }: {
  sections: InstrumentSection[]; groups: InstrumentGroup[]; existingRefIds: string[]; scaleChoices: ScaleChoice[]; firstPosition: number;
  onAdd: (r: PickResult) => void; onClose: () => void;
}) {
  const [frameworks, setFrameworks] = useState<FrameworkOption[] | null>(null);
  const [code, setCode] = useState("");
  const [tree, setTree] = useState<CriterionTree | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Record<string, CriterionRow>>({});
  const [sectionKey, setSectionKey] = useState(sections[0]?.stable_key ?? "");
  const [perCompetency, setPerCompetency] = useState(sections.length === 0);
  const [scaleId, setScaleId] = useState(scaleChoices[0]?.versionId ?? "");

  useEffect(() => {
    let live = true;
    void callApi<{ frameworks: FrameworkOption[] }>("/api/hq/checklist-studio/criteria", "GET").then((r) => { if (!live) return; if (r.ok) setFrameworks(r.data.frameworks); else setError(r.error); });
    return () => { live = false; };
  }, []);
  const chooseFramework = (c: string) => {
    setCode(c); setTree(undefined); setPicked({});
    if (!c) return;
    void callApi<{ tree: CriterionTree | null }>(`/api/hq/checklist-studio/criteria?framework=${encodeURIComponent(c)}`, "GET").then((r) => { if (r.ok) setTree(r.data.tree); else setError(r.error); });
  };

  const count = Object.keys(picked).length;
  const existing = useMemo(() => new Set(existingRefIds), [existingRefIds]);
  const toggle = (r: CriterionRow) => setPicked((p) => { const n = { ...p }; if (n[r.skill_id]) delete n[r.skill_id]; else n[r.skill_id] = r; return n; });
  const toggleAll = (rows: CriterionRow[]) => setPicked((p) => {
    const n = { ...p };
    const all = rows.filter((r) => !existing.has(r.skill_id));
    if (all.every((r) => n[r.skill_id])) all.forEach((r) => delete n[r.skill_id]); else all.forEach((r) => { n[r.skill_id] = r; });
    return n;
  });

  const add = () => {
    const scale = scaleChoices.find((s) => s.versionId === scaleId) ?? null;
    const rows = Object.values(picked);
    const newSections: InstrumentSection[] = [];
    let position = firstPosition;
    const items: EditorItem[] = [];
    const groupCodes = groups.map((g) => g.code);
    const sectionFor = new Map<string, string>();
    for (const r of rows) {
      let key = sectionKey;
      if (perCompetency || !key) {
        key = sectionFor.get(r.competency_id) ?? "";
        if (!key) {
          key = newKey();
          sectionFor.set(r.competency_id, key);
          newSections.push({ stable_key: key, parent_section_key: null, title: r.competency_name || "Section", guidance: null, weight: 1, position: sections.length + newSections.length + 1 });
        }
      }
      items.push(criterionToItem(r, { stableKey: newKey(), sectionKey: key, position: position++, scaleVersionId: scale?.versionId ?? null, scale: scale?.scale ?? null, groupCodes }));
    }
    onAdd({ sections: newSections, items });
  };

  return (
    <DefModal title="Add from framework criteria" onClose={onClose}>
      <p className="text-sm text-[var(--cmp-app-text-secondary)]">Each criterion you tick becomes an item. Its wording is copied and frozen with the framework version and competency hash, so you can see later whether the framework has moved on.</p>
      {error && <Notice tone="error">{error}</Notice>}
      <SelectIn label="Framework" value={code} onChange={chooseFramework} options={[{ value: "", label: frameworks ? "Choose a framework" : "Loading…" }, ...(frameworks ?? []).map((f) => ({ value: f.code, label: `${f.code} ${f.version}, ${f.name} (${f.pubStatus})` }))]} />
      {code && tree === undefined && <p className="text-sm text-[var(--cmp-app-text-secondary)]">Loading criteria…</p>}
      {code && tree === null && <Notice>This framework has no criteria yet.</Notice>}
      {tree && (
        <div className="max-h-[50vh] space-y-3 overflow-y-auto rounded-lg border border-[var(--cmp-app-border)] p-2">
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-semibold">{tree.frameworkCode} {tree.frameworkVersion}</span>
            <Chip tone={tree.pubStatus === "published" ? "success" : "warning"}>Framework {tree.pubStatus}</Chip>
          </p>
          {tree.domains.map((d) => (
            <div key={d.name} className="space-y-2">
              <p className="text-xs font-bold uppercase tracking-[0.08em] text-[var(--cmp-app-text-secondary)]">{d.name}</p>
              {d.competencies.map((c) => (
                <div key={c.id} className="rounded-lg border border-[var(--cmp-app-border)] p-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">{c.name}
                      <Chip tone={c.clinicallyApproved === true ? "success" : c.clinicallyApproved === false ? "error" : "neutral"}>
                        {c.clinicallyApproved === true ? "Clinically approved" : c.clinicallyApproved === false ? "Not clinically approved" : "Approval not known"}
                      </Chip>
                    </p>
                    <Btn size="sm" onClick={() => toggleAll(c.criteria)}>Tick all</Btn>
                  </div>
                  <ul className="mt-1 space-y-0.5">
                    {c.criteria.map((r) => (
                      <li key={r.skill_id} className="flex items-start gap-2">
                        <Check label={r.wording} checked={Boolean(picked[r.skill_id]) || existing.has(r.skill_id)} disabled={existing.has(r.skill_id)} onChange={() => toggle(r)} hint={existing.has(r.skill_id) ? "Already in this checklist" : undefined} />
                        {r.component_code && <Chip tone="accent" title="Assessment component">{r.component_code.replace(/_/g, " ")}</Chip>}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectIn label="Put them in" value={perCompetency ? "__new" : sectionKey} onChange={(v) => { if (v === "__new") setPerCompetency(true); else { setPerCompetency(false); setSectionKey(v); } }}
          options={[...sections.map((s) => ({ value: s.stable_key, label: s.title || "Untitled section" })), { value: "__new", label: "A new section for each competency" }]} />
        <SelectIn label="Scale (published versions only)" value={scaleId} onChange={setScaleId} hint={scaleChoices.length === 0 ? "No published scale exists. Items will need a scale before saving." : undefined}
          options={[{ value: "", label: "Choose later" }, ...scaleChoices.map((s) => ({ value: s.versionId, label: s.label }))]} />
      </div>
      <div className="flex justify-end gap-2"><Btn onClick={onClose}>Cancel</Btn><Btn kind="primary" disabled={count === 0} onClick={add}>Add {count} {count === 1 ? "item" : "items"}</Btn></div>
    </DefModal>
  );
}
