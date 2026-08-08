"use client";

import {
  fieldType, fieldOptions, fieldRules, validateAnswer, isBlankAnswer,
  type FormFieldLike,
} from "@/lib/practice/form-field";

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠ THE ONE FIELD RENDERER IN THIS PRODUCT, AND IT IS THE ANSWER TO "EXTEND OR BUILD A SECOND?"
//
// Before this file there was no renderer to reuse. There was an INLINE TERNARY inside
// RegistrationForm.tsx that handled three of the nine field types a practice can author:
//
//     f.field_type === "select"  ? <select>
//   : f.field_type === "boolean" ? <input type=checkbox>
//   : <input type={number|date|text}>
//
// So `multi_select` drew a single-line text box, `long_text` drew a single-line text box, and `phone` and
// `email` drew untyped text. A practice that authored "Which of these apply?" as a multi-select got a box
// somebody typed prose into, and the stored answer was a sentence where the server expected a list.
//
// Phase 3 does not put a second renderer beside that one. It extracts THIS, teaches it all eleven types,
// and RegistrationForm.tsx now calls it -- so the practice's own questions are drawn the same way on the
// registration desk and on a consent form, by one component, validated by one function.
//
// ⚠ THE BEHAVIOUR CHANGE THIS CAUSES ON A LIVE SCREEN, DECLARED: a multi-select on the registration form
// now stores the LIST of values chosen rather than whatever was typed into a text box. That is a fix and
// it is also a change to what lands in practice_patient.custom_fields for that one field type.
//
// ⚠ IT VALIDATES WITH THE SERVER'S OWN FUNCTION. `validateAnswer` is the same function object the engine
// calls before it writes. A second copy of a range rule in the browser is a rule that will one day differ
// from the one that matters, and the one that matters is always the server's.
//
// ⚠ AND IT NEVER OWNS THE VALUE. Every change goes back out through `onChange` so that the caller's own
// single write path -- the one that throws away a withdrawn question's answer -- cannot be bypassed by a
// control writing to state directly.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

const CONTROL =
  "w-full rounded-lg border border-gray-200 px-2.5 py-2 text-[13px] outline-none focus:border-[var(--cp-primary)] focus:ring-2 focus:ring-[var(--cp-primary)]/10 disabled:bg-gray-50 disabled:text-gray-500";

export type FormFieldInputProps = {
  field: FormFieldLike;
  value: unknown;
  onChange: (value: unknown) => void;
  disabled?: boolean;
  /**
   * A calculated question has no control. The caller passes the figure and the sentence beside it, both
   * worked out by `calculatedValues` -- never by this component, which would be a second implementation.
   */
  calculated?: { value: number; notice: string; complete: boolean; problem: string | null } | null;
  /** Show the problem with what is currently entered. Off while a box has never been touched. */
  showProblem?: boolean;
};

