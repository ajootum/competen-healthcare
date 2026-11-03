"use client";
// Checklist Studio, Content tab: groups, sections and items. Sections and items reorder by drag or Move up and Move down
// (ReorderList). A reorder changes positions only, an item keeps its permanent key. Nothing is written until Save.
import { useState } from "react";
import { Btn, Chip, NumIn, TextIn } from "@/components/assessment/ui";
import { ReorderList } from "@/components/assessment";
import { normalizeContent } from "@/lib/assessment/studio/assemble";
import { RESPONSE_TYPE_LABEL, newKey } from "@/lib/assessment/studio/vocab";
import type { ScaleChoice } from "@/lib/assessment/studio/read";
import type { PrefilledGroup } from "@/lib/assessment/adapters/scholar/groups";
import type { EditorContent, EditorItem, InstrumentSection } from "@/lib/assessment/studio/types";
import { CriterionPicker, type PickResult } from "./CriterionPicker";
import { PrefillGroups } from "./PrefillGroups";
import { ItemEditor, type TermOption } from "./ItemEditor";
import { Notice, Panel } from "./studio-ui";

const blankItem = (sectionKey: string, position: number): EditorItem => ({
  stable_key: newKey(), section_key: sectionKey, code: "", prompt: "New item", guidance: null, expected_performance: [], response_type: "yes_no", scale_version_id: null, scale: null,
  config: {}, fields: [], group_code: null, method_codes: [], method_rule: "any", mandatory: false, critical: false, critical_requirements: [], evidence_requirement: null,
  weight: 1, references_text: null, position, mapping: null,
});

export interface ContentTabProps {
  versionId: string;
  /** the server has written these groups: the host shows them as saved */
  onGroupsPrefilled: (groups: PrefilledGroup[]) => void;
  content: EditorContent;
  setContent: (c: EditorContent) => void;
  disabled: boolean;
  methods: { code: string; label: string }[];
  scaleChoices: ScaleChoice[];
  terms: TermOption[];
  drift: Record<string, string[]>;
  canPick: boolean;
}

