"use client";
// Checklist Studio: the response configuration controls shared by an item and its secondary fields.
import { Btn, Check, NumIn, SelectIn, TextIn } from "@/components/assessment/ui";
import { STATE_CODES, type ChoiceOption, type ItemConfig, type ResponseType, type StateCode } from "@/lib/assessment/core";
import { STATE_CODE_LABEL } from "@/lib/assessment/studio/vocab";

const tri = (v: boolean | null | undefined): string => (v === true ? "yes" : v === false ? "no" : "none");
const fromTri = (v: string): boolean | null => (v === "yes" ? true : v === "no" ? false : null);

export function OptionsEditor({ options, onChange, disabled }: { options: ChoiceOption[]; onChange: (o: ChoiceOption[]) => void; disabled?: boolean }) {
  const set = (i: number, patch: Partial<ChoiceOption>) => onChange(options.map((o, n) => (n === i ? { ...o, ...patch } : o)));
  return (
    <div className="space-y-2">
      {options.map((o, i) => (
        <div key={i} className="grid items-end gap-2 rounded-lg border border-[var(--cmp-app-border)] p-2 sm:grid-cols-[8rem_1fr_9rem_6rem_auto]">
          <TextIn label="Code" value={o.code} disabled={disabled} onChange={(v) => set(i, { code: v })} />
          <TextIn label="Label" value={o.label} disabled={disabled} onChange={(v) => set(i, { label: v })} />
          <SelectIn label="Counts as" value={tri(o.satisfactory)} disabled={disabled} onChange={(v) => set(i, { satisfactory: fromTri(v) })}
            options={[{ value: "yes", label: "Satisfactory" }, { value: "no", label: "Not satisfactory" }, { value: "none", label: "No pass or fail" }]} />
          <NumIn label="Credit 0 to 1" value={o.credit ?? null} min={0} max={1} step={0.05} disabled={disabled} onChange={(v) => set(i, { credit: v })} />
          <Btn size="sm" kind="danger" disabled={disabled} onClick={() => onChange(options.filter((_, n) => n !== i))} aria-label={`Remove option ${o.label || o.code}`}>Remove</Btn>
        </div>
      ))}
      <Btn size="sm" disabled={disabled} onClick={() => onChange([...options, { code: `opt${options.length + 1}`, label: "", satisfactory: null, credit: null }])}>Add option</Btn>
    </div>
  );
}

/** The part of the config that depends on the response type, plus the states every type may allow. */
export function ConfigEditor({ type, config, onChange, disabled }: { type: ResponseType; config: ItemConfig; onChange: (c: ItemConfig) => void; disabled?: boolean }) {
  const set = (patch: Partial<ItemConfig>) => {
    const next = { ...config, ...patch } as Record<string, unknown>;
    for (const k of Object.keys(next)) if (next[k] === undefined || next[k] === null || (Array.isArray(next[k]) && (next[k] as unknown[]).length === 0 && k === "allowedStates")) delete next[k];
    onChange(next as ItemConfig);
  };
  const states = config.allowedStates ?? [];
  const toggleState = (s: StateCode) => set({ allowedStates: states.includes(s) ? states.filter((x) => x !== s) : [...states, s] });
  return (
    <div className="space-y-3">
      {type === "multiple_choice" && (
        <div className="space-y-2">
          <SelectIn label="Answer" value={config.select ?? "single"} disabled={disabled} onChange={(v) => set({ select: v as "single" | "multi" })} options={[{ value: "single", label: "Choose one" }, { value: "multi", label: "Choose several" }]} />
          <OptionsEditor options={config.options ?? []} disabled={disabled} onChange={(o) => set({ options: o })} />
        </div>
      )}
      {(type === "numeric_rating" || type === "measurement") && (
        <div className="grid gap-2 sm:grid-cols-4">
          <NumIn label="Minimum" value={typeof config.min === "number" ? config.min : null} disabled={disabled} onChange={(v) => set({ min: v ?? undefined })} />
          <NumIn label="Maximum" value={typeof config.max === "number" ? config.max : null} disabled={disabled} onChange={(v) => set({ max: v ?? undefined })} />
          <NumIn label="Step" value={config.step ?? null} disabled={disabled} onChange={(v) => set({ step: v ?? undefined })} />
          {type === "measurement" && <TextIn label="Unit" value={config.unit ?? ""} disabled={disabled} onChange={(v) => set({ unit: v || undefined })} />}
          <Check label="Whole numbers only" checked={Boolean(config.integer)} disabled={disabled} onChange={(v) => set({ integer: v || undefined })} />
          {type === "numeric_rating" && <NumIn label="Satisfactory from" value={config.satisfactoryMin ?? null} disabled={disabled} onChange={(v) => set({ satisfactoryMin: v ?? undefined })} />}
        </div>
      )}
      {type === "free_text" && (
        <div className="grid gap-2 sm:grid-cols-2">
          <NumIn label="Shortest answer" value={config.minLength ?? null} min={0} disabled={disabled} onChange={(v) => set({ minLength: v ?? undefined })} />
          <NumIn label="Longest answer" value={config.maxLength ?? null} min={1} disabled={disabled} onChange={(v) => set({ maxLength: v ?? undefined })} />
        </div>
      )}
      {type !== "na" && (
        <fieldset className="space-y-1">
          <legend className="text-xs font-semibold text-[var(--cmp-app-text-secondary)]">Other answers this item allows (absence is never a level)</legend>
          <div className="flex flex-wrap gap-x-4">
            {STATE_CODES.map((s) => <Check key={s} label={STATE_CODE_LABEL[s]} checked={states.includes(s)} disabled={disabled} onChange={() => toggleState(s)} />)}
          </div>
          <Check label="A reason is required when one of these is chosen" checked={Boolean(config.naReasonRequired)} disabled={disabled} onChange={(v) => set({ naReasonRequired: v || undefined })} />
        </fieldset>
      )}
    </div>
  );
}
