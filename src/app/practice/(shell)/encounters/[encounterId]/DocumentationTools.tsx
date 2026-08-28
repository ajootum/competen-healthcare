"use client";

import { useState } from "react";
import { CALCULATORS } from "@/lib/practice/clinical-calculators";

// CPR-130's "Documentation tools" panel, as the comp lays it out: calculators, attachments and the
// phrase library. Voice dictation is already on each segment; AI write-assist is CPR-210 and is not
// built.
//
// A CALCULATOR RESULT IS INSERTED AS A SENTENCE CARRYING ITS INPUTS, never as a bare number. "eGFR 36"
// in a record cannot be checked by anybody, including the person who wrote it; "eGFR 36 mL/min/1.73m2
// (CKD-EPI 2021; creatinine 1.60 mg/dL, age 62, female)" can. The engine builds that sentence; this
// panel only ever inserts what it returns.
//
// NOTHING HERE WRITES TO THE RECORD BY ITSELF. A calculator result lands in the note box, unsaved, where
// the practitioner reads it and saves it or does not.

// CPR-MOB-001 s4/s16 — the clinical calculators behind this string are numeric entry (they already
// carry type="number" inputMode="decimal", which is what s16 asks for); what they lacked was a target
// big enough to hit. `max-md:` only, so the desktop tools are unchanged.
const input = "w-full rounded-lg border border-gray-200 bg-white text-gray-900 placeholder:text-gray-400 px-2.5 py-2 text-[13px] outline-none focus:border-[var(--cp-primary)] focus:ring-2 focus:ring-[var(--cp-primary)]/10 max-md:min-h-[var(--cp-touch)] max-md:text-[16px]";

type Phrase = { id: string; shortcut: string; body: string; scope: string; description: string | null };

