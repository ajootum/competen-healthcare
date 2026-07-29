"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/* eslint-disable @typescript-eslint/no-explicit-any */
const BODIES = [
  { v: "who", label: "WHO Guidelines" }, { v: "jci", label: "JCI Accreditation" }, { v: "safecare", label: "SafeCare" },
  { v: "moh", label: "Ministry of Health" }, { v: "nursing_council", label: "Nursing Council" }, { v: "medical_council", label: "Medical Council" },
  { v: "iso", label: "ISO Healthcare" }, { v: "professional_society", label: "Professional Society" }, { v: "hospital_policy", label: "Hospital Policy" }, { v: "other", label: "Other / Tenant-defined" },
];
const COVERAGE = [{ v: "full", label: "Full", color: "#10b981" }, { v: "partial", label: "Partial", color: "#f59e0b" }, { v: "reference", label: "Reference", color: "#3b82f6" }];

export default function StandardsMappingManager({ options, rows }: { options: { id: string; label: string }[]; rows: any[] }) {
  const router = useRouter();
  const [competency, setCompetency] = useState("");
  const [body, setBody] = useState("jci");
  const [ref, setRef] = useState("");
  const [title, setTitle] = useState("");
  const [coverage, setCoverage] = useState("full");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function add() {
    setErr(null);
    if (!competency) { setErr("Choose a competency."); return; }
    if (!ref.trim()) { setErr("Enter a standard reference."); return; }
    setBusy(true);
    const res = await fetch("/api/studio/standards-mappings", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ competency_id: competency, standard_body: body, standard_ref: ref, standard_title: title, coverage }),
    });
    setBusy(false);
    if (!res.ok) { const j = await res.json().catch(() => ({})); setErr(j.error ?? "Could not save."); return; }
    setRef(""); setTitle(""); setCoverage("full");
    router.refresh();
  }
  async function remove(id: string) {
    setBusy(true);
    await fetch(`/api/studio/standards-mappings?id=${id}`, { method: "DELETE" });
    setBusy(false);
    router.refresh();
  }

  const inp = "text-xs border border-gray-200 rounded-lg px-2.5 py-2 bg-white focus:outline-none focus:ring-1 focus:ring-teal-400";

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-5">
      <h2 className="font-semibold text-gray-900 text-sm mb-3">Map a competency to a standard</h2>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 mb-2">
        <select value={competency} onChange={e => setCompetency(e.target.value)} className={inp}>
          <option value="">Select competency…</option>
          {options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
        <select value={body} onChange={e => setBody(e.target.value)} className={inp}>
          {BODIES.map(x => <option key={x.v} value={x.v}>{x.label}</option>)}
        </select>
        <input value={ref} onChange={e => setRef(e.target.value)} placeholder="Standard reference (e.g. JCI PC.02.01.01)" className={inp} />
        <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Standard title (optional)" className={inp} />
      </div>
      <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
        <select value={coverage} onChange={e => setCoverage(e.target.value)} className={`${inp} sm:w-40`}>
          {COVERAGE.map(x => <option key={x.v} value={x.v}>{x.label} coverage</option>)}
        </select>
        <button onClick={add} disabled={busy} className="text-xs font-semibold text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-50 rounded-lg px-4 py-2">{busy ? "Saving…" : "Add mapping"}</button>
        {err && <p className="text-[11px] text-red-600 sm:ml-2">{err}</p>}
      </div>

      <div className="mt-5 border-t border-gray-50 pt-4">
        <h3 className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-2">Mappings ({rows.length})</h3>
        {rows.length === 0 ? (
          <p className="text-xs text-gray-400">No standards mapped yet — add the first above. The unmapped count shows the gap to close.</p>
        ) : (
          <div className="flex flex-col divide-y divide-gray-50">
            {rows.map((r: any) => (
              <div key={r.id} className="flex items-center gap-2 py-2 text-xs">
                <span className="font-semibold text-gray-800 truncate max-w-[30%]" title={r.ctx ?? ""}>{r.competency}</span>
                <span className="text-gray-300 shrink-0">↔</span>
                <span className="text-[10px] font-semibold text-gray-500 bg-gray-50 border border-gray-100 rounded px-1.5 py-0.5 shrink-0">{r.bodyLabel}</span>
                <span className="text-gray-700 font-medium truncate max-w-[26%]">{r.ref}{r.title ? ` — ${r.title}` : ""}</span>
                <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded shrink-0" style={{ color: r.coverageColor, backgroundColor: `${r.coverageColor}14` }}>{r.coverageLabel}</span>
                <button onClick={() => remove(r.id)} disabled={busy} className="ml-auto text-gray-300 hover:text-red-500 shrink-0" title="Remove">✕</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