export default function FormFieldInput({
  field, value, onChange, disabled = false, calculated = null, showProblem = true,
}: FormFieldInputProps) {
  const type = fieldType(field.field_type);
  const rules = fieldRules(field);
  const options = fieldOptions(field);

  // ⚠ AN UNKNOWN TYPE DRAWS NOTHING AND SAYS SO. Falling back to a text box would collect an answer
  // nobody can interpret, and it would be read later as though it had been the right question.
  if (!type)
    return (
      <p className="rounded-lg border border-dashed border-rose-300 bg-rose-50/70 px-2.5 py-2 text-[12px] text-rose-800">
        This question is a &ldquo;{field.field_type}&rdquo;, which this build cannot draw or store. Nothing
        is collected for it.
      </p>
    );

  if (type.valueKind === "derived") {
    return (
      <div className="rounded-lg border border-sky-200 bg-sky-50/70 px-2.5 py-2">
        {calculated?.problem ? (
          <p className="text-[12px] text-rose-800">{calculated.problem}</p>
        ) : (
          <>
            <p className="text-[15px] font-bold text-sky-900">
              <span aria-hidden className="mr-1.5 text-[12px]">Σ</span>
              {calculated ? calculated.value : "—"}
            </p>
            {/* ⚠ THE SENTENCE IS NOT OPTIONAL. A total with nothing beside it is a total somebody quotes. */}
            <p className={`mt-0.5 text-[11.5px] leading-relaxed ${calculated && !calculated.complete ? "text-amber-800" : "text-sky-800"}`}>
              {calculated?.notice ?? "Nothing has been entered for this to work from yet."}
            </p>
          </>
        )}
      </div>
    );
  }

  const problem = showProblem && !isBlankAnswer(value) ? validateAnswer(field, value) : null;

  const control = (() => {
    switch (field.field_type) {
      case "long_text":
        return (
          <textarea rows={3} disabled={disabled} value={value === null || value === undefined ? "" : String(value)}
            onChange={e => onChange(e.target.value)}
            maxLength={rules.maxLength} className={CONTROL} />
        );
      case "select":
        return (
          <select disabled={disabled} value={value === null || value === undefined ? "" : String(value)}
            onChange={e => onChange(e.target.value)} className={CONTROL}>
            <option value="">—</option>
            {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        );
      case "multi_select": {
        // ⚠ TICK BOXES, NOT A TEXT BOX. The stored answer is a list of the values chosen, in the order the
        // options were authored, so two people who chose the same three things store the same answer.
        const chosen = new Set((Array.isArray(value) ? value : []).map(v => String(v)));
        return (
          <div className="flex flex-col gap-1 rounded-lg border border-gray-200 p-2">
            {options.length === 0 && (
              <p className="text-[11.5px] text-amber-800">This list has nothing in it, so nothing can be chosen.</p>
            )}
            {options.map(o => (
              <label key={o.value} className="flex items-center gap-1.5 text-[12.5px] text-gray-700">
                <input type="checkbox" disabled={disabled} checked={chosen.has(o.value)}
                  onChange={e => {
                    const next = new Set(chosen);
                    if (e.target.checked) next.add(o.value); else next.delete(o.value);
                    onChange(options.map(x => x.value).filter(v => next.has(v)));
                  }} />
                {o.label}
              </label>
            ))}
          </div>
        );
      }
      case "boolean":
        return (
          <span className="flex items-center gap-1.5 text-[13px] text-gray-700">
            <input type="checkbox" disabled={disabled} checked={value === true}
              onChange={e => onChange(e.target.checked)} />
            Yes
          </span>
        );
      case "number":
        return (
          <input type="number" disabled={disabled} value={value === null || value === undefined ? "" : String(value)}
            min={rules.min} max={rules.max}
            onChange={e => onChange(e.target.value === "" ? "" : Number(e.target.value))}
            className={CONTROL} />
        );
      case "date":
        return (
          <input type="date" disabled={disabled} value={value === null || value === undefined ? "" : String(value)}
            min={rules.earliest} max={rules.latest}
            onChange={e => onChange(e.target.value)} className={CONTROL} />
        );
      case "time":
        return (
          <input type="time" disabled={disabled} value={value === null || value === undefined ? "" : String(value)}
            onChange={e => onChange(e.target.value)} className={CONTROL} />
        );
      default:
        return (
          <input
            type={field.field_type === "email" ? "email" : field.field_type === "phone" ? "tel" : "text"}
            disabled={disabled} value={value === null || value === undefined ? "" : String(value)}
            maxLength={rules.maxLength}
            onChange={e => onChange(e.target.value)} className={CONTROL} />
        );
    }
  })();

  return (
    <>
      {control}
      {/* ⚠ THE RULE IS SHOWN BEFORE IT IS BROKEN, not only afterwards. A lowest and a highest nobody can
          see is a refusal that arrives with no way to act on it. */}
      {(rules.min !== undefined || rules.max !== undefined) && (
        <span className="mt-0.5 block text-[11px] font-normal text-gray-400">
          {rules.min !== undefined && rules.max !== undefined
            ? `Between ${rules.min} and ${rules.max}.`
            : rules.min !== undefined ? `${rules.min} or more.` : `${rules.max} or less.`}
        </span>
      )}
      {(rules.earliest || rules.latest) && (
        <span className="mt-0.5 block text-[11px] font-normal text-gray-400">
          {rules.earliest && rules.latest ? `Between ${rules.earliest} and ${rules.latest}.`
            : rules.earliest ? `Not before ${rules.earliest}.` : `Not after ${rules.latest}.`}
        </span>
      )}
      {problem && !problem.ok && (
        <span className="mt-1 block text-[11.5px] font-normal text-rose-700">{problem.message}</span>
      )}
    </>
  );
}
