"use client";

import { useCallback, useMemo, useState } from "react";
import { BUTTON } from "@/lib/practice/palette";
import FormFieldInput from "@/components/practice/FormFieldInput";
import { FORM_ROUTE, FORM_SUBMISSION_NAME, formClearedNotice } from "@/lib/practice/form-constants";
import {
  applicableFields, calculatedValues, calculationNotice, isBlankAnswer, fieldType,
} from "@/lib/practice/form-field";

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// FILLING A FORM IN. The conditional runtime, on the screen.
//
// ⚠ THIS COMPONENT IMPORTS THE EVALUATOR, THE VALIDATOR AND THE RENDERER. `applicableFields` is a thin
// adapter over `resolveApplicable` from registration-condition.ts -- the file that imports nothing, so a
// client component may reach for it without dragging node:crypto and next/headers into the bundle. The
// server's `recordAnswers` resolves through the same function object, validates with the same
// `validateAnswer`, and the same `FormFieldInput` draws the registration form's own custom questions.
// There is ONE of each in this product.
//
// ⚠ ONE WRITE PATH FOR EVERY ANSWER ON THIS SCREEN, AND IT IS WHERE A WITHDRAWN QUESTION'S ANSWER IS
// THROWN AWAY. Two reasons it is here rather than in an effect watching the state:
//
//   1. React 19 refuses it. Clearing state from an effect is a cascading render, and this project's lint
//      says so as an ERROR rather than a warning. The only thing that can withdraw a question is somebody
//      answering another one, which is an event.
//   2. ONE PLACE MEANS ONE PLACE TO GET WRONG. Every control below calls `answer`.
//
// ⚠ AND THE PAYLOAD IS A POSITIVE WHITELIST -- only the questions currently drawn. The SERVER clears too,
// against what is stored rather than what this sent, because a client is a claim and the store is the
// record.
//
// ⚠ A WORKED-OUT ANSWER IS NEVER SENT. It is derived here for the screen and derived again on the server
// for the record, from the same function, and it is stored nowhere -- so it cannot disagree with the
// answers under it.
//
// ⚠ MOBILE MODE IS CSS AND NOTHING IS HIDDEN BY IT. One column below the small breakpoint, and nothing
// on the form is dropped -- a form that hides questions on a phone is a form somebody submits without
// seeing them.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */

const CARD = "rounded-xl border border-gray-200 bg-white";
const FIELD = "w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-[13px] outline-none focus:border-[var(--cp-primary)] focus:ring-2 focus:ring-[var(--cp-primary)]/10";

