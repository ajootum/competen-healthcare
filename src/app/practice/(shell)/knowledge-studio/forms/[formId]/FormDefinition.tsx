"use client";

import { useState } from "react";
import { BUTTON } from "@/lib/practice/palette";
import {
  FORM_CHECK_SWATCH, FORM_STATE_SWATCH, FORM_ROUTE, FORM_SUBMISSION_NAME,
  PRACTICE_FIELD_TYPES, CALCULATIONS, formState, fieldType,
} from "@/lib/practice/form-constants";

// One form: its questions, its readiness, its lifecycle, and every form completed against it.
//
// ⚠ THE QUESTION EDITOR AUTHORS CONDITIONS AND CALCULATIONS AGAINST EARLIER QUESTIONS ONLY, and both
// dropdowns are built from the questions above the one being edited. That is not a UI nicety --
// CONDITIONS_RESOLVE and CALCULATIONS_RESOLVE refuse a backwards reference at publish, because such a
// rule can never be true when its own question is reached, and forbidding it is also what makes a loop
// impossible to author.
//
// ⚠ A CALCULATION MAY ONLY ADD UP EARLIER *NUMBER* QUESTIONS, and the picker offers only those. The
// engine refuses the rest anyway -- this is the better sentence in front of the same wall.

/* eslint-disable @typescript-eslint/no-explicit-any */

const CARD = "rounded-xl border border-gray-200 bg-white";
const FIELD = "w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-[13px] outline-none focus:border-[var(--cp-primary)] focus:ring-2 focus:ring-[var(--cp-primary)]/10";

type Draft = {
  fieldKey: string; label: string; section: string; help: string;
  fieldType: string; required: boolean;
  /** "value|Label" per line, which is the shape a practitioner can type without a JSON editor. */
  optionsText: string;
  min: string; max: string; minLength: string; maxLength: string; earliest: string; latest: string;
  calcOf: string; calcFields: string[];
  /** "" means unconditional. */
  whenKey: string;
  /** "equals" | "in" | "isPresent" */
  op: string;
  value: string;
};

const optionsToText = (options: unknown): string =>
  (Array.isArray(options) ? options : [])
    .map((o: any) => (o && typeof o === "object" ? `${o.value}|${o.label ?? o.value}` : String(o)))
    .join("\n");

const textToOptions = (text: string) =>
  text.split("\n").map(l => l.trim()).filter(Boolean).map(l => {
    const [value, ...rest] = l.split("|");
    return { value: value.trim(), label: (rest.join("|").trim() || value.trim()) };
  });

const toDraft = (f: any): Draft => {
  const c = f.condition && typeof f.condition === "object" ? f.condition : null;
  const op = !c ? "" : "isPresent" in c ? "isPresent" : "in" in c ? "in" : "equals";
  const r = f.rules && typeof f.rules === "object" ? f.rules : {};
  return {
    fieldKey: f.field_key, label: f.label, section: f.section ?? "", help: f.help ?? "",
    fieldType: f.field_type, required: f.required !== false,
    optionsText: optionsToText(f.options),
    min: r.min ?? r.min === 0 ? String(r.min ?? "") : "",
    max: r.max ?? r.max === 0 ? String(r.max ?? "") : "",
    minLength: r.minLength !== undefined ? String(r.minLength) : "",
    maxLength: r.maxLength !== undefined ? String(r.maxLength) : "",
    earliest: r.earliest ?? "", latest: r.latest ?? "",
    calcOf: r.calculate?.of ?? CALCULATIONS[0].code,
    calcFields: Array.isArray(r.calculate?.fields) ? r.calculate.fields.map(String) : [],
    whenKey: c?.when ?? "", op,
    value: !c ? ""
      : op === "isPresent" ? String(c.isPresent === false ? "false" : "true")
      : op === "in" ? (Array.isArray(c.in) ? c.in.map(String).join(",") : "")
      : String(c.equals ?? ""),
  };
};

const toCondition = (d: Draft): unknown => {
  if (!d.whenKey || !d.op) return null;
  if (d.op === "isPresent") return { when: d.whenKey, isPresent: d.value !== "false" };
  if (d.op === "in") return { when: d.whenKey, in: d.value.split(",").map(v => v.trim()).filter(Boolean) };
  return { when: d.whenKey, equals: d.value };
};

