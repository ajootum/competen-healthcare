"use client";
// Response controls: one per response type, and the state controls. Product-agnostic: every word comes from the
// definition (level labels and descriptors, option labels, state labels via stateLabel()).
//
//   <FieldInput spec control value onChange idBase label issues evidence />
//
// A response holds exactly one of level_code / state / value (the engine's rule). These controls never write two.
import { useState } from "react";
import {
  allowedStates, stateLabel, CONTROL_VOCAB,
  type FieldSpec, type ResponseIssue, type ResponseValue, type StateCode, type ViewOption,
} from "@/lib/assessment/core";
import { Btn, Chip, fieldBase, focusRing, mutedText, touch, touchSm } from "./ui";

export interface EvidenceSlot { count: number; onAttach?: () => void }

export interface FieldInputProps {
  spec: FieldSpec;
  /** the layout's control name for this response type; falls back to the first allowed one */
  control?: string;
  value: ResponseValue | null;
  onChange: (next: ResponseValue | null) => void;
  idBase: string;
  /** accessible name of the field (the item prompt for a primary field) */
  label: string;
  disabled?: boolean;
  issues?: ResponseIssue[];
  evidence?: EvidenceSlot;
  /** hide the state buttons (rare: a read-only echo) */
  hideStates?: boolean;
}

const YESNO: Record<string, ViewOption[]> = {
  yes_no: [{ code: "yes", label: "Yes" }, { code: "no", label: "No" }],
  pass_fail: [{ code: "pass", label: "Pass" }, { code: "fail", label: "Fail" }],
  achieved: [{ code: "achieved", label: "Achieved" }, { code: "not_achieved", label: "Not achieved" }],
};

/** Every choice a field offers, with its descriptor. A rating scale lists EVERY level, lowest first. */
export function optionsOf(spec: FieldSpec): ViewOption[] {
  if (spec.response_type === "rating_scale") {
    return [...(spec.scale?.levels ?? [])].sort((a, b) => a.ordinal - b.ordinal).map((l) => ({ code: l.code, label: l.label, description: l.description ?? null, ordinal: l.ordinal }));
  }
  if (spec.response_type === "multiple_choice") return (spec.config.options ?? []).map((o) => ({ code: o.code, label: o.label, description: o.description ?? null }));
  return YESNO[spec.response_type] ?? [];
}

export function controlFor(spec: FieldSpec, asked?: string): string {
  const vocab = CONTROL_VOCAB[spec.response_type];
  let c = asked && vocab.includes(asked) ? asked : vocab[0];
  if (spec.response_type === "multiple_choice") {
    if (spec.config.select === "multi") c = "checkbox_list";
    else if (c === "checkbox_list") c = "radio_list";
  }
  return c;
}

// ── choice groups ────────────────────────────────────────────────────────────────────────────────────────────
function ChoiceGroup({ name, label, options, selected, multi, mode, onPick, disabled }: {
  name: string; label: string; options: ViewOption[]; selected: string[]; multi?: boolean; mode: "segmented" | "radio_list" | "checkbox_list";
  onPick: (code: string) => void; disabled?: boolean;
}) {
  const kind = mode === "checkbox_list" || multi ? "checkbox" : "radio";
  if (mode === "segmented") {
    return (
      <div role="radiogroup" aria-label={label} className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(7rem, 1fr))" }}>
        {options.map((o) => {
          const on = selected.includes(o.code);
          return (
            <label key={o.code} className={`relative flex ${touch} cursor-pointer`}>
              <input type="radio" name={name} value={o.code} checked={on} disabled={disabled} onChange={() => onPick(o.code)} className="peer sr-only" />
              <span className={`flex w-full flex-col items-start gap-0.5 rounded-lg border px-3 py-2 text-left text-sm peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--cmp-theme-accent)] peer-disabled:opacity-50 ${on ? "border-[var(--cmp-theme-accent)] bg-[var(--cmp-theme-accent)] text-[var(--cmp-theme-on-accent)]" : "border-[var(--cmp-app-control-border)] bg-[var(--cmp-app-surface)] text-[var(--cmp-app-text)] hover:bg-[var(--cmp-app-bg)]"}`}>
                <span className="font-semibold">{o.label}</span>
                {o.description ? <span className={`text-xs ${on ? "text-[var(--cmp-theme-on-accent)]" : mutedText}`}>{o.description}</span> : null}
              </span>
            </label>
          );
        })}
      </div>
    );
  }
  return (
    <div role={kind === "radio" ? "radiogroup" : "group"} aria-label={label} className="flex flex-col gap-1.5">
      {options.map((o) => {
        const on = selected.includes(o.code);
        return (
          <label key={o.code} className={`flex ${touch} cursor-pointer items-start gap-3 rounded-lg border px-3 py-2 text-sm ${on ? "border-[var(--cmp-theme-accent)] bg-[var(--cmp-theme-soft)]" : "border-[var(--cmp-app-border)] bg-[var(--cmp-app-surface)] hover:bg-[var(--cmp-app-bg)]"}`}>
            <input type={kind} name={name} value={o.code} checked={on} disabled={disabled} onChange={() => onPick(o.code)} className={`mt-0.5 h-5 w-5 shrink-0 accent-[var(--cmp-theme-accent)] ${focusRing}`} />
            <span className="text-[var(--cmp-app-text)]">
              <span className="font-semibold">{o.label}</span>
              {o.description ? <span className={`block text-xs ${mutedText}`}>{o.description}</span> : null}
            </span>
          </label>
        );
      })}
    </div>
  );
}