export default function DocumentationTools({
  editable, segments, phrases, onInsert,
}: {
  editable: boolean;
  segments: readonly string[];
  phrases: Phrase[];
  onInsert: (noteType: string, text: string) => void;
}) {
  const [open, setOpen] = useState<"calc" | "phrases" | null>(null);
  const [calcKey, setCalcKey] = useState(CALCULATORS[0].key);
  const [values, setValues] = useState<Record<string, string>>({});
  const [target, setTarget] = useState(segments[0] ?? "narrative");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [newPhrase, setNewPhrase] = useState({ shortcut: "", body: "", shared: false });

  const calc = CALCULATORS.find(c => c.key === calcKey)!;
  const result = calc.compute(values);

  async function addPhrase() {
    setBusy(true); setNotice(null);
    const res = await fetch("/api/v1/practice/smart-phrases", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(newPhrase),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setNotice(data?.error?.message ?? "That did not work."); setBusy(false); return; }
    window.location.reload();
  }

  const tab = (k: "calc" | "phrases", label: string, n?: number) => (
    <button type="button" onClick={() => setOpen(open === k ? null : k)}
      aria-expanded={open === k}
      className={`rounded-lg border px-3 py-1.5 text-[12px] font-semibold ${
        open === k ? "border-[var(--cp-primary)] bg-[var(--cp-primary-soft)] text-[var(--cp-primary-deep)]"
          : "border-gray-200 text-gray-700 hover:bg-gray-50"}`}>
      {label}{n ? ` (${n})` : ""}
    </button>
  );

  return (
    <section className="mt-4 rounded-xl border border-gray-200 bg-white p-4">
      <h2 className="text-[13px] font-bold text-gray-900">Documentation tools</h2>
      <div className="mt-2 flex flex-wrap gap-2">
        {tab("calc", "Clinical calculators")}
        {tab("phrases", "Smart text", phrases.length)}
        {/* The comp's fourth tile. CPR-210 is not built, so it says so rather than offering a button. */}
        <span className="rounded-lg border border-dashed border-gray-200 px-3 py-1.5 text-[12px] font-semibold text-gray-400"
          title="CPR-210 is not built">
          AI write assist &mdash; not built
        </span>
      </div>

      {notice && <p className="mt-2 rounded-lg bg-[var(--cmp-surface-critical)] px-2.5 py-2 text-[11px] text-[var(--cmp-text-critical)]">{notice}</p>}

      {open === "calc" && (
        <div className="mt-3 border-t border-gray-100 pt-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold text-gray-500">Calculator</span>
              <select value={calcKey} onChange={e => { setCalcKey(e.target.value); setValues({}); }} className={input}>
                {CALCULATORS.map(c => <option key={c.key} value={c.key}>{c.name}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold text-gray-500">Insert into</span>
              <select value={target} onChange={e => setTarget(e.target.value)} className={input}>
                {segments.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
          </div>

          <div className="mt-2 grid sm:grid-cols-2 gap-3">
            {calc.fields.map(f => (
              <label key={f.key} className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold text-gray-500">
                  {f.label}{f.unit ? ` (${f.unit})` : ""}
                </span>
                {f.kind === "select" ? (
                  <select value={values[f.key] ?? ""} onChange={e => setValues(v => ({ ...v, [f.key]: e.target.value }))} className={input}>
                    <option value="">Choose</option>
                    {(f.options ?? []).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                ) : (
                  <input type="number" inputMode="decimal" step={f.step} value={values[f.key] ?? ""}
                    onChange={e => setValues(v => ({ ...v, [f.key]: e.target.value }))} className={input} />
                )}
              </label>
            ))}
          </div>

          <p className="mt-1 text-[10px] text-gray-500">{calc.formula}</p>

          <div className="mt-2 rounded-lg border border-gray-100 bg-gray-50/60 p-2">
            {result.ok ? (
              <p className="text-[12px] text-gray-800">{result.sentence}</p>
            ) : (
              <p className="text-[11px] text-gray-500">{result.message}</p>
            )}
          </div>

          <button type="button" disabled={!result.ok || !editable}
            onClick={() => { if (result.ok) { onInsert(target, result.sentence); setOpen(null); } }}
            className="mt-2 rounded-lg bg-[var(--cp-primary)] px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-40">
            Insert into the note
          </button>
          <p className="mt-1 text-[10px] text-gray-500">
            {/* Two things a reader of this panel should know without asking. */}
            The sentence carries the numbers you typed, so anybody reading the note later can check it.
            Nothing is written to the record until you save the segment.
          </p>
        </div>
      )}

      {open === "phrases" && (
        <div className="mt-3 border-t border-gray-100 pt-3">
          {phrases.length === 0 ? (
            <p className="text-[12px] text-gray-400">No phrases yet.</p>
          ) : (
            <ul className="flex flex-col">
              {phrases.map(p => (
                <li key={p.id} className="flex items-baseline gap-2 border-b border-gray-100 py-1.5 last:border-0">
                  <code className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[11px] text-gray-700">{p.shortcut}</code>
                  <span className="min-w-0 truncate text-[11px] text-gray-600">{p.body}</span>
                  <span className="ml-auto shrink-0 text-[10px] text-gray-400">{p.scope}</span>
                </li>
              ))}
            </ul>
          )}

          {editable && (
            <div className="mt-2 flex flex-col gap-2">
              <div className="flex gap-2">
                <input value={newPhrase.shortcut} placeholder=".exam"
                  onChange={e => setNewPhrase(p => ({ ...p, shortcut: e.target.value }))} className={`${input} w-32`} />
                <input value={newPhrase.body} placeholder="What it expands to"
                  onChange={e => setNewPhrase(p => ({ ...p, body: e.target.value }))} className={input} />
              </div>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-[11px] text-gray-600">
                  <input type="checkbox" checked={newPhrase.shared}
                    onChange={e => setNewPhrase(p => ({ ...p, shared: e.target.checked }))} />
                  Share with the practice
                </label>
                <button type="button" disabled={busy || !newPhrase.shortcut.trim() || !newPhrase.body.trim()}
                  onClick={addPhrase}
                  className="rounded-lg border border-gray-200 px-3 py-1.5 text-[12px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-40">
                  Add
                </button>
              </div>
            </div>
          )}
          <p className="mt-1 text-[10px] text-gray-500">
            Type a shortcut on its own in any segment and press <strong>Expand</strong>. A shortcut inside
            a word is left alone &mdash; nothing rewrites your text without you seeing it first.
          </p>
        </div>
      )}
    </section>
  );
}