const toRules = (d: Draft): unknown => {
  const kind = fieldType(d.fieldType)?.valueKind;
  const r: Record<string, unknown> = {};
  if (kind === "derived") {
    if (d.calcFields.length === 0) return null;
    return { calculate: { of: d.calcOf, fields: d.calcFields } };
  }
  if (kind === "number") {
    if (d.min.trim() !== "") r.min = Number(d.min);
    if (d.max.trim() !== "") r.max = Number(d.max);
  }
  if (kind === "date") {
    if (d.earliest) r.earliest = d.earliest;
    if (d.latest) r.latest = d.latest;
  }
  if (kind === "text") {
    if (d.minLength.trim() !== "") r.minLength = Number(d.minLength);
    if (d.maxLength.trim() !== "") r.maxLength = Number(d.maxLength);
  }
  return Object.keys(r).length ? r : null;
};

export default function FormDefinition({ detail, canManage, canFill, colleagues }: {
  detail: any;
  canManage: boolean;
  canFill: boolean;
  colleagues: { id: string; name: string }[];
}) {
  const doc = detail.form;
  const [drafts, setDrafts] = useState<Draft[]>(() => (detail.fields ?? []).map(toDraft));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assignee, setAssignee] = useState(colleagues[0]?.id ?? "");
  const [reason, setReason] = useState("");
  const [patientId, setPatientId] = useState("");
  const [contextNote, setContextNote] = useState("");

  const editable = !!doc?.editable;
  const swatch = FORM_STATE_SWATCH[doc?.status] ?? FORM_STATE_SWATCH.draft;

  // ⚠ THE STORE-ABSENT AND FAILED STATES COME FIRST AND OFFER NOTHING. Same rule as the library.
  if (detail.state !== "ok" || !doc) {
    return (
      <section className={`rounded-xl border p-4 ${detail.state === "failed" ? "border-rose-200 bg-rose-50/70" : "border-amber-200 bg-amber-50/70"}`}>
        <h1 className="text-[14px] font-bold text-gray-900">
          {detail.state === "failed" ? "This form could not be read." : "There is nowhere to store a form yet."}
        </h1>
        <p className="mt-1.5 max-w-3xl text-[12px] leading-relaxed text-gray-700">
          {detail.state === "failed"
            ? "A failed read is not an empty form. Nothing is shown because nothing is known."
            : "The tables this module writes to have not been created in this deployment."}
        </p>
        {detail.detail && (
          <p className="mt-2 rounded-lg bg-white/70 px-2.5 py-1.5 font-mono text-[11px] text-gray-700">{detail.detail}</p>
        )}
        <a href={FORM_ROUTE} className="mt-3 inline-block text-[12px] text-gray-600 hover:underline">
          &larr; Back to the library
        </a>
      </section>
    );
  }

  async function call(url: string, body: unknown, method = "POST") {
    setBusy(true); setError(null);
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setError(data?.error?.message ?? "That did not work."); return null; }
    return data;
  }

  async function saveFields() {
    const out = await call(`/api/v1/practice/forms/${doc.id}`, {
      fields: drafts.map(d => ({
        fieldKey: d.fieldKey, label: d.label, section: d.section || null, help: d.help || null,
        fieldType: d.fieldType, required: d.required,
        options: fieldType(d.fieldType)?.needsOptions ? textToOptions(d.optionsText) : [],
        rules: toRules(d), condition: toCondition(d),
      })),
    }, "PATCH");
    if (out) window.location.reload();
  }

  async function move(action: string, extra: Record<string, unknown> = {}) {
    const out = await call(`/api/v1/practice/forms/${doc.id}/lifecycle`, { action, ...extra });
    if (out) window.location.reload();
  }

  async function startSubmission() {
    const out = await call(`/api/v1/practice/forms/${doc.id}/submissions`, {
      patientId: patientId || null, contextNote: contextNote || null,
    });
    if (out) window.location.href = `${FORM_ROUTE}/${doc.id}/submissions/${out.id}`;
  }

  const readiness = detail.readiness;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-[12px] text-gray-500">
        <a href={FORM_ROUTE} className="hover:underline">&larr; Form Library</a>
        <a href={`${FORM_ROUTE}/${doc.id}/print`} className="ml-auto hover:underline">Print a blank copy</a>
      </div>

      <header>
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="font-mono text-[12px] text-gray-500">{doc.code}</span>
          <h1 className="text-[18px] font-bold text-gray-900">{doc.title}</h1>
          <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-bold ${swatch.chip}`}>{doc.stateLabel}</span>
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10.5px] font-semibold text-gray-600">{doc.kindLabel}</span>
          <span className="text-[11px] text-gray-400">v{doc.version}</span>
        </div>
        {doc.purpose && <p className="mt-1 max-w-3xl text-[12.5px] text-gray-600">{doc.purpose}</p>}
        {doc.stateMeaning && <p className="mt-1 max-w-3xl text-[11.5px] text-gray-500">{doc.stateMeaning}</p>}
      </header>

      {/* ⚠ THE STANDING NOTICE, ON THE FORM ITSELF. */}
      <section className="rounded-xl border border-dashed border-slate-300 bg-slate-50/70 p-3">
        <p className="text-[12.5px] font-bold text-slate-800">
          <span aria-hidden className="mr-1.5">◌</span>{detail.notVerified.headline}
        </p>
        <p className="mt-1 max-w-3xl text-[12px] leading-relaxed text-slate-600">{detail.notVerified.detail}</p>
      </section>

      {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-[12.5px] text-rose-800">{error}</p>}

      {/* ── THE QUESTIONS ────────────────────────────────────────────────────────────────────────── */}
      <section className={`${CARD} p-3.5`}>
        <h2 className="text-[13px] font-bold text-gray-900">
          The questions
          <span className="ml-2 font-normal text-gray-500">{drafts.length}</span>
        </h2>
        {!editable && (
          <p className="mt-1 text-[11.5px] leading-relaxed text-gray-500">
            This form is {String(doc.stateLabel).toLowerCase()} and its questions cannot be changed.
            {doc.status === "published"
              ? " Start a new version instead -- the one in use stays exactly as it was approved, and so does every form completed against it."
              : ""}
          </p>
        )}

        {drafts.length === 0 && (
          <p className="mt-2 rounded-lg border border-dashed border-slate-300 bg-slate-50/70 px-3 py-4 text-center text-[12.5px] text-slate-600">
            Nothing to answer yet. A form with no questions cannot be put into use.
          </p>
        )}

        <ol className="mt-2 space-y-2">
          {drafts.map((d, i) => {
            const kind = fieldType(d.fieldType)?.valueKind;
            const earlier = drafts.slice(0, i).filter(p => p.fieldKey);
            const earlierNumbers = earlier.filter(p => fieldType(p.fieldType)?.valueKind === "number");
            const set = (patch: Partial<Draft>) =>
              setDrafts(ds => ds.map((x, j) => j === i ? { ...x, ...patch } : x));
            return (
              <li key={i} className="rounded-lg border border-gray-200 p-2.5">
                <div className="grid gap-2 sm:grid-cols-[3rem_1fr]">
                  <span className="pt-2 text-[12px] font-semibold text-gray-400">{i + 1}.</span>
                  <div className="space-y-2">
                    <input value={d.label} disabled={!editable} placeholder="What is being asked"
                      onChange={e => set({ label: e.target.value })} className={FIELD} />

                    <div className="grid gap-2 sm:grid-cols-4">
                      <label className="block">
                        <span className="mb-1 block text-[10.5px] font-semibold text-gray-500">Name a rule can point at</span>
                        <input value={d.fieldKey} disabled={!editable} placeholder="weight_kg"
                          onChange={e => set({ fieldKey: e.target.value })}
                          className={`${FIELD} font-mono text-[12px]`} />
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-[10.5px] font-semibold text-gray-500">Kind of question</span>
                        <select value={d.fieldType} disabled={!editable}
                          onChange={e => set({ fieldType: e.target.value })} className={FIELD}>
                          {PRACTICE_FIELD_TYPES.map(t => <option key={t.code} value={t.code}>{t.label}</option>)}
                        </select>
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-[10.5px] font-semibold text-gray-500">Section</span>
                        <input value={d.section} disabled={!editable} placeholder="About the procedure"
                          onChange={e => set({ section: e.target.value })} className={FIELD} />
                      </label>
                      <div className="flex items-end pb-1.5">
                        <label className="flex items-center gap-1.5 text-[11.5px] text-gray-700">
                          <input type="checkbox" checked={d.required} disabled={!editable || kind === "derived"}
                            onChange={e => set({ required: e.target.checked })} />
                          Required
                        </label>
                      </div>
                    </div>

                    <input value={d.help} disabled={!editable} placeholder="A note under the question, if it needs one"
                      onChange={e => set({ help: e.target.value })} className={FIELD} />

                    {fieldType(d.fieldType)?.needsOptions && (
                      <label className="block">
                        <span className="mb-1 block text-[10.5px] font-semibold text-gray-500">
                          The choices, one per line, as value|Label
                        </span>
                        <textarea rows={3} value={d.optionsText} disabled={!editable}
                          placeholder={"yes|Agreed\nno|Declined"}
                          onChange={e => set({ optionsText: e.target.value })}
                          className={`${FIELD} font-mono text-[12px]`} />
                        <span className="mt-0.5 block text-[10.5px] text-gray-400">
                          A list with nothing in it is refused at publish -- it is a question with no answers.
                        </span>
                      </label>
                    )}

                    {/* ── THE RULES (section 4's Ranges) ────────────────────────────────────────── */}
                    {kind === "number" && (
                      <div className="grid gap-2 rounded-lg bg-gray-50 p-2 sm:grid-cols-2">
                        <label className="block">
                          <span className="mb-1 block text-[10.5px] font-semibold text-gray-500">Lowest</span>
                          <input type="number" value={d.min} disabled={!editable}
                            onChange={e => set({ min: e.target.value })} className={FIELD} />
                        </label>
                        <label className="block">
                          <span className="mb-1 block text-[10.5px] font-semibold text-gray-500">Highest</span>
                          <input type="number" value={d.max} disabled={!editable}
                            onChange={e => set({ max: e.target.value })} className={FIELD} />
                        </label>
                      </div>
                    )}
                    {kind === "date" && (
                      <div className="grid gap-2 rounded-lg bg-gray-50 p-2 sm:grid-cols-2">
                        <label className="block">
                          <span className="mb-1 block text-[10.5px] font-semibold text-gray-500">Earliest</span>
                          <input type="date" value={d.earliest} disabled={!editable}
                            onChange={e => set({ earliest: e.target.value })} className={FIELD} />
                        </label>
                        <label className="block">
                          <span className="mb-1 block text-[10.5px] font-semibold text-gray-500">Latest</span>
                          <input type="date" value={d.latest} disabled={!editable}
                            onChange={e => set({ latest: e.target.value })} className={FIELD} />
                        </label>
                      </div>
                    )}
                    {kind === "text" && (
                      <div className="grid gap-2 rounded-lg bg-gray-50 p-2 sm:grid-cols-2">
                        <label className="block">
                          <span className="mb-1 block text-[10.5px] font-semibold text-gray-500">Shortest</span>
                          <input type="number" value={d.minLength} disabled={!editable}
                            onChange={e => set({ minLength: e.target.value })} className={FIELD} />
                        </label>
                        <label className="block">
                          <span className="mb-1 block text-[10.5px] font-semibold text-gray-500">Longest</span>
                          <input type="number" value={d.maxLength} disabled={!editable}
                            onChange={e => set({ maxLength: e.target.value })} className={FIELD} />
                        </label>
                      </div>
                    )}

                    {/* ── THE CALCULATION. ⚠ EARLIER QUESTIONS ONLY, and numbers only when adding up. */}
                    {kind === "derived" && (
                      <div className="rounded-lg bg-sky-50 p-2">
                        <div className="grid gap-2 sm:grid-cols-2">
                          <label className="block">
                            <span className="mb-1 block text-[10.5px] font-semibold text-gray-500">What it does</span>
                            <select value={d.calcOf} disabled={!editable}
                              onChange={e => set({ calcOf: e.target.value, calcFields: [] })} className={FIELD}>
                              {CALCULATIONS.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
                            </select>
                          </label>
                          <p className="self-end pb-1 text-[10.5px] leading-relaxed text-sky-900">
                            {CALCULATIONS.find(c => c.code === d.calcOf)?.meaning}
                          </p>
                        </div>
                        <p className="mt-2 text-[10.5px] font-semibold text-gray-500">
                          Which earlier answers it uses
                        </p>
                        <div className="mt-1 flex flex-col gap-1">
                          {(d.calcOf === "sum" ? earlierNumbers : earlier).length === 0 && (
                            <p className="text-[11.5px] text-amber-800">
                              {d.calcOf === "sum"
                                ? "There are no number questions above this one, so there is nothing it could add up."
                                : "There are no questions above this one."}
                            </p>
                          )}
                          {(d.calcOf === "sum" ? earlierNumbers : earlier).map(p => (
                            <label key={p.fieldKey} className="flex items-center gap-1.5 text-[12px] text-gray-700">
                              <input type="checkbox" disabled={!editable}
                                checked={d.calcFields.includes(p.fieldKey)}
                                onChange={e => set({
                                  calcFields: e.target.checked
                                    ? [...d.calcFields, p.fieldKey]
                                    : d.calcFields.filter(k => k !== p.fieldKey),
                                })} />
                              {p.label || p.fieldKey}
                            </label>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* ⚠ EARLIER QUESTIONS ONLY. See the header. */}
                    <div className="grid gap-2 rounded-lg bg-gray-50 p-2 sm:grid-cols-3">
                      <label className="block">
                        <span className="mb-1 block text-[10.5px] font-semibold text-gray-500">Only ask this when</span>
                        <select value={d.whenKey} disabled={!editable}
                          onChange={e => set({ whenKey: e.target.value, op: e.target.value ? (d.op || "equals") : "" })}
                          className={FIELD}>
                          <option value="">Always ask it</option>
                          {earlier.map(p => <option key={p.fieldKey} value={p.fieldKey}>{p.label || p.fieldKey}</option>)}
                        </select>
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-[10.5px] font-semibold text-gray-500">is</span>
                        <select value={d.op} disabled={!editable || !d.whenKey}
                          onChange={e => set({ op: e.target.value })} className={FIELD}>
                          <option value="equals">exactly</option>
                          <option value="in">any of</option>
                          <option value="isPresent">answered at all</option>
                        </select>
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-[10.5px] font-semibold text-gray-500">value</span>
                        {d.op === "isPresent" ? (
                          <select value={d.value} disabled={!editable || !d.whenKey}
                            onChange={e => set({ value: e.target.value })} className={FIELD}>
                            <option value="true">yes, it has been answered</option>
                            <option value="false">no, it has not</option>
                          </select>
                        ) : (
                          <input value={d.value} disabled={!editable || !d.whenKey}
                            placeholder={d.op === "in" ? "yes,maybe" : "yes"}
                            onChange={e => set({ value: e.target.value })}
                            className={`${FIELD} font-mono text-[12px]`} />
                        )}
                      </label>
                    </div>

                    {editable && (
                      <div className="flex gap-2">
                        <button type="button" disabled={i === 0}
                          onClick={() => setDrafts(ds => { const n = [...ds]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; return n; })}
                          className={`${BUTTON.quiet} rounded px-2 py-1 text-[11px] font-semibold disabled:opacity-40`}>Move up</button>
                        <button type="button" disabled={i === drafts.length - 1}
                          onClick={() => setDrafts(ds => { const n = [...ds]; [n[i], n[i + 1]] = [n[i + 1], n[i]]; return n; })}
                          className={`${BUTTON.quiet} rounded px-2 py-1 text-[11px] font-semibold disabled:opacity-40`}>Move down</button>
                        <button type="button"
                          onClick={() => setDrafts(ds => ds.filter((_, j) => j !== i))}
                          className={`${BUTTON.quiet} rounded px-2 py-1 text-[11px] font-semibold text-rose-700`}>Remove</button>
                      </div>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>

        {editable && canManage && (
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button"
              onClick={() => setDrafts(ds => [...ds, {
                fieldKey: `question_${ds.length + 1}`, label: "", section: "", help: "",
                fieldType: "text", required: true, optionsText: "",
                min: "", max: "", minLength: "", maxLength: "", earliest: "", latest: "",
                calcOf: CALCULATIONS[0].code, calcFields: [],
                whenKey: "", op: "", value: "",
              }])}
              className={`${BUTTON.quiet} rounded-lg px-3 py-1.5 text-[12.5px] font-semibold`}>Add a question</button>
            <button type="button" disabled={busy} onClick={saveFields}
              className={`${BUTTON.primary} rounded-lg px-3.5 py-1.5 text-[12.5px] font-semibold`}>
              {busy ? "Saving…" : "Save the questions"}
            </button>
          </div>
        )}
      </section>

      {/* ── READINESS ────────────────────────────────────────────────────────────────────────────── */}
      {readiness && (
        <section className={`${CARD} p-3.5`}>
          <h2 className="text-[13px] font-bold text-gray-900">Before this can be put into use</h2>
          <ul className="mt-2 space-y-1.5">
            {readiness.checks.map((c: any) => {
              const mark = FORM_CHECK_SWATCH[c.state] ?? FORM_CHECK_SWATCH.not_checked;
              return (
                <li key={c.code} className={`rounded-lg border p-2 ${mark.box}`}>
                  <p className={`text-[12px] font-semibold ${mark.text}`}>
                    <span aria-hidden className="mr-1.5">{mark.icon}</span>{c.requirement}
                    <span className="ml-2 rounded bg-white/70 px-1.5 text-[10px] font-bold uppercase tracking-wide text-gray-500">
                      {c.state === "not_checked" ? "not checked" : c.state}
                    </span>
                  </p>
                  <p className="mt-0.5 text-[11.5px] leading-relaxed text-gray-600">{c.detail}</p>
                  {c.wouldNeed && <p className="mt-0.5 text-[11px] text-gray-400">It would take: {c.wouldNeed}</p>}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* ── LIFECYCLE ────────────────────────────────────────────────────────────────────────────── */}
      {canManage && detail.moves.length > 0 && (
        <section className={`${CARD} p-3.5`}>
          <h2 className="text-[13px] font-bold text-gray-900">What can happen next</h2>
          <ul className="mt-2 space-y-2">
            {detail.moves.map((m: any) => (
              <li key={`${m.from}-${m.to}`} className="rounded-lg border border-gray-200 p-2.5">
                <p className="text-[12.5px] font-semibold text-gray-800">{m.label}</p>
                <p className="mt-0.5 text-[11.5px] leading-relaxed text-gray-600">{m.why}</p>
                {m.to === "in_review" && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <select value={assignee} onChange={e => setAssignee(e.target.value)} className={`${FIELD} max-w-[16rem]`}>
                      {colleagues.length === 0 && <option value="">No colleague to send it to</option>}
                      {colleagues.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                    <button disabled={busy} onClick={() => move("submit", { assignedTo: assignee || null })}
                      className={`${BUTTON.primary} rounded-lg px-3 py-1.5 text-[12px] font-semibold`}>Send</button>
                  </div>
                )}
                {m.to === "draft" && (
                  <button disabled={busy} onClick={() => move("withdraw")}
                    className={`${BUTTON.quiet} mt-2 rounded-lg px-3 py-1.5 text-[12px] font-semibold`}>Take it back</button>
                )}
                {m.to === "approved" && (
                  <button disabled={busy} onClick={() => move("sync")}
                    className={`${BUTTON.quiet} mt-2 rounded-lg px-3 py-1.5 text-[12px] font-semibold`}>Follow the decision</button>
                )}
                {m.to === "published" && (
                  <button disabled={busy} onClick={() => move("publish")}
                    className={`${BUTTON.primary} mt-2 rounded-lg px-3 py-1.5 text-[12px] font-semibold`}>Put it into use</button>
                )}
                {m.to === "archived" && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <input value={reason} onChange={e => setReason(e.target.value)}
                      placeholder="Why is it being withdrawn?" className={`${FIELD} max-w-[24rem]`} />
                    <button disabled={busy} onClick={() => move("archive", { reason })}
                      className={`${BUTTON.quiet} rounded-lg px-3 py-1.5 text-[12px] font-semibold text-rose-700`}>Withdraw</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
          {doc.status === "published" && (
            <button disabled={busy} onClick={() => move("revise")}
              className={`${BUTTON.quiet} mt-2 rounded-lg px-3 py-1.5 text-[12px] font-semibold`}>
              Start the next version
            </button>
          )}
        </section>
      )}

      {/* ── FILLING IT IN ────────────────────────────────────────────────────────────────────────── */}
      {doc.usable && canFill && (
        <section className={`${CARD} p-3.5`}>
          <h2 className="text-[13px] font-bold text-gray-900">Fill this in</h2>
          <p className="mt-1 text-[11.5px] leading-relaxed text-gray-500">
            Starts a {FORM_SUBMISSION_NAME} with your name on it and the time it began.
            {doc.subject === "patient"
              ? " This form is about one patient, so it needs the patient it is being filled in for."
              : " This form is not about a patient, so no patient may be recorded on it."}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {doc.subject === "patient" && (
              <input value={patientId} onChange={e => setPatientId(e.target.value)}
                placeholder="Patient" className={`${FIELD} max-w-[20rem]`} />
            )}
            <input value={contextNote} onChange={e => setContextNote(e.target.value)}
              placeholder="Clinic 2, morning list, room 4…" className={`${FIELD} max-w-[24rem]`} />
            <button disabled={busy} onClick={startSubmission}
              className={`${BUTTON.primary} rounded-lg px-3.5 py-1.5 text-[12.5px] font-semibold`}>Start</button>
          </div>
        </section>
      )}

      {/* ── THE COMPLETED FORMS ──────────────────────────────────────────────────────────────────── */}
      <section className={`${CARD} overflow-hidden`}>
        <h2 className="border-b border-gray-100 px-3.5 py-2 text-[12.5px] font-bold text-gray-900">
          Completed forms
          <span className="ml-2 font-normal text-gray-500">
            {detail.submissionsState === "failed" ? "could not be read" : detail.submissions.length}
          </span>
        </h2>
        {detail.submissionsState === "failed" ? (
          // ⚠ NOT "never used". A failed read is not a zero.
          <p className="p-4 text-[12.5px] text-rose-800">
            The forms completed against this one could not be read. That is not the same as this form
            never having been filled in, and nothing above should be read as a count.
          </p>
        ) : detail.submissions.length === 0 ? (
          <p className="p-6 text-center text-[12.5px] text-gray-500">Nobody has filled this in yet.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {detail.submissions.map((s: any) => (
              <li key={s.id}>
                <a href={s.href} className="block px-3.5 py-2.5 transition hover:bg-gray-50">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="text-[12.5px] font-semibold text-gray-900">
                      {String(s.started_at).slice(0, 16).replace("T", " ")}
                    </span>
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10.5px] font-semibold text-gray-600">
                      {s.stateLabel}
                    </span>
                    <span className="text-[11px] text-gray-400">against v{s.form_version}</span>
                  </div>
                  {s.context_note && <p className="mt-0.5 text-[12px] text-gray-600">{s.context_note}</p>}
                  {s.abandoned_reason && <p className="mt-0.5 text-[11.5px] text-amber-800">{s.abandoned_reason}</p>}
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── VERSIONS ─────────────────────────────────────────────────────────────────────────────── */}
      {detail.history.length > 0 && (
        <section className={`${CARD} p-3.5`}>
          <h2 className="text-[13px] font-bold text-gray-900">Other versions</h2>
          <ul className="mt-2 space-y-1">
            {detail.history.map((h: any) => (
              <li key={h.id} className="text-[12px]">
                <a href={`${FORM_ROUTE}/${h.id}`} className="text-gray-800 hover:underline">
                  v{h.version} &mdash; {formState(h.status)?.label ?? h.status}
                </a>
                <span className="text-gray-500"> ({h.relation})</span>
                {h.archived_reason && <span className="text-gray-400"> &mdash; {h.archived_reason}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
