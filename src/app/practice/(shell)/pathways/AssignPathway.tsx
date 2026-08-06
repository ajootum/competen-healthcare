"use client";

import { useEffect, useState } from "react";
import { PATHWAY_TRIGGERS } from "@/lib/practice/pathways-constants";
import { BUTTON } from "@/lib/practice/palette";
import type { PathwayTemplate } from "@/lib/practice/pathways";

// CPR-FUP-003 s7 -- putting a patient on a plan.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠ THE ENTRY CRITERIA ARE SHOWN AND NEVER CHECKED, AND THAT IS THE WHOLE DESIGN.
//
// s5 lists entry criteria on the template and s2 says "not protocol enforcement" and
// "practitioner-controlled". A form that read the criteria and enabled or disabled the button would be
// the machine deciding who goes on a pathway. So the criteria are printed, in full, next to the choice
// -- a practitioner reads them and decides, and this form records what they decided. There is no code
// path anywhere in this module that evaluates them.
//
// THE TRIGGER IS RECORDED, NOT INFERRED. s7 lists six ways a pathway begins and they are facts about
// why somebody started it, which only they know.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

type Patient = { id: string; displayName?: string; display_name?: string };
const nameOf = (p: Patient) => p.displayName ?? p.display_name ?? "(unnamed)";

