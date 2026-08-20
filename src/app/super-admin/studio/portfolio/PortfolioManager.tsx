"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/* eslint-disable @typescript-eslint/no-explicit-any */
const TYPES = [
  { v: "competency", label: "Competency" }, { v: "learning", label: "Learning" }, { v: "epa", label: "EPA" }, { v: "clinical", label: "Clinical" },
  { v: "leadership", label: "Leadership" }, { v: "research", label: "Research" }, { v: "custom", label: "Custom" },
];
const EVIDENCE = [
  { v: "case_log", label: "Case log" }, { v: "procedure_log", label: "Procedure log" }, { v: "reflection", label: "Reflection" }, { v: "certificate", label: "Certificate" },
  { v: "assessment", label: "Assessment" }, { v: "project", label: "Project" }, { v: "document", label: "Document" }, { v: "feedback", label: "Feedback" }, { v: "osce", label: "OSCE" }, { v: "other", label: "Other" },
];
const STATUS_TONE: Record<string, string> = { draft: "text-gray-500 bg-gray-50 border-gray-200", active: "text-teal-600 bg-teal-50 border-teal-200", archived: "text-gray-500 bg-gray-50 border-gray-200" };

export default function PortfolioManager({ templates }: { templates: any[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [type, setType] = useState("competency");
  const [open, setOpen] = useState<string | null>(null);
  const [secName, setSecName] = useState("");
  const [evidence, setEvidence] = useState("case_log");
  const [reqCount, setReqCount] = useState("1");
  const [weight, setWeight] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const call = async (url: string, opts: RequestInit) => { setBusy(true); const r = await fetch(url, opts); setBusy(false); if (!r.ok) { const j = await r.json().catch(() => ({})); setErr(j.error ?? "Request failed."); return false; } setErr(null); router.refresh(); return true; };

  async function create() {
    if (!name.trim()) { setErr("Name the portfolio."); return; }
    if (await call("/api/studio/portfolio", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, portfolio_type: type }) })) { setName(""); setType("competency"); }
  }
  const setStatus = (id: string, status: string) => call(`/api/studio/portfolio?id=${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
  const del = (id: string) => call(`/api/studio/portfolio?id=${id}`, { method: "DELETE" });
  const removeSec = (sid: string) => call(`/api/studio/portfolio/sections?id=${sid}`, { method: "DELETE" });
  async function addSec(tid: string) {
    if (!secName.trim()) { setErr("Enter a section name."); return; }
    const w = weight === "" ? 0 : parseInt(weight, 10);
    if (!Number.isFinite(w) || w < 0 || w > 100) { setErr("Weight must be 0–100."); return; }
    if (await call("/api/studio/portfolio/sections", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ template_id: tid, name: secName, evidence_type: evidence, required_count: reqCount, weight: w }) })) { setSecName(""); setWeight(""); setReqCount("1"); }
  }

  const inp = "text-xs border border-gray-200 rounded-lg px-2.5 py-2 bg-white focus:outline-none focus:ring-1 focus:ring-teal-400";

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-white rounded-xl border border-gray-100 p-5">
        <h2 className="font-semibold text-gray-900 text-sm mb-3">New portfolio template</h2>
        <div className="flex flex-col sm:flex-row gap-2">
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Portfolio name (e.g. Advanced Practice Nurse Portfolio)" className={`${inp} flex-1`} />
          <select value={type} onChange={e => setType(e.target.value)} className={`${inp} sm:w-40`}>{TYPES.map(t => <option key={t.v} value={t.v}>{t.label}</option>)}</select>
          <button onClick={create} disabled={busy} className="text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-50 rounded-lg px-4 py-2 whitespace-nowrap">{busy ? "…" : "Create"}</button>
        </div>
        {err && <p className="text-[11px] text-[var(--cmp-text-critical)] mt-1">{err}</p>}
      </div>

      {templates.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-6 text-center text-xs text-gray-500">No portfolio templates yet — create one, then add required-evidence sections (weights should sum to 100%).</div>
      ) : templates.map((t: any) => (
        <div key={t.id} className="bg-white rounded-xl border border-gray-100 p-4">
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => setOpen(open === t.id ? null : t.id)} className="text-sm font-bold text-gray-900 hover:text-teal-700">{open === t.id ? "▾" : "▸"} {t.name}</button>
            <span className="text-[10px] font-semibold text-gray-500 bg-gray-50 border border-gray-100 rounded px-1.5 py-0.5">{t.typeLabel}</span>
            <span className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border ${STATUS_TONE[t.status] ?? STATUS_TONE.draft}`}>{t.status}</span>
            <div className="ml-auto flex items-center gap-2 text-xs">
              <span className="text-gray-500">{t.sections.length} section{t.sections.length === 1 ? "" : "s"} · {t.requiredArtefacts} artefacts</span>
              <span className={t.balanced ? "text-teal-600 font-semibold" : t.weightSum > 0 ? "text-[var(--cmp-text-warning)]" : "text-gray-500"}>{t.weightSum}%{t.balanced ? " ✓" : ""}</span>
              <button onClick={() => del(t.id)} disabled={busy} className="text-gray-500 hover:text-red-500" title="Delete">✕</button>
            </div>
          </div>

          {open === t.id && (
            <div className="mt-3 ml-4 border-l-2 border-gray-50 pl-3">
              {t.sections.length > 0 && (
                <div className="flex flex-col divide-y divide-gray-50 mb-2">
                  {t.sections.map((s: any) => (
                    <div key={s.id} className="flex items-center gap-2 py-1.5 text-xs">
                      <span className="font-semibold text-gray-800 flex-1 truncate">{s.name}</span>
                      <span className="text-[10px] font-semibold text-gray-500 bg-gray-50 border border-gray-100 rounded px-1.5 py-0.5 shrink-0">{s.evLabel}</span>
                      <span className="text-gray-500 w-16 text-right">×{s.requiredCount}{s.required ? "" : " opt"}</span>
                      <span className="font-semibold text-gray-900 w-10 text-right tabular-nums">{s.weight}%</span>
                      <button onClick={() => removeSec(s.id)} disabled={busy} className="text-gray-500 hover:text-red-500 shrink-0" title="Remove">✕</button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center bg-gray-50/60 rounded-lg p-2.5">
                <input value={secName} onChange={e => setSecName(e.target.value)} placeholder="Section (e.g. Clinical Practice Evidence)" className={`${inp} flex-1`} />
                <select value={evidence} onChange={e => setEvidence(e.target.value)} className={`${inp} sm:w-36`}>{EVIDENCE.map(x => <option key={x.v} value={x.v}>{x.label}</option>)}</select>
                <input value={reqCount} onChange={e => setReqCount(e.target.value)} type="number" min="0" placeholder="Req" className={`${inp} sm:w-16`} title="Required artefacts" />
                <input value={weight} onChange={e => setWeight(e.target.value)} type="number" min="0" max="100" placeholder="Wt %" className={`${inp} sm:w-20`} />
                <button onClick={() => addSec(t.id)} disabled={busy} className="text-xs font-semibold text-teal-700 border border-teal-200 bg-teal-50 hover:bg-teal-100 rounded-lg px-3 py-2 whitespace-nowrap">Add section</button>
              </div>
              {t.sections.length > 0 && !t.balanced && t.weightSum !== 100 && <p className="text-[10px] text-[var(--cmp-text-warning)] mt-1">Section weights sum to {t.weightSum}% — adjust to 100% before activation.</p>}
              <div className="mt-2 flex gap-3">
                {t.sections.length > 0 && t.status !== "active" && <button onClick={() => setStatus(t.id, "active")} disabled={busy} className="text-[11px] font-semibold text-teal-700 hover:underline">Activate →</button>}
                {t.status === "active" && <button onClick={() => setStatus(t.id, "archived")} disabled={busy} className="text-[11px] font-semibold text-gray-500 hover:underline">Archive</button>}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
