"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

// Audit runner (client). Criteria are the selected competency's governed
// checklist items, rendered dynamically. Submitting computes compliance and —
// for failed CRITICAL items — the API auto-creates high-priority CAPA actions.

export type AuditTemplate = {
  competencyId: string; name: string;
  items: { id: string; item: string; critical: boolean; skill: string }[];
};

type Result = "met" | "not_met" | "na";

export default function AuditRunner({ type, subjectKind, templates, nurses, preselect }: {
  type: string; subjectKind: "nurse" | "record" | "area";
  templates: AuditTemplate[];
  nurses: { id: string; name: string }[];
  preselect?: string;
}) {
  const router = useRouter();
  const [compId, setCompId] = useState(preselect && templates.some(t => t.competencyId === preselect) ? preselect : "");
  const [subjectNurse, setSubjectNurse] = useState("");
  const [recordRef, setRecordRef] = useState("");
  const [area, setArea] = useState("");
  const [note, setNote] = useState("");
  const [responses, setResponses] = useState<Record<string, Result>>({});
  const [itemNotes, setItemNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ compliance: number | null; capa: number } | null>(null);

  const tpl = useMemo(() => templates.find(t => t.competencyId === compId) ?? null, [templates, compId]);

  const answered = tpl ? tpl.items.filter(i => responses[i.id]).length : 0;
  const met = tpl ? tpl.items.filter(i => responses[i.id] === "met").length : 0;
  const notMet = tpl ? tpl.items.filter(i => responses[i.id] === "not_met").length : 0;
  const denom = met + notMet;
  const liveCompliance = denom ? Math.round((met / denom) * 100) : null;
  const criticalFails = tpl ? tpl.items.filter(i => i.critical && responses[i.id] === "not_met").length : 0;

  function setAll(result: Result) {
    if (!tpl) return;
    setResponses(Object.fromEntries(tpl.items.map(i => [i.id, result])));
  }

  async function submit() {
    if (!tpl || answered === 0) { setError("Answer at least one criterion."); return; }
    setBusy(true); setError(null);
    const res = await fetch("/api/quality/audits", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        audit_type: type,
        competency_id: tpl.competencyId,
        nurse_id: subjectKind === "nurse" ? (subjectNurse || null) : null,
        record_ref: subjectKind === "record" ? (recordRef.trim() || null) : null,
        area: area.trim() || null,
        note: note.trim() || null,
        responses: tpl.items.filter(i => responses[i.id]).map(i => ({
          checklist_item_id: i.id, result: responses[i.id], note: (itemNotes[i.id] ?? "").trim() || undefined,
        })),
      }),
    });
    const d = await res.json().catch(() => ({}));
    if (res.ok) {
      setDone({ compliance: d.compliance ?? liveCompliance, capa: d.capa_created ?? 0 });
      router.refresh();
    } else setError(d.error ?? "Could not save the audit");
    setBusy(false);
  }

  function reset() {
    setDone(null); setResponses({}); setItemNotes({}); setNote("");
    setSubjectNurse(""); setRecordRef(""); setArea("");
  }

  if (done) {
    return (
      <div className="bg-green-50 border border-green-200 rounded-xl p-5">
        <p className="text-sm font-bold text-green-900 mb-1">✅ Audit recorded</p>
        <p className="text-xs text-green-800">
          Compliance: <span className="font-bold">{done.compliance != null ? `${done.compliance}%` : "—"}</span>
          {" · "}{met} met · {notMet} not met
          {done.capa > 0 && <> · <span className="font-bold">{done.capa} CAPA action{done.capa === 1 ? "" : "s"} auto-created</span> from failed critical criteria</>}
        </p>
        <div className="flex gap-2 mt-3">
          <button onClick={reset} className="text-xs font-semibold text-green-800 border border-green-300 rounded-lg px-3 py-1.5 hover:bg-green-100">New audit</button>
          {done.capa > 0 && (
            <a href="/assessor/quality/capa" className="text-xs font-semibold text-white bg-indigo-600 rounded-lg px-3 py-1.5 hover:bg-indigo-700">Open CAPA tracker →</a>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white border border-indigo-200 rounded-xl p-4">
      <div className="grid md:grid-cols-3 gap-2 mb-3">
        <select value={compId} onChange={e => { setCompId(e.target.value); setResponses({}); setItemNotes({}); }}
          className="text-xs border border-gray-200 rounded-lg px-2 py-2 bg-white text-gray-700 focus:outline-none focus:border-indigo-400 md:col-span-2">
          <option value="">Audit criteria — pick a competency checklist…</option>
          {templates.map(t => <option key={t.competencyId} value={t.competencyId}>{t.name} ({t.items.length} items)</option>)}
        </select>
        {subjectKind === "nurse" && (
          <select value={subjectNurse} onChange={e => setSubjectNurse(e.target.value)}
            className="text-xs border border-gray-200 rounded-lg px-2 py-2 bg-white text-gray-600 focus:outline-none focus:border-indigo-400">
            <option value="">Observed clinician (optional)…</option>
            {nurses.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}
          </select>
        )}
        {subjectKind === "record" && (
          <input value={recordRef} onChange={e => setRecordRef(e.target.value)} placeholder="Record / chart reference"
            className="text-xs border border-gray-200 rounded-lg px-2.5 py-2 focus:outline-none focus:border-indigo-400" />
        )}
        {subjectKind === "area" && (
          <input value={area} onChange={e => setArea(e.target.value)} placeholder="Unit / area (e.g. ICU)"
            className="text-xs border border-gray-200 rounded-lg px-2.5 py-2 focus:outline-none focus:border-indigo-400" />
        )}
      </div>
      {subjectKind !== "area" && (
        <input value={area} onChange={e => setArea(e.target.value)} placeholder="Unit / area (optional)"
          className="text-xs border border-gray-200 rounded-lg px-2.5 py-2 mb-3 w-full md:w-64 focus:outline-none focus:border-indigo-400" />
      )}

      {tpl ? (
        <>
          <div className="flex items-center gap-3 mb-2 flex-wrap">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Criteria — {tpl.name}</p>
            <span className="text-[10px] text-gray-400">{answered}/{tpl.items.length} answered</span>
            <span className="flex-1" />
            <button onClick={() => setAll("met")} className="text-[10px] text-green-600 hover:underline">all met</button>
            <button onClick={() => setResponses({})} className="text-[10px] text-gray-400 hover:underline">clear</button>
            {liveCompliance != null && (
              <span className={`text-[11px] font-bold px-2 py-0.5 rounded ${liveCompliance >= 85 ? "bg-green-100 text-green-700" : liveCompliance >= 60 ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-600"}`}>
                {liveCompliance}% compliant
              </span>
            )}
          </div>
          {criticalFails > 0 && (
            <p className="text-[10px] text-red-600 bg-red-50 border border-red-200 rounded-lg px-2.5 py-1.5 mb-2">
              ⚠️ {criticalFails} critical criterion{criticalFails === 1 ? "" : "s"} failed — submitting will auto-create {criticalFails} high-priority CAPA action{criticalFails === 1 ? "" : "s"}.
            </p>
          )}
          <ul className="space-y-1.5 mb-3">
            {tpl.items.map(i => (
              <li key={i.id} className="border border-gray-100 rounded-lg px-3 py-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-gray-700 flex-1 min-w-[180px]">
                    {i.item}
                    {i.critical && <span className="ml-1.5 text-[8px] font-bold text-red-600 bg-red-50 border border-red-200 rounded px-1 py-0.5 uppercase">Critical</span>}
                    <span className="ml-1.5 text-[9px] text-gray-300">{i.skill}</span>
                  </span>
                  <span className="flex gap-1">
                    {(["met", "not_met", "na"] as const).map(v => (
                      <button key={v}
                        onClick={() => setResponses(prev => ({ ...prev, [i.id]: prev[i.id] === v ? undefined : v } as Record<string, Result>))}
                        className={`text-[9px] font-bold uppercase px-2 py-1 rounded border transition-colors ${
                          responses[i.id] === v
                            ? v === "met" ? "bg-green-500 text-white border-green-500"
                              : v === "not_met" ? "bg-red-500 text-white border-red-500"
                              : "bg-gray-400 text-white border-gray-400"
                            : "bg-white text-gray-400 border-gray-200 hover:border-gray-400"}`}>
                        {v === "met" ? "Met" : v === "not_met" ? "Not met" : "N/A"}
                      </button>
                    ))}
                  </span>
                </div>
                {responses[i.id] === "not_met" && (
                  <input value={itemNotes[i.id] ?? ""} onChange={e => setItemNotes(prev => ({ ...prev, [i.id]: e.target.value }))}
                    placeholder="Finding note (what was observed)…"
                    className="mt-1.5 w-full text-[11px] border border-gray-200 rounded-lg px-2.5 py-1.5 text-gray-600 focus:outline-none focus:border-red-300" />
                )}
              </li>
            ))}
          </ul>
          <div className="flex items-center gap-2 flex-wrap">
            <input value={note} onChange={e => setNote(e.target.value)} placeholder="Overall audit note (optional)"
              className="flex-1 min-w-[200px] text-xs border border-gray-200 rounded-lg px-2.5 py-2 focus:outline-none focus:border-indigo-400" />
            <button onClick={submit} disabled={busy || answered === 0}
              className="text-xs font-bold text-white bg-indigo-600 rounded-lg px-5 py-2 hover:bg-indigo-700 disabled:opacity-40 transition-colors">
              {busy ? "Saving…" : "Submit audit"}
            </button>
          </div>
          {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
        </>
      ) : (
        <p className="text-xs text-gray-400">Pick a competency above — its governed checklist becomes the audit criteria.</p>
      )}
    </div>
  );
}