export default function FormFill({ detail, formId, canFill }: {
  detail: any; formId: string; canFill: boolean;
}) {
  // ⚠ MEMOISED, because `detail.fields ?? []` is a new array object on every render and it is a
  // dependency of both the resolver and the one write path.
  const fields = useMemo<any[]>(() => detail.fields ?? [], [detail.fields]);

  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const byId = new Map(fields.map(f => [f.id, f.field_key]));
    const out: Record<string, unknown> = {};
    for (const a of (detail.answers ?? []) as any[]) {
      const key = byId.get(a.field_id);
      if (key !== undefined) out[key] = a.value;
    }
    return out;
  });
  const [clearedNote, setClearedNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const open = detail.submission?.open === true;

  const resolved = useMemo(() => applicableFields(fields, values), [fields, values]);
  const drawn = resolved.applicable;
  const withdrawn = fields.filter(f => !drawn.some((d: any) => d.field_key === f.field_key));

  // ⚠ DERIVED HERE, NEVER STORED, AND FROM THE WHOLE AUTHORED FORM rather than only what is drawn.
  // Handing in the drawn subset is what made a total collapse to nought as soon as a condition withdrew
  // one of its inputs. `calculatedValues` works out applicability itself, from the same resolver.
  const calculated = useMemo(
    () => new Map(calculatedValues(fields, values).map(c => [c.field_key, c])),
    [fields, values],
  );

  // ── THE ONE WRITE PATH ────────────────────────────────────────────────────────────────────────
  const answer = useCallback((fieldKey: string, value: unknown) => {
    const next = { ...values, [fieldKey]: value };
    const out = applicableFields(fields, next);
    const surviving = new Set(Object.keys(out.answers));
    const cleared = out.cleared;

    if (cleared.length === 0) { setValues(next); return; }

    // THE ANSWER GOES, AND IT IS SAID. A question disappearing takes what somebody entered with it, and a
    // screen that does neither of those things out loud is how a form loses a minute of work with no
    // account of where it went.
    const kept: Record<string, unknown> = {};
    for (const k of Object.keys(next)) if (surviving.has(k) || isBlankAnswer(next[k])) kept[k] = next[k];
    for (const c of cleared) delete kept[(c as any).field_key];
    setValues(kept);
    setClearedNote(formClearedNotice(cleared.map((c: any) => String(c.label ?? c.field_key))));
  }, [values, fields]);

  async function post(body: unknown) {
    setBusy(true); setError(null);
    const res = await fetch(`/api/v1/practice/form-submissions/${detail.submission.id}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setError(data?.error?.message ?? "That did not work."); return null; }
    return data;
  }

  // ⚠ THE WHITELIST. Only what is drawn, and never a worked-out answer -- nobody enters one and the
  // engine refuses it by name if anything tries.
  const payload = () => drawn
    .filter((f: any) => fieldType(f.field_type)?.valueKind !== "derived")
    .map((f: any) => ({ fieldKey: f.field_key, value: values[f.field_key] ?? null }));

  async function save() {
    const out = await post({ action: "record", answers: payload() });
    if (out) window.location.reload();
  }

  async function submit() {
    const saved = await post({ action: "record", answers: payload() });
    if (!saved) return;
    const out = await post({ action: "submit" });
    if (out) window.location.reload();
  }

  if (detail.state !== "ok" || !detail.submission) {
    return (
      <section className={`rounded-xl border p-4 ${detail.state === "failed" ? "border-rose-200 bg-rose-50/70" : "border-amber-200 bg-amber-50/70"}`}>
        <h1 className="text-[14px] font-bold text-gray-900">
          {detail.state === "failed" ? "This record could not be read." : "There is nowhere to store a completed form yet."}
        </h1>
        {detail.detail && (
          <p className="mt-2 rounded-lg bg-white/70 px-2.5 py-1.5 font-mono text-[11px] text-gray-700">{detail.detail}</p>
        )}
        <a href={`${FORM_ROUTE}/${formId}`} className="mt-3 inline-block text-[12px] text-gray-600 hover:underline">
          &larr; Back to the form
        </a>
      </section>
    );
  }

  const c = detail.completeness;
  // Read off the PREVIOUS ROW rather than carried in a mutable variable -- reassigning during a render is
  // an error in this project's lint, and rightly.
  const headingFor = (f: any, i: number, all: any[]) =>
    f.section && f.section !== (all[i - 1]?.section ?? null) ? f.section : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-[12px] text-gray-500">
        <a href={`${FORM_ROUTE}/${formId}`} className="hover:underline">&larr; {detail.form?.title ?? "The form"}</a>
        <a href={`${FORM_ROUTE}/${formId}/submissions/${detail.submission.id}/print`} className="ml-auto hover:underline">
          Print this record
        </a>
      </div>

      <header>
        <h1 className="text-[17px] font-bold text-gray-900">
          {detail.form?.title ?? "Form"}
          <span className="ml-2 text-[12px] font-normal text-gray-500">
            {detail.submission.stateLabel} &middot; against v{detail.submission.form_version}
          </span>
        </h1>
        <p className="mt-1 text-[12px] text-gray-600">
          Started {String(detail.submission.started_at).slice(0, 16).replace("T", " ")}
          {detail.submission.startedByName ? ` by ${detail.submission.startedByName}` : ""}
          {detail.submission.context_note ? ` · ${detail.submission.context_note}` : ""}
          {detail.submission.submitted_at
            ? ` · Submitted ${String(detail.submission.submitted_at).slice(0, 16).replace("T", " ")}${detail.submission.submittedByName ? ` by ${detail.submission.submittedByName}` : ""}`
            : ""}
        </p>
      </header>

      {/* ⚠ THE NOTICE, WHILE SOMEBODY IS ENTERING ANSWERS. Not only on the library. */}
      <section className="rounded-xl border border-dashed border-slate-300 bg-slate-50/70 p-3">
        <p className="text-[12.5px] font-bold text-slate-800">
          <span aria-hidden className="mr-1.5">◌</span>{detail.notVerified.headline}
        </p>
        <p className="mt-1 text-[12px] leading-relaxed text-slate-600">{detail.notVerified.detail}</p>
      </section>

      {clearedNote && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900">
          {clearedNote}
        </p>
      )}
      {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-[12.5px] text-rose-800">{error}</p>}

      {/* ── THE QUESTIONS ────────────────────────────────────────────────────────────────────────── */}
      <section className={`${CARD} divide-y divide-gray-100`}>
        {drawn.map((f: any, i: number, all: any[]) => {
          const heading = headingFor(f, i, all);
          const calc = calculated.get(f.field_key) ?? null;
          const isDerived = fieldType(f.field_type)?.valueKind === "derived";
          const missing = !isDerived && f.required !== false && isBlankAnswer(values[f.field_key]);
          return (
            <div key={f.id}>
              {heading && (
                <p className="bg-gray-50 px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-wide text-gray-500">
                  {heading}
                </p>
              )}
              <div className="p-3.5">
                <p className="text-[13px] font-semibold text-gray-900">
                  {f.label}
                  {f.required !== false && !isDerived && (
                    <span className="ml-1 text-rose-600" aria-hidden>*</span>
                  )}
                  {isDerived && (
                    <span className="ml-1.5 rounded bg-sky-100 px-1.5 text-[10px] font-bold text-sky-800">worked out</span>
                  )}
                </p>
                {f.help && <p className="mt-0.5 text-[11.5px] leading-relaxed text-gray-500">{f.help}</p>}

                <div className="mt-2">
                  <FormFieldInput
                    field={f}
                    value={values[f.field_key]}
                    onChange={v => answer(f.field_key, v)}
                    disabled={!open || !canFill || busy}
                    calculated={calc ? {
                      value: calc.value, notice: calculationNotice(calc),
                      complete: calc.complete, problem: calc.problem,
                    } : null}
                  />
                </div>

                {missing && open && (
                  <p className="mt-1 text-[11.5px] text-amber-800">
                    This one has to be answered before the form can be submitted.
                  </p>
                )}
              </div>
            </div>
          );
        })}

        {drawn.length === 0 && (
          <p className="p-6 text-center text-[12.5px] text-gray-500">
            There is nothing on this form to answer.
          </p>
        )}
      </section>

      {/* ⚠ WHAT DID NOT APPLY, NAMED. Not silence, and not an empty box beside the answered ones. */}
      {withdrawn.length > 0 && (
        <section className="rounded-xl border border-dashed border-slate-300 bg-slate-50/70 p-3">
          <p className="text-[12.5px] font-bold text-slate-800">
            <span aria-hidden className="mr-1.5">◌</span>
            {withdrawn.length === 1 ? "One question did not apply" : `${withdrawn.length} questions did not apply`}
          </p>
          <ul className="mt-1 space-y-0.5">
            {withdrawn.map((f: any) => (
              <li key={f.id} className="text-[12px] text-slate-600">
                {f.label}
                <span className="text-slate-400"> &mdash; withdrawn by an answer above, so it was never asked.</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── WHAT IS OUTSTANDING ──────────────────────────────────────────────────────────────────── */}
      {c && (
        <section className={`${CARD} p-3.5`}>
          <p className="text-[12.5px] text-gray-700">
            {c.answered} of {c.applicable} questions that apply have an answer.
          </p>
          {c.outstanding.length > 0 && (
            <div className="mt-2">
              <p className="text-[12px] font-semibold text-amber-800">Still needs an answer</p>
              <ul className="mt-0.5 space-y-0.5">
                {c.outstanding.map((f: any) => <li key={f.id} className="text-[12px] text-gray-600">{f.label}</li>)}
              </ul>
            </div>
          )}
          {c.invalid.length > 0 && (
            <div className="mt-2 rounded-lg border border-rose-200 bg-rose-50/70 p-2.5">
              <p className="text-[12px] font-bold text-rose-800">These answers do not satisfy their own question</p>
              <ul className="mt-0.5 space-y-0.5">
                {c.invalid.map((v: any) => <li key={v.field.id} className="text-[12px] text-rose-800">{v.message}</li>)}
              </ul>
            </div>
          )}
          {/* ⚠ A TOTAL THAT COULD NOT USE ALL OF ITS INPUTS IS NAMED, never quietly printed as finished. */}
          {c.calculated.filter((x: any) => !x.complete || x.problem).length > 0 && (
            <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50/70 p-2.5">
              <p className="text-[12px] font-bold text-amber-900">Worked-out answers that are not complete</p>
              <ul className="mt-0.5 space-y-0.5">
                {c.calculated.filter((x: any) => !x.complete || x.problem).map((x: any) => (
                  <li key={x.field_key} className="text-[12px] text-amber-900">
                    {/* ⚠ THE ONE SENTENCE, not a second one assembled here. This read
                        `does not include ${x.missing}` and would have printed an empty list the moment a
                        total was incomplete because an input was WITHDRAWN rather than missing -- the two
                        are different things and only calculationNotice knows how to say both. */}
                    {x.label} &mdash; {x.problem ?? calculationNotice(x)}
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-[11.5px] leading-relaxed text-amber-800">
                This does not stop the form being submitted. A missing answer is left out of the figure
                rather than counted as nought, and the figure says so wherever it appears.
              </p>
            </div>
          )}
        </section>
      )}

      {/* ── SUBMITTING IT ────────────────────────────────────────────────────────────────────────── */}
      {open && canFill && (
        <section className={`${CARD} p-3.5`}>
          <p className="text-[11.5px] leading-relaxed text-gray-500">
            Submitting records that you closed this {FORM_SUBMISSION_NAME} at this time. It is not a
            signature: nothing here captures a handwritten mark and nothing re-checks who is at the
            keyboard.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button disabled={busy} onClick={save}
              className={`${BUTTON.quiet} rounded-lg px-3.5 py-2 text-[12.5px] font-semibold`}>
              {busy ? "Saving…" : "Save what is answered so far"}
            </button>
            <button disabled={busy} onClick={submit}
              className={`${BUTTON.primary} rounded-lg px-3.5 py-2 text-[12.5px] font-semibold`}>
              Submit this {FORM_SUBMISSION_NAME}
            </button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2 border-t border-gray-100 pt-3">
            <input value={reason} onChange={e => setReason(e.target.value)}
              placeholder="If this is being abandoned, why?" className={`${FIELD} max-w-[26rem]`} />
            <button disabled={busy}
              onClick={async () => { const out = await post({ action: "abandon", reason }); if (out) window.location.reload(); }}
              className={`${BUTTON.quiet} rounded-lg px-3 py-2 text-[12.5px] font-semibold text-rose-700`}>
              Abandon it
            </button>
          </div>
        </section>
      )}

      {!open && (
        <p className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-[12.5px] text-gray-600">
          This record is {String(detail.submission.stateLabel).toLowerCase()}. What was recorded at the
          time is what it says, and it cannot be changed afterwards.
        </p>
      )}
    </div>
  );
}
