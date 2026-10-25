"use client";

import { useState } from "react";
import { Field, inputCls } from "./forms";

// One professional-context question (COMPETEN-PROFESSIONAL-PROFILE-01): a choice from the configured list with
// "Other" to type it, free text when nothing is configured, or a number. The configured list and whether it is
// required come from the Individual policy, on the server. Posts `<key>` (the code) and `<key>Text` (typed).

export type FieldProps = {
  name: string; label: string; required: boolean; input: "choice" | "text" | "number";
  options: { code: string; label: string }[];
  /** The value on record: its code (when chosen from a list) and its label. */
  code: string | null; value: string | number | null;
  suggestions?: string[]; hint?: string;
};

export default function ContextField({ name, label, required, input, options, code, value, suggestions = [], hint }: FieldProps) {
  // A recorded value with no code (typed, or from a list since changed) opens on "Other", keeping the words.
  const initial = code && options.some(o => o.code === code) ? code : value != null && value !== "" ? "other" : "";
  const [choice, setChoice] = useState(initial);
  const id = `ctx-${name}`;
  const req = required ? " (required)" : " (optional)";

  if (input === "number")
    return (
      <Field label={label + req} htmlFor={id} hint={hint}>
        <input id={id} name={name} type="number" inputMode="numeric" min={0} max={70} step={1} defaultValue={value ?? ""} required={required} className={`${inputCls} max-w-[10rem]`} />
      </Field>
    );

  if (input === "text")
    return (
      <Field label={label + req} htmlFor={id} hint={hint}>
        <input id={id} name={name === "role" ? "role" : `${name}Text`} maxLength={name === "profession" ? 120 : 160} defaultValue={value ?? ""} required={required}
          className={inputCls} autoComplete="off" list={suggestions.length ? `${id}-list` : undefined} />
        {suggestions.length > 0 && <datalist id={`${id}-list`}>{suggestions.map(s => <option key={s} value={s} />)}</datalist>}
      </Field>
    );

  return (
    <Field label={label + req} htmlFor={id} hint={hint}>
      <select id={id} name={name} value={choice} onChange={e => setChoice(e.target.value)} required={required} className={inputCls}>
        <option value="">{required ? "Choose…" : "Not now"}</option>
        {options.map(o => <option key={o.code} value={o.code}>{o.label}</option>)}
        <option value="other">Other (type it)</option>
      </select>
      {choice === "other" && (
        <div className="mt-2">
          <label htmlFor={`${id}-text`} className="sr-only">{label}: your own words</label>
          <input id={`${id}-text`} name={`${name}Text`} maxLength={name === "profession" ? 120 : 160} defaultValue={initial === "other" ? String(value ?? "") : ""}
            required={required} placeholder="Type it" className={inputCls} autoComplete="off" />
        </div>
      )}
    </Field>
  );
}