function SelectChoice({ label, options, selected, onPick, disabled, id }: { label: string; options: ViewOption[]; selected: string | null; onPick: (code: string | null) => void; disabled?: boolean; id: string }) {
  const chosen = options.find((o) => o.code === selected);
  return (
    <div className="flex flex-col gap-1">
      <select id={id} aria-label={label} value={selected ?? ""} disabled={disabled} onChange={(e) => onPick(e.target.value === "" ? null : e.target.value)} className={`${fieldBase} ${touch}`}>
        <option value="">Select an answer</option>
        {options.map((o) => <option key={o.code} value={o.code}>{o.description ? `${o.label} - ${o.description}` : o.label}</option>)}
      </select>
      {chosen?.description ? <p className={`text-xs ${mutedText}`}>{chosen.description}</p> : null}
    </div>
  );
}

// ── number input with a text draft (typing "1." must not fight the parser) ───────────────────────────────────
function NumberBox({ id, label, value, onCommit, disabled, min, max, step, unit }: { id: string; label: string; value: number | null; onCommit: (n: number | null) => void; disabled?: boolean; min?: number; max?: number; step?: number; unit?: string }) {
  const [draft, setDraft] = useState(value === null ? "" : String(value));
  // follow the value when it changes from outside, but keep what the person is typing while it parses to the same number
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    if (!(draft.trim() !== "" && Number(draft) === value)) setDraft(value === null ? "" : String(value));
  }
  return (
    <div className="flex items-center gap-2">
      <input
        id={id} type="number" inputMode="decimal" aria-label={label} value={draft} disabled={disabled} min={min} max={max} step={step}
        onChange={(e) => {
          const t = e.target.value;
          setDraft(t);
          if (t.trim() === "") onCommit(null);
          else { const n = Number(t); if (Number.isFinite(n)) onCommit(n); }
        }}
        className={`${fieldBase} ${touch} max-w-[10rem]`}
      />
      {unit ? <span className={`text-sm ${mutedText}`}>{unit}</span> : null}
    </div>
  );
}

const toLocalInput = (v: unknown): string => (typeof v === "string" ? v.replace(" ", "T").slice(0, 16) : "");

