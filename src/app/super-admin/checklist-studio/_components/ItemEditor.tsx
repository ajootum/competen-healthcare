"use client";
// Checklist Studio: the editor of one item. A mapped item shows the wording of what it maps to, read-only, with a flag when that
// has moved on since it was mapped. Unlinking the mapping makes the prompt editable again.
import { Btn, Check, Chip, Labelled, NumIn, SelectIn, TextIn } from "@/components/assessment/ui";
import { CRITICAL_REQUIREMENTS, RESPONSE_TYPES, type CriticalRequirement, type ItemField, type ResponseType } from "@/lib/assessment/core";
import { CRITICAL_LABEL, RESPONSE_TYPE_LABEL } from "@/lib/assessment/studio/vocab";
import type { ScaleChoice } from "@/lib/assessment/studio/read";
import type { EditorItem, InstrumentGroup, InstrumentSection } from "@/lib/assessment/studio/types";
import { ConfigEditor } from "./ItemParts";
import { Notice } from "./studio-ui";

export interface TermOption { id: string; label: string; group: string }

export interface ItemEditorProps {
  item: EditorItem;
  onChange: (next: EditorItem) => void;
  groups: InstrumentGroup[];
  sections: InstrumentSection[];
  methods: { code: string; label: string }[];
  scaleChoices: ScaleChoice[];
  terms: TermOption[];
  drift: string[];
  disabled: boolean;
}

const area = "rounded-lg border border-[var(--cmp-app-control-border)] bg-[var(--cmp-app-surface)] px-3 py-2 text-sm text-[var(--cmp-app-text)] disabled:opacity-60";

