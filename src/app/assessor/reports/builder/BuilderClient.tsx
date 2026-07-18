"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DATASET_COLUMNS, DATASET_LABELS, DATASET_FILTERS } from "@/lib/report-datasets";

// Report Builder client: dataset + filters + columns → live preview + CSV,
// with saved definitions (run / delete). ?run=<id> auto-loads a saved report.

export type SavedDef = { id: string; name: string; dataset: string; config: { columns?: string[]; filters?: Filters } | null; created_by_name: string | null; created_at: string };
export type Option = { id: string; name: string };
type Filters = { from?: string; to?: string; department?: string; assessor?: string };
type Preview = { columns: { key: string; label: string }[]; rows: Record<string, string | number | null>[]; total: number };

export default function BuilderClient({ saved, assessors, departments, initialRunId, initialDataset }: {
  saved: SavedDef[]; assessors: Option[]; departments: string[];
  initialRunId: string | null; initialDataset: string | null;
}) {
  const router = useRouter();
  const initialDef = initialRunId ? saved.find(s => s.id === initialRunId) ?? null : null;
  const [dataset, setDataset] = useState(initialDef?.dataset ?? (initialDataset && DATASET_COLUMNS[initialDataset] ? initialDataset : "assessments"));
  const [cols, setCols] = useState<Set<string>>(new Set(initialDef?.config?.columns ?? DATASET_COLUMNS[initialDef?.dataset ?? "assessments"].map(c => c.key)));
  const [filters, setFilters] = useState<Filters>(initialDef?.config?.filters ?? {});
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveName, setSaveName] = useState("");
  const [saveBusy, setSaveBusy] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const allCols = DATASET_COLUMNS[dataset] ?? [];
  const activeFilters = DATASET_FILTERS[dataset] ?? [];

  function buildQuery(format?: string) {
    const p = new URLSearchParams({ dataset });
    const chosen = allCols.filter(c => cols.has(c.key)).map(c => c.key);
    if (chosen.length && chosen.length < allCols.length) p.set("columns", chosen.join(","));
    if (activeFilters.includes("dates")) {
      if (filters.from) p.set("from", filters.from);
      if (filters.to) p.set("to", filters.to);
    }
    if (activeFilters.includes("department") && filters.department) p.set("department", filters.department);
    if (activeFilters.includes("assessor") && filters.assessor) p.set("assessor", filters.assessor);
    if (format) p.set("format", format);
    return `/api/reports/custom?${p.toString()}`;
  }

  async function run() {
    setBusy(true); setError(null);
    const res = await fetch(buildQuery());
    const d = await res.json().catch(() => ({}));
    if (res.ok) setPreview(d);
    else { setPreview(null); setError(d.error ?? "Report failed"); }
    setBusy(false);
  }

  function pickDataset(ds: string) {
    setDataset(ds);
    setCols(new Set(DATASET_COLUMNS[ds].map(c => c.key)));
    setPreview(null);
  }

  function loadDef(def: SavedDef) {
    setDataset(def.dataset);
    setCols(new Set(def.config?.columns ?? DATASET_COLUMNS[def.dataset].map(c => c.key)));
    setFilters(def.config?.filters ?? {});
    setPreview(null);
    setSaveName(def.name);
  }

  async function saveDef() {
    if (!saveName.trim()) { setError("Name the report first."); return; }
    setSaveBusy(true); setError(null);
    const res = await fetch("/api/reports/definitions", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: saveName, dataset,
        config: { columns: allCols.filter(c => cols.has(c.key)).map(c => c.key), filters },
      }),
    });
    const d = await res.json().catch(() => ({}));
    if (res.ok) { setSavedMsg(`Saved “${saveName}” to the library`); router.refresh(); }
    else setError(d.error ?? "Save failed");
    setSaveBusy(false);
  }

  async function deleteDef(id: string) {
    if (!confirm("Delete this saved report?")) return;
    await fetch(`/api/reports/definitions?id=${id}`, { method: "DELETE" });
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {initialDef && !preview && (
        <p className="text-xs text-indigo-800 bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-2">
          📊 Loaded saved report <span className="font-semibold">“{initialDef.name}”</span> — press <span className="font-semibold">▶ Run preview</span> for the latest figures.
        </p>
      )}
      {/* Builder */}
      <div className="bg-white border border-indigo-200 rounded-xl p-4">
        <div className="flex items-center gap-1.5 mb-3 flex-wrap">
          {Object.keys(DATASET_COLUMNS).map(ds => (
            <button key={ds} onClick={() => pickDataset(ds)}
              className={`text-[11px] font-semibold px-3 py-1.5 rounded-lg border transition-colors ${
                dataset === ds ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-gray-600 border-gray-200 hover:border-indigo-300"}`}>
              {DATASET_LABELS[ds]}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 mb-3 flex-wrap">
          {activeFilters.includes("dates") && (
            <>
              <input type="date" value={filters.from ?? ""} onChange={e => setFilters(f => ({ ...f, from: e.target.value || undefined }))}
                className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 text-gray-600 focus:outline-none focus:border-indigo-400" />
              <span className="text-xs text-gray-300">→</span>
              <input type="date" value={filters.to ?? ""} onChange={e => setFilters(f => ({ ...f, to: e.target.value || undefined }))}
                className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 text-gray-600 focus:outline-none focus:border-indigo-400" />
            </>
          )}
          {activeFilters.includes("department") && (
            <select value={filters.department ?? ""} onChange={e => setFilters(f => ({ ...f, department: e.target.value || undefined }))}
              className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white text-gray-600 focus:outline-none focus:border-indigo-400">
              <option value="">All departments</option>
              {departments.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          )}
          {activeFilters.includes("assessor") && (
            <select value={filters.assessor ?? ""} onChange={e => setFilters(f => ({ ...f, assessor: e.target.value || undefined }))}
              className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white text-gray-600 focus:outline-none focus:border-indigo-400">
              <option value="">All assessors</option>
              {assessors.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          )}
        </div>

        <div className="flex items-center gap-1.5 mb-3 flex-wrap">
          <span className="text-[9px] font-bold text-gray-400 uppercase tracking-widest mr-1">Columns</span>
          {allCols.map(c => (
            <button key={c.key}
              onClick={() => setCols(prev => { const s = new Set(prev); if (s.has(c.key)) s.delete(c.key); else s.add(c.key); return s; })}
              className={`text-[10px] px-2 py-1 rounded-full border transition-colors ${
                cols.has(c.key) ? "bg-teal-600 text-white border-teal-600" : "bg-white text-gray-400 border-gray-200 hover:border-teal-300"}`}>
              {c.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={run} disabled={busy}
            className="text-xs font-bold text-white bg-indigo-600 rounded-lg px-4 py-2 hover:bg-indigo-700 disabled:opacity-50 transition-colors">
            {busy ? "Running…" : "▶ Run preview"}
          </button>
          <a href={buildQuery("csv")} className="text-xs font-semibold text-indigo-600 border border-indigo-200 rounded-lg px-3 py-2 hover:bg-indigo-50 transition-colors">⬇ CSV</a>
          <span className="flex-1" />
          <input value={saveName} onChange={e => { setSaveName(e.target.value); setSavedMsg(null); }} placeholder="Report name…"
            className="text-xs border border-gray-200 rounded-lg px-2.5 py-2 w-48 focus:outline-none focus:border-indigo-400" />
          <button onClick={saveDef} disabled={saveBusy}
            className="text-xs font-semibold text-teal-700 border border-teal-300 rounded-lg px-3 py-2 hover:bg-teal-50 disabled:opacity-50 transition-colors">
            {saveBusy ? "Saving…" : "💾 Save to library"}
          </button>
        </div>
        {savedMsg && <p className="text-[10px] text-green-600 mt-2">✓ {savedMsg}</p>}
        {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
      </div>

      {/* Preview */}
      {preview && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 border-b border-gray-100 flex items-center justify-between">
            <p className="text-xs font-bold text-gray-900">Preview — {preview.total} row{preview.total === 1 ? "" : "s"}{preview.total > preview.rows.length ? ` (showing ${preview.rows.length})` : ""}</p>
          </div>
          <div className="overflow-x-auto max-h-96 overflow-y-auto">
            <table className="w-full text-[11px]">
              <thead className="sticky top-0 bg-gray-50">
                <tr className="text-left text-[8px] text-gray-400 uppercase tracking-wider">
                  {preview.columns.map(c => <th key={c.key} className="px-3 py-2">{c.label}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {preview.rows.map((r, i) => (
                  <tr key={i}>
                    {preview.columns.map(c => <td key={c.key} className="px-3 py-1.5 text-gray-600 whitespace-nowrap">{r[c.key] ?? "—"}</td>)}
                  </tr>
                ))}
                {!preview.rows.length && (
                  <tr><td colSpan={preview.columns.length} className="px-3 py-6 text-center text-gray-400">No rows match these filters.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Saved reports */}
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2.5">Saved Reports ({saved.length})</p>
        {saved.length ? (
          <div className="space-y-1.5">
            {saved.map(def => (
              <div key={def.id} className="flex items-center gap-2 border border-gray-100 rounded-lg px-3 py-2">
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-semibold text-gray-800 truncate">{def.name}</p>
                  <p className="text-[9px] text-gray-400">{DATASET_LABELS[def.dataset] ?? def.dataset} · {def.created_by_name ?? "—"} · <span suppressHydrationWarning>{new Date(def.created_at).toLocaleDateString()}</span></p>
                </div>
                <button onClick={() => { loadDef(def); }} className="text-[10px] font-semibold text-indigo-600 border border-indigo-200 rounded-lg px-2.5 py-1 hover:bg-indigo-50">Load</button>
                <button onClick={() => deleteDef(def.id)} className="text-[10px] text-gray-300 hover:text-red-500 px-1">✕</button>
              </div>
            ))}
          </div>
        ) : <p className="text-xs text-gray-400">Nothing saved yet — build a report above and save it.</p>}
      </div>
    </div>
  );
}