// ── the control for one field ────────────────────────────────────────────────────────────────────────────────
export function FieldInput({ spec, control, value, onChange, idBase, label, disabled, issues = [], evidence, hideStates }: FieldInputProps) {
  const type = spec.response_type;
  const c = spec.config;
  const ctl = controlFor(spec, control);
  const opts = optionsOf(spec);
  const inState = value?.state != null && value.state !== "not_assessed";
  const levelSel = !inState && value?.level_code != null ? [String(value.level_code)] : [];
  const valSel = !inState && value?.value != null ? (Array.isArray(value.value) ? value.value.map(String) : [String(value.value)]) : [];
  const num = !inState && typeof value?.value === "number" ? value.value : !inState && value?.value && typeof value.value === "object" && typeof (value.value as { value?: unknown }).value === "number" ? (value.value as { value: number }).value : null;
  const emit = (r: ResponseValue | null) => onChange(r);

  let main: React.ReactNode = null;
  switch (type) {
    case "rating_scale":
      main = ctl === "select"
        ? <SelectChoice id={`${idBase}-sel`} label={label} options={opts} selected={levelSel[0] ?? null} disabled={disabled} onPick={(code) => emit(code ? { level_code: code } : null)} />
        : <ChoiceGroup name={idBase} label={label} options={opts} selected={levelSel} mode={ctl === "radio_list" ? "radio_list" : "segmented"} disabled={disabled} onPick={(code) => emit({ level_code: code })} />;
      break;
    case "yes_no": case "pass_fail": case "achieved":
      main = <ChoiceGroup name={idBase} label={label} options={opts} selected={valSel} mode={ctl === "radio_list" ? "radio_list" : "segmented"} disabled={disabled} onPick={(code) => emit({ value: code })} />;
      break;
    case "multiple_choice": {
      const multi = c.select === "multi";
      if (ctl === "select" && !multi) main = <SelectChoice id={`${idBase}-sel`} label={label} options={opts} selected={valSel[0] ?? null} disabled={disabled} onPick={(code) => emit(code ? { value: code } : null)} />;
      else main = (
        <ChoiceGroup
          name={idBase} label={label} options={opts} selected={valSel} multi={multi} mode={multi ? "checkbox_list" : "radio_list"} disabled={disabled}
          onPick={(code) => {
            if (!multi) { emit({ value: code }); return; }
            const next = valSel.includes(code) ? valSel.filter((x) => x !== code) : [...valSel, code];
            emit(next.length ? { value: next } : null);
          }}
        />
      );
      break;
    }
    case "numeric_rating": {
      const mn = typeof c.min === "number" ? c.min : undefined, mx = typeof c.max === "number" ? c.max : undefined;
      const stepN = c.step && c.step > 0 ? c.step : 1;
      const span = mn !== undefined && mx !== undefined ? Math.floor((mx - mn) / stepN) + 1 : Infinity;
      if (ctl !== "input" && span <= 11 && mn !== undefined) {
        const list: ViewOption[] = Array.from({ length: span }, (_, i) => ({ code: String(mn + i * stepN), label: String(mn + i * stepN) }));
        main = ctl === "select"
          ? <SelectChoice id={`${idBase}-sel`} label={label} options={list} selected={num === null ? null : String(num)} disabled={disabled} onPick={(code) => emit(code === null ? null : { value: Number(code) })} />
          : <ChoiceGroup name={idBase} label={label} options={list} selected={num === null ? [] : [String(num)]} mode="segmented" disabled={disabled} onPick={(code) => emit({ value: Number(code) })} />;
      } else main = <NumberBox id={`${idBase}-num`} label={label} value={num} min={mn} max={mx} step={c.step} disabled={disabled} onCommit={(n) => emit(n === null ? null : { value: n })} />;
      break;
    }
    case "measurement":
      main = <NumberBox id={`${idBase}-num`} label={label} value={num} min={typeof c.min === "number" ? c.min : undefined} max={typeof c.max === "number" ? c.max : undefined} step={c.step} unit={c.unit} disabled={disabled} onCommit={(n) => emit(n === null ? null : { value: n })} />;
      break;
    case "free_text": {
      const text = !inState && typeof value?.value === "string" ? value.value : "";
      main = (
        <div className="flex flex-col gap-1">
          <textarea
            id={`${idBase}-text`} aria-label={label} value={text} disabled={disabled} rows={3} maxLength={c.maxLength}
            onChange={(e) => emit(e.target.value === "" ? null : { value: e.target.value })} className={`${fieldBase} min-h-[5rem]`}
          />
          {c.maxLength ? <span className={`self-end text-xs ${mutedText}`}>{text.length} of {c.maxLength}</span> : null}
        </div>
      );
      break;
    }
    case "datetime":
      main = (
        <input
          id={`${idBase}-dt`} type="datetime-local" aria-label={label} disabled={disabled}
          value={inState ? "" : toLocalInput(value?.value)} min={typeof c.min === "string" ? c.min.slice(0, 16) : undefined} max={typeof c.max === "string" ? c.max.slice(0, 16) : undefined}
          onChange={(e) => emit(e.target.value === "" ? null : { value: e.target.value })} className={`${fieldBase} ${touch} max-w-[16rem]`}
        />
      );
      break;
    case "na":
      main = (
        <label className={`flex ${touch} items-center gap-3 text-sm text-[var(--cmp-app-text)]`}>
          <input
            type="checkbox" checked={value?.state === "not_applicable"} disabled={disabled}
            onChange={(e) => emit(e.target.checked ? { state: "not_applicable", reason: value?.reason ?? "" } : null)}
            className={`h-5 w-5 accent-[var(--cmp-theme-accent)] ${focusRing}`}
          />
          <span>{stateLabel(spec, "not_applicable")}</span>
        </label>
      );
      break;
    case "evidence": {
      const n = evidence?.count ?? (typeof value?.value === "number" ? value.value : 0);
      main = (
        <div className="flex flex-wrap items-center gap-2">
          <Chip tone={n > 0 ? "success" : "neutral"}>{n} attached</Chip>
          {evidence?.onAttach ? <Btn size="sm" disabled={disabled} onClick={evidence.onAttach}>Attach evidence</Btn> : null}
          {!evidence ? (
            <NumberBox id={`${idBase}-num`} label={`${label}: number attached`} value={typeof value?.value === "number" ? value.value : null} min={0} step={1} disabled={disabled} onCommit={(v) => emit(v === null ? null : { value: v })} />
          ) : null}
        </div>
      );
      break;
    }
  }

  const reasonOn = value?.state === "not_applicable";
  const reasonRequired = !!c.naReasonRequired;
  const reasonLabel = `${stateLabel(spec, "not_applicable")} reason`;
  const reasonIssue = issues.filter((i) => i.code === "reason_required");
  const otherIssues = issues.filter((i) => i.code !== "reason_required");

  return (
    <div className="flex min-w-0 flex-col gap-2" data-field={spec.field_key}>
      {main}
      {!hideStates && type !== "na" ? <StateControls spec={spec} value={value} onChange={emit} disabled={disabled} /> : null}
      {reasonOn ? (
        <div className="flex flex-col gap-1">
          <label htmlFor={`${idBase}-reason`} className={`text-xs font-semibold ${mutedText}`}>{reasonLabel}{reasonRequired ? " (required)" : " (optional)"}</label>
          <input
            id={`${idBase}-reason`} type="text" value={value?.reason ?? ""} disabled={disabled} aria-required={reasonRequired || undefined}
            aria-invalid={reasonIssue.length > 0 || undefined} onChange={(e) => emit({ state: "not_applicable", reason: e.target.value })}
            className={`${fieldBase} ${touch}`}
          />
          {reasonIssue.map((i, k) => <p key={k} role="alert" className="text-xs text-[var(--cmp-text-error)]">{i.message}</p>)}
        </div>
      ) : null}
      {otherIssues.map((i, k) => <p key={k} role="alert" className="text-xs text-[var(--cmp-text-error)]">{i.message}</p>)}
    </div>
  );
}