export function ItemEditor({ item, onChange, groups, sections, methods, scaleChoices, terms, drift, disabled }: ItemEditorProps) {
  const set = (patch: Partial<EditorItem>) => onChange({ ...item, ...patch });
  const mapped = item.mapping !== null;
  const snapWording = typeof item.mapping?.ref_snapshot?.wording === "string" ? (item.mapping.ref_snapshot.wording as string) : item.prompt;
  const scaleOf = (id: string | null | undefined) => scaleChoices.find((s) => s.versionId === id)?.scale ?? null;
  const setType = (t: ResponseType) => {
    const keep = (t === "rating_scale") ? item.scale_version_id : null;
    set({ response_type: t, scale_version_id: keep, scale: scaleOf(keep), config: t === "multiple_choice" ? { select: "single", options: [] } : {} });
  };
  const setField = (i: number, patch: Partial<ItemField>) => set({ fields: (item.fields ?? []).map((f, n) => (n === i ? { ...f, ...patch } : f)) });

  return (
    <div className="space-y-4 rounded-xl border border-[var(--cmp-theme-border)] bg-[var(--cmp-app-bg)] p-3">
      {mapped && (
        <div className="space-y-1 rounded-lg border border-[var(--cmp-app-border)] bg-[var(--cmp-app-surface)] p-3">
          <p className="text-xs font-bold uppercase tracking-[0.08em] text-[var(--cmp-app-text-secondary)]">Mapped to {item.mapping?.ref_version ?? "a reference"}{item.mapping?.ref_code ? `, ${item.mapping.ref_code}` : ""}</p>
          <p className="text-sm">{snapWording}</p>
          <p className="text-xs text-[var(--cmp-app-text-secondary)]">This wording was frozen when the item was added. It is read-only here.</p>
          {drift.length > 0 && (
            <Notice tone="warning">
              <span className="font-semibold">Differs from framework.</span> {drift.join(" ")}
            </Notice>
          )}
          <Btn size="sm" disabled={disabled} onClick={() => set({ mapping: null })}>Unlink from the framework</Btn>
        </div>
      )}

      {!mapped && (
        <Labelled label="Prompt (what is asked or observed)">
          <textarea value={item.prompt} disabled={disabled} rows={2} onChange={(e) => set({ prompt: e.target.value })} className={area} />
        </Labelled>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <TextIn label="Code (optional)" value={item.code} disabled={disabled} onChange={(v) => set({ code: v })} />
        <NumIn label="Weight" value={item.weight} min={0} step={0.5} disabled={disabled} onChange={(v) => set({ weight: v ?? 1 })} />
        <SelectIn label="Section" value={item.section_key} disabled={disabled} onChange={(v) => set({ section_key: v })} options={sections.map((s) => ({ value: s.stable_key, label: s.title || "Untitled section" }))} />
      </div>
      <Labelled label="Guidance for the person answering">
        <textarea value={item.guidance ?? ""} disabled={disabled} rows={2} onChange={(e) => set({ guidance: e.target.value })} className={area} />
      </Labelled>

      <fieldset className="space-y-2">
        <legend className="text-xs font-semibold text-[var(--cmp-app-text-secondary)]">Expected performance (what good looks like, optionally per level or term)</legend>
        {(item.expected_performance ?? []).map((e, i) => (
          <div key={i} className="grid items-end gap-2 sm:grid-cols-[14rem_1fr_auto]">
            <SelectIn label="For" value={e.term_id ?? ""} disabled={disabled} onChange={(v) => set({ expected_performance: item.expected_performance!.map((x, n) => (n === i ? { ...x, term_id: v || null } : x)) })}
              options={[{ value: "", label: "Everyone" }, ...terms.map((t) => ({ value: t.id, label: `${t.group}: ${t.label}` }))]} />
            <TextIn label="Expected" value={e.text} disabled={disabled} onChange={(v) => set({ expected_performance: item.expected_performance!.map((x, n) => (n === i ? { ...x, text: v } : x)) })} />
            <Btn size="sm" kind="danger" disabled={disabled} onClick={() => set({ expected_performance: item.expected_performance!.filter((_, n) => n !== i) })}>Remove</Btn>
          </div>
        ))}
        <Btn size="sm" disabled={disabled} onClick={() => set({ expected_performance: [...(item.expected_performance ?? []), { term_id: null, text: "" }] })}>Add expected performance</Btn>
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        <SelectIn label="Response type" value={item.response_type} disabled={disabled} onChange={(v) => setType(v as ResponseType)} options={RESPONSE_TYPES.map((t) => ({ value: t, label: RESPONSE_TYPE_LABEL[t] }))} />
        {item.response_type === "rating_scale" && (
          <SelectIn label="Scale (published versions only)" value={item.scale_version_id ?? ""} disabled={disabled} hint={scaleChoices.length === 0 ? "No published scale exists yet. Publish one under Scales." : undefined}
            onChange={(v) => set({ scale_version_id: v || null, scale: scaleOf(v || null) })} options={[{ value: "", label: "Choose a scale" }, ...scaleChoices.map((s) => ({ value: s.versionId, label: s.label }))]} />
        )}
      </div>
      <ConfigEditor type={item.response_type} config={item.config} disabled={disabled} onChange={(c) => set({ config: c })} />

      <div className="grid gap-3 sm:grid-cols-2">
        <SelectIn label="Group" value={item.group_code ?? ""} disabled={disabled} onChange={(v) => set({ group_code: v || null })} options={[{ value: "", label: "No group" }, ...groups.map((g) => ({ value: g.code, label: g.label }))]} />
        <SelectIn label="Methods must be" value={item.method_rule ?? "any"} disabled={disabled} onChange={(v) => set({ method_rule: v as "any" | "all" })} options={[{ value: "any", label: "Any one of the methods" }, { value: "all", label: "All of the methods" }]} />
      </div>
      <fieldset className="space-y-1">
        <legend className="text-xs font-semibold text-[var(--cmp-app-text-secondary)]">Assessment methods for this item</legend>
        <div className="flex flex-wrap gap-x-4">
          {methods.map((m) => <Check key={m.code} label={m.label} checked={item.method_codes.includes(m.code)} disabled={disabled} onChange={() => set({ method_codes: item.method_codes.includes(m.code) ? item.method_codes.filter((x) => x !== m.code) : [...item.method_codes, m.code] })} />)}
        </div>
      </fieldset>

      <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
        <Check label="Mandatory" checked={item.mandatory || item.critical} disabled={disabled || item.critical} hint="A mandatory item left unanswered makes the result incomplete" onChange={(v) => set({ mandatory: v })} />
        <Check label="Critical" checked={item.critical} disabled={disabled} hint="A critical item that fails cannot be outweighed by a high average" onChange={(v) => set({ critical: v, mandatory: v ? true : item.mandatory, critical_requirements: v ? (item.critical_requirements.length ? item.critical_requirements : ["must_be_satisfactory"]) : [] })} />
      </div>
      {item.critical && (
        <fieldset className="space-y-1">
          <legend className="text-xs font-semibold text-[var(--cmp-app-text-secondary)]">What a critical item requires</legend>
          <div className="flex flex-wrap gap-x-4">
            {CRITICAL_REQUIREMENTS.map((r: CriticalRequirement) => (
              <Check key={r} label={CRITICAL_LABEL[r]} checked={item.critical_requirements.includes(r)} disabled={disabled}
                onChange={() => set({ critical_requirements: item.critical_requirements.includes(r) ? item.critical_requirements.filter((x) => x !== r) : [...item.critical_requirements, r] })} />
            ))}
          </div>
        </fieldset>
      )}

      <fieldset className="space-y-2">
        <legend className="text-xs font-semibold text-[var(--cmp-app-text-secondary)]">Evidence</legend>
        <Check label="Evidence is required for this item" checked={Boolean(item.evidence_requirement?.required)} disabled={disabled}
          onChange={(v) => set({ evidence_requirement: v ? { required: true, min_count: item.evidence_requirement?.min_count ?? 1 } : null })} />
        {item.evidence_requirement?.required && <NumIn label="At least this many pieces" value={item.evidence_requirement.min_count ?? 1} min={1} disabled={disabled} onChange={(v) => set({ evidence_requirement: { ...item.evidence_requirement!, min_count: v ?? 1 } })} />}
      </fieldset>
      <Labelled label="References (standards, policies, sources)">
        <textarea value={item.references_text ?? ""} disabled={disabled} rows={2} onChange={(e) => set({ references_text: e.target.value })} className={area} />
      </Labelled>

      <fieldset className="space-y-2">
        <legend className="text-xs font-semibold text-[var(--cmp-app-text-secondary)]">Secondary fields (notes, findings and other values captured beside the main answer, never scored by default)</legend>
        {(item.fields ?? []).map((f, i) => (
          <div key={i} className="space-y-2 rounded-lg border border-[var(--cmp-app-border)] bg-[var(--cmp-app-surface)] p-2">
            <div className="grid items-end gap-2 sm:grid-cols-[9rem_1fr_12rem_auto]">
              <TextIn label="Key" value={f.field_key} disabled={disabled} hint="lower case, no spaces" onChange={(v) => setField(i, { field_key: v.toLowerCase().replace(/[^a-z0-9_]/g, "_") })} />
              <TextIn label="Label" value={f.label} disabled={disabled} onChange={(v) => setField(i, { label: v })} />
              <SelectIn label="Type" value={f.response_type} disabled={disabled}
                onChange={(v) => setField(i, { response_type: v as ResponseType, scale_version_id: v === "rating_scale" ? f.scale_version_id ?? null : null, scale: v === "rating_scale" ? f.scale ?? null : null, config: v === "multiple_choice" ? { select: "single", options: [] } : {} })}
                options={RESPONSE_TYPES.map((t) => ({ value: t, label: RESPONSE_TYPE_LABEL[t] }))} />
              <Btn size="sm" kind="danger" disabled={disabled} onClick={() => set({ fields: (item.fields ?? []).filter((_, n) => n !== i).map((x, n) => ({ ...x, position: n + 1 })) })}>Remove</Btn>
            </div>
            {f.response_type === "rating_scale" && (
              <SelectIn label="Scale" value={f.scale_version_id ?? ""} disabled={disabled} onChange={(v) => setField(i, { scale_version_id: v || null, scale: scaleOf(v || null) })}
                options={[{ value: "", label: "Choose a scale" }, ...scaleChoices.map((s) => ({ value: s.versionId, label: s.label }))]} />
            )}
            <ConfigEditor type={f.response_type} config={f.config} disabled={disabled} onChange={(c) => setField(i, { config: c })} />
            <Check label="Required" checked={f.required} disabled={disabled} onChange={(v) => setField(i, { required: v })} />
          </div>
        ))}
        <Btn size="sm" disabled={disabled} onClick={() => set({ fields: [...(item.fields ?? []), { field_key: `note${(item.fields ?? []).length + 1}`, label: "Note", response_type: "free_text", scale_version_id: null, scale: null, config: {}, required: false, position: (item.fields ?? []).length + 1 }] })}>Add a field</Btn>
      </fieldset>
      <p className="flex flex-wrap gap-1 text-xs text-[var(--cmp-app-text-secondary)]">
        {item.critical && <Chip tone="critical">Critical</Chip>}{item.mandatory && <Chip>Mandatory</Chip>}{mapped && <Chip tone="info">Mapped</Chip>}
      </p>
    </div>
  );
}
