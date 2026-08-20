"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/* eslint-disable @typescript-eslint/no-explicit-any */
const TYPES = [
  { v: "prerequisite", label: "Prerequisite", color: "#3b82f6" },
  { v: "co_requisite", label: "Co-requisite", color: "#f59e0b" },
  { v: "recommended", label: "Recommended", color: "#14b8a6" },
  { v: "inherited", label: "Inherited", color: "#8b5cf6" },
];
const colorOf = (t: string) => TYPES.find(x => x.v === t)?.color ?? "#9ca3af";
const labelOf = (t: string) => TYPES.find(x => x.v === t)?.label ?? t;

export default function DependencyManager({ options, rows }: { options: { id: string; label: string }[]; rows: any[] }) {
  const router = useRouter();
  const [source, setSource] = useState("");
  const [target, setTarget] = useState("");
  const [type, setType] = useState("prerequisite");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function add() {
    setErr(null);
    if (!source || !target) { setErr("Choose both competencies."); return; }
    if (source === target) { setErr("A competency cannot depend on itself."); return; }
    setBusy(true);
    const res = await fetch("/api/studio/dependencies", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source_competency_id: source, target_competency_id: target, dependency_type: type, notes }),
    });
    setBusy(false);
    if (!res.ok) { const j = await res.json().catch(() => ({})); setErr(j.error ?? "Could not save."); return; }
    setSource(""); setTarget(""); setNotes(""); setType("prerequisite");
    router.refresh();
  }
  async function remove(id: string) {
    setBusy(true);
    await fetch(`/api/studio/dependencies?id=${id}`, { method: "DELETE" });
    setBusy(false);
    router.refresh();
  }

  const sel = "text-xs border border-gray-200 rounded-lg px-2.5 py-2 bg-white focus:outline-none focus:ring-1 focus:ring-teal-400";

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-5">
      <h2 className="font-semibold text-gray-900 text-sm mb-3">Define a dependency</h2>
      <div className="flex flex-col lg:flex-row lg:items-end gap-2 mb-2">
        <div className="flex flex-col gap-1 flex-1 min-w-0">
          <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Competency</label>
          <select value={source} onChange={e => setSource(e.target.value)} className={sel}>
            <option value="">Select competency…</option>
            {options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1 lg:w-40">
          <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Relationship</label>
          <select value={type} onChange={e => setType(e.target.value)} className={sel}>
            {TYPES.map(t => <option key={t.v} value={t.v}>{t.label} of</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1 flex-1 min-w-0">
          <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Depends on</label>
          <select value={target} onChange={e => setTarget(e.target.value)} className={sel}>
            <option value="">Select competency…</option>
            {options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </div>
      </div>
      <div className="flex flex-col sm:flex-row gap-2 mb-1">
        <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Notes (optional)" className={`${sel} flex-1`} />
        <button onClick={add} disabled={busy} className="text-xs font-semibold text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-50 rounded-lg px-4 py-2">{busy ? "Saving…" : "Add dependency"}</button>
      </div>
      {err && <p className="text-[11px] text-[var(--cmp-text-critical)] mt-1">{err}</p>}
      <p className="text-[10px] text-gray-500 mt-1">Prerequisite and inherited links are checked for cycles — a relationship that would make progression impossible is rejected.</p>

      <div className="mt-5 border-t border-gray-50 pt-4">
        <h3 className="text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-2">Dependencies ({rows.length})</h3>
        {rows.length === 0 ? (
          <p className="text-xs text-gray-500">No dependencies defined yet — add the first above.</p>
        ) : (
          <div className="flex flex-col divide-y divide-gray-50">
            {rows.map((r: any) => (
              <div key={r.id} className="flex items-center gap-2 py-2 text-xs">
                <span className="font-semibold text-gray-800 truncate max-w-[34%]" title={r.sourceCtx ?? ""}>{r.source}</span>
                <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded shrink-0" style={{ color: colorOf(r.type), backgroundColor: `${colorOf(r.type)}14` }}>{labelOf(r.type)}</span>
                <span className="text-gray-500 shrink-0">→</span>
                <span className="text-gray-700 truncate max-w-[34%]" title={r.targetCtx ?? ""}>{r.target}</span>
                {r.notes && <span className="text-[10px] text-gray-500 truncate hidden md:inline">· {r.notes}</span>}
                <button onClick={() => remove(r.id)} disabled={busy} className="ml-auto text-gray-500 hover:text-red-500 shrink-0" title="Remove">✕</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