/** Not answered / Not observed / Not applicable / Unable to demonstrate / Unable to determine. Labels from stateLabel(). */
export function StateControls({ spec, value, onChange, disabled }: { spec: FieldSpec; value: ResponseValue | null; onChange: (next: ResponseValue | null) => void; disabled?: boolean }) {
  const states = allowedStates(spec).filter((s) => s !== "not_assessed");
  const answered = value != null && value.state !== "not_assessed";
  if (states.length === 0) {
    return answered ? <div><Btn size="sm" kind="ghost" disabled={disabled} onClick={() => onChange(null)}>Clear answer</Btn></div> : null;
  }
  const pick = (s: StateCode) => onChange({ state: s, reason: s === "not_applicable" ? (value?.state === "not_applicable" ? value.reason ?? "" : "") : undefined });
  const empty = !answered;
  const btn = (on: boolean) => `inline-flex ${touchSm} items-center rounded-full border px-3 text-sm font-medium disabled:opacity-50 ${focusRing} ${on ? "border-[var(--cmp-theme-accent)] bg-[var(--cmp-theme-soft)] text-[var(--cmp-theme-ink)]" : "border-[var(--cmp-app-control-border)] bg-[var(--cmp-app-surface)] text-[var(--cmp-app-text)] hover:bg-[var(--cmp-app-bg)]"}`;
  return (
    <div role="group" aria-label="Other answers" className="flex flex-wrap gap-2">
      <button type="button" aria-pressed={empty} disabled={disabled} onClick={() => onChange(null)} className={btn(empty)}>{stateLabel(spec, "not_assessed")}</button>
      {states.map((s) => (
        <button key={s} type="button" aria-pressed={value?.state === s} disabled={disabled} onClick={() => pick(s)} className={btn(value?.state === s)}>{stateLabel(spec, s)}</button>
      ))}
    </div>
  );
}