export function ContentTab({ versionId, onGroupsPrefilled, content, setContent, disabled, methods, scaleChoices, terms, drift, canPick }: ContentTabProps) {
  const [open, setOpen] = useState<string | null>(null);
  const [picker, setPicker] = useState(false);
  const commit = (c: EditorContent) => setContent(normalizeContent(c));
  const itemsOf = (sectionKey: string) => content.items.filter((i) => i.section_key === sectionKey);
  const setSection = (key: string, patch: Partial<InstrumentSection>) => commit({ ...content, sections: content.sections.map((s) => (s.stable_key === key ? { ...s, ...patch } : s)) });
  const setItem = (next: EditorItem) => commit({ ...content, items: content.items.map((i) => (i.stable_key === next.stable_key ? next : i)) });
  const addSection = () => commit({ ...content, sections: [...content.sections, { stable_key: newKey(), parent_section_key: null, title: "New section", guidance: null, weight: 1, position: content.sections.length + 1 }] });
  const addItem = (sectionKey: string) => { const it = blankItem(sectionKey, content.items.length + 1); commit({ ...content, items: [...content.items, it] }); setOpen(it.stable_key); };
  const removeSection = (s: InstrumentSection) => {
    const n = itemsOf(s.stable_key).length;
    if (!window.confirm(n ? `Delete the section "${s.title}" and its ${n} item${n === 1 ? "" : "s"}?` : `Delete the section "${s.title}"?`)) return;
    commit({ ...content, sections: content.sections.filter((x) => x.stable_key !== s.stable_key), items: content.items.filter((i) => i.section_key !== s.stable_key) });
  };
  const removeItem = (i: EditorItem) => { if (window.confirm("Delete this item?")) commit({ ...content, items: content.items.filter((x) => x.stable_key !== i.stable_key) }); };
  const addPicked = (r: PickResult) => {
    commit({ ...content, sections: [...content.sections, ...r.sections], items: [...content.items, ...r.items] });
    setPicker(false);
  };

  return (
    <div className="space-y-4">
      {disabled && <Notice>This version cannot be edited here. Only a draft can, by a person holding the author capability. Duplicate it to a new draft to change it.</Notice>}

      <Panel title="Groups" right={(
        <span className="flex flex-wrap items-center gap-2">
          {canPick && <PrefillGroups versionId={versionId} disabled={disabled} hasGroups={content.groups.length > 0} onAdded={onGroupsPrefilled} />}
          <Btn size="sm" disabled={disabled} onClick={() => commit({ ...content, groups: [...content.groups, { code: `g${content.groups.length + 1}`, label: "New group", weight: 1, position: content.groups.length + 1 }] })}>Add group</Btn>
        </span>
      )}>
        {content.groups.length === 0 ? <p className="text-sm text-[var(--cmp-app-text-secondary)]">Groups collect items for scoring, for example by skill type. They are optional.</p> : (
          <div className="space-y-2">
            {content.groups.map((g, i) => (
              <div key={i} className="grid items-end gap-2 sm:grid-cols-[10rem_1fr_7rem_auto]">
                <TextIn label="Code" value={g.code} disabled={disabled || content.items.some((it) => it.group_code === g.code)} hint={content.items.some((it) => it.group_code === g.code) ? "In use" : undefined}
                  onChange={(v) => commit({ ...content, groups: content.groups.map((x, n) => (n === i ? { ...x, code: v.replace(/[^A-Za-z0-9_.-]/g, "_") } : x)) })} />
                <TextIn label="Label" value={g.label} disabled={disabled} onChange={(v) => commit({ ...content, groups: content.groups.map((x, n) => (n === i ? { ...x, label: v } : x)) })} />
                <NumIn label="Weight" value={g.weight} min={0} step={0.5} disabled={disabled} onChange={(v) => commit({ ...content, groups: content.groups.map((x, n) => (n === i ? { ...x, weight: v ?? 1 } : x)) })} />
                <Btn size="sm" kind="danger" disabled={disabled} onClick={() => commit({ ...content, groups: content.groups.filter((_, n) => n !== i), items: content.items.map((it) => (it.group_code === g.code ? { ...it, group_code: null } : it)) })}>Remove</Btn>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <div className="flex flex-wrap items-center gap-2">
        <Btn kind="primary" disabled={disabled} onClick={addSection}>Add section</Btn>
        <Btn disabled={disabled || !canPick} onClick={() => setPicker(true)} title={canPick ? "Pick criteria from a framework" : "Needs the studio view capability"}>Add from framework criteria</Btn>
        <span className="text-sm text-[var(--cmp-app-text-secondary)]">{content.items.length} item{content.items.length === 1 ? "" : "s"} in {content.sections.length} section{content.sections.length === 1 ? "" : "s"}</span>
      </div>

      {content.sections.length === 0 ? (
        <p className="rounded-xl border border-dashed border-[var(--cmp-app-border)] bg-[var(--cmp-app-surface)] p-4 text-sm text-[var(--cmp-app-text-secondary)]">No section yet. Add a section, then add items to it.</p>
      ) : (
        <ReorderList
          items={content.sections} listKey="sections" ariaLabel="Sections" disabled={disabled} getKey={(s) => s.stable_key} getLabel={(s) => s.title || "Untitled section"}
          onReorder={(next) => commit({ ...content, sections: next })}
          renderItem={(s) => (
            <div className="space-y-3 rounded-xl border border-[var(--cmp-app-border)] bg-[var(--cmp-app-surface)] p-3">
              <div className="grid items-end gap-2 sm:grid-cols-[1fr_7rem_auto]">
                <TextIn label="Section title" value={s.title} disabled={disabled} onChange={(v) => setSection(s.stable_key, { title: v })} />
                <NumIn label="Weight" value={s.weight} min={0} step={0.5} disabled={disabled} onChange={(v) => setSection(s.stable_key, { weight: v ?? 1 })} />
                <Btn size="sm" kind="danger" disabled={disabled} onClick={() => removeSection(s)}>Delete section</Btn>
              </div>
              <TextIn label="Section guidance (optional)" value={s.guidance ?? ""} disabled={disabled} onChange={(v) => setSection(s.stable_key, { guidance: v })} />
              {itemsOf(s.stable_key).length === 0 ? <p className="text-sm text-[var(--cmp-app-text-secondary)]">No items in this section yet.</p> : (
                <ReorderList
                  items={itemsOf(s.stable_key)} listKey={`items-${s.stable_key}`} ariaLabel={`Items in ${s.title || "this section"}`} disabled={disabled} getKey={(i) => i.stable_key}
                  getLabel={(i) => i.prompt.slice(0, 60) || "Item"}
                  onReorder={(next) => commit({ ...content, items: [...content.items.filter((i) => i.section_key !== s.stable_key), ...next] })}
                  renderItem={(it) => (
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <button type="button" aria-expanded={open === it.stable_key} onClick={() => setOpen(open === it.stable_key ? null : it.stable_key)} className="min-h-9 flex-1 text-left text-sm font-semibold text-[var(--cmp-app-text)] pointer-coarse:min-h-[var(--cmp-touch-min)]">
                          {it.code ? <span className="mr-1 font-mono text-xs text-[var(--cmp-app-text-secondary)]">{it.code}</span> : null}{it.prompt || "Untitled item"}
                          <span className="mt-1 flex flex-wrap gap-1 font-normal">
                            <Chip>{RESPONSE_TYPE_LABEL[it.response_type]}</Chip>
                            {it.critical && <Chip tone="critical">Critical</Chip>}{it.mandatory && !it.critical && <Chip>Mandatory</Chip>}
                            {it.mapping && <Chip tone="info">Mapped</Chip>}{(drift[it.stable_key]?.length ?? 0) > 0 && <Chip tone="warning">Differs from framework</Chip>}
                            {it.response_type === "rating_scale" && !it.scale_version_id && <Chip tone="error">No scale</Chip>}
                          </span>
                        </button>
                        <Btn size="sm" kind="danger" disabled={disabled} onClick={() => removeItem(it)} aria-label={`Delete item ${it.prompt.slice(0, 30)}`}>Delete</Btn>
                      </div>
                      {open === it.stable_key && (
                        <ItemEditor item={it} onChange={setItem} groups={content.groups} sections={content.sections} methods={methods} scaleChoices={scaleChoices} terms={terms} drift={drift[it.stable_key] ?? []} disabled={disabled} />
                      )}
                    </div>
                  )}
                />
              )}
              <Btn size="sm" disabled={disabled} onClick={() => addItem(s.stable_key)}>Add item</Btn>
            </div>
          )}
        />
      )}

      {picker && (
        <CriterionPicker
          sections={content.sections} groups={content.groups} scaleChoices={scaleChoices} firstPosition={content.items.length + 1}
          existingRefIds={content.items.flatMap((i) => (i.mapping?.ref_id ? [i.mapping.ref_id] : []))} onAdd={addPicked} onClose={() => setPicker(false)}
        />
      )}
    </div>
  );
}