export default function AssignPathway({ templates, onClose }: {
  templates: PathwayTemplate[]; onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Patient[]>([]);
  const [incomplete, setIncomplete] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [patientId, setPatientId] = useState("");
  const [patientName, setPatientName] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [trigger, setTrigger] = useState("manual");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    // All state changes inside the timer callback; a synchronous setState in an effect body cascades.
    const timer = setTimeout(() => {
      if (!live) return;
      const q = query.trim();
      if (q.length < 2) { setResults([]); setIncomplete(null); setSearching(false); return; }
      setSearching(true);
      fetch(`/api/v1/practice/patients?q=${encodeURIComponent(q)}`)
        .then(r => r.json())
        .then(d => {
          if (!live) return;
          setResults((d?.results ?? []) as Patient[]);
          setIncomplete(d?.complete === false ? (d?.incompleteDetail ?? "one of the registry probes did not run") : null);
          setSearching(false);
        })
        .catch(() => live && setSearching(false));
    }, 250);
    return () => { live = false; clearTimeout(timer); };
  }, [query]);

  const chosen = templates.find(t => t.id === templateId) ?? null;
  const assignable = templates.filter(t => t.is_active);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const res = await fetch("/api/v1/practice/pathways/assignments", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ patientId, templateId, trigger, note: note.trim() || null }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setError(data?.error?.message ?? "That did not work."); setBusy(false); return; }
    window.location.reload();
  }

  const field = "w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-[13px] outline-none focus:border-[var(--cp-primary)] focus:ring-2 focus:ring-[var(--cp-primary)]/10";

  return (
    <form onSubmit={submit} className="rounded-xl border border-[var(--cp-primary)]/25 bg-[var(--cp-primary)]/[0.04] p-3">
      <h2 className="text-[13px] font-bold text-gray-900">Assign a pathway</h2>
      <p className="mt-0.5 max-w-3xl text-[11.5px] leading-relaxed text-gray-500">
        Putting somebody on a plan is a clinical decision. The entry criteria below are shown so you can
        read them; nothing here checks them, and nothing is assigned automatically.
      </p>

      <div className="mt-2.5 grid gap-2.5 lg:grid-cols-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-[11px] font-semibold text-gray-600">Patient</span>
          {patientId ? (
            <div className="flex items-center gap-2 rounded-lg border border-[var(--cp-primary)]/30 bg-white px-2.5 py-1.5">
              <span className="truncate text-[13px] font-semibold text-gray-800">{patientName}</span>
              <button type="button" onClick={() => { setPatientId(""); setPatientName(""); setQuery(""); }}
                className="ml-auto text-[11px] font-semibold text-gray-500 hover:text-gray-800">change</button>
            </div>
          ) : (
            <>
              <input value={query} onChange={e => setQuery(e.target.value)} className={field} placeholder="Search by name, phone or ID" />
              {query.trim().length >= 2 && (
                <div className="mt-1 max-h-36 overflow-y-auto rounded-lg border border-gray-200 bg-white">
                  {searching && <p className="px-2 py-1.5 text-[11.5px] text-gray-400">Searching&hellip;</p>}
                  {!searching && results.length === 0 && (
                    <p className="px-2 py-1.5 text-[11.5px] text-gray-400">
                      {incomplete ? "Nothing came back, and the search was incomplete." : "No patient matches that."}
                    </p>
                  )}
                  {results.map(p => (
                    <button key={p.id} type="button" onClick={() => { setPatientId(p.id); setPatientName(nameOf(p)); }}
                      className="block w-full px-2 py-1.5 text-left text-[12.5px] text-gray-700 hover:bg-gray-50">
                      {nameOf(p)}
                    </button>
                  ))}
                </div>
              )}
              {incomplete && (
                <span className="text-[10.5px] text-[var(--cmp-text-warning)]">
                  The registry search was incomplete, so an absent name does not mean the patient is not registered.
                </span>
              )}
            </>
          )}
        </div>

        <label className="flex flex-col gap-0.5">
          <span className="text-[11px] font-semibold text-gray-600">Pathway</span>
          <select required value={templateId} onChange={e => setTemplateId(e.target.value)} className={field}>
            <option value="">Choose a pathway</option>
            {assignable.map(t => <option key={t.id} value={t.id}>{t.name} (v{t.version}, {t.stages.length} stages)</option>)}
          </select>
          {assignable.length === 0 && (
            <span className="text-[10.5px] text-gray-400">No active template to assign. Design one first.</span>
          )}
        </label>

        <label className="flex flex-col gap-0.5">
          <span className="text-[11px] font-semibold text-gray-600">What started it</span>
          <select value={trigger} onChange={e => setTrigger(e.target.value)} className={field}>
            {PATHWAY_TRIGGERS.map(([c, l]) => <option key={c} value={c}>{l}</option>)}
          </select>
        </label>
      </div>

      {chosen && (
        <div className="mt-2.5 rounded-lg border border-gray-200 bg-white p-2.5">
          <p className="text-[11.5px] font-semibold text-gray-700">
            {chosen.name} &mdash; the plan this patient will be put on
          </p>
          {chosen.entry_criteria && (
            <p className="mt-1 text-[11.5px] leading-relaxed text-gray-600">
              <span className="font-semibold">Entry criteria:</span> {chosen.entry_criteria}{" "}
              <span className="text-gray-400">
                (this is text somebody wrote for you to read &mdash; it is not checked)
              </span>
            </p>
          )}
          <ol className="mt-1.5 flex flex-wrap gap-1.5">
            {chosen.stages.map(s => (
              <li key={s.id} className="rounded-lg bg-gray-50 px-2 py-1 text-[11px] text-gray-600">
                <span className="font-semibold text-gray-700">{s.position}. {s.name}</span>
                <span className="ml-1 text-gray-400">
                  +{s.offset_days}d{s.follow_up_kind ? ` · raises a follow-up` : ""}
                </span>
              </li>
            ))}
          </ol>
          <p className="mt-1.5 text-[11px] text-gray-400">
            Stage 1 is entered now. Each later stage is dated from the day the patient actually reaches
            the one before it, not from today.
          </p>
        </div>
      )}

      <label className="mt-2.5 flex flex-col gap-0.5">
        <span className="text-[11px] font-semibold text-gray-600">Note (optional)</span>
        <input value={note} onChange={e => setNote(e.target.value)} className={field}
          placeholder="Why this plan, for this patient" />
      </label>

      {error && <p className="mt-2 text-[12px] text-[var(--cmp-text-critical)]">{error}</p>}

      <div className="mt-2.5 flex gap-2">
        <button type="submit" disabled={busy || !patientId || !templateId}
          className={`rounded-lg px-3 py-1.5 text-[12.5px] font-semibold ${BUTTON.primary}`}>
          Assign pathway
        </button>
        <button type="button" onClick={onClose} className={`rounded-lg px-3 py-1.5 text-[12.5px] font-semibold ${BUTTON.quiet}`}>
          Cancel
        </button>
      </div>
    </form>
  );
}
