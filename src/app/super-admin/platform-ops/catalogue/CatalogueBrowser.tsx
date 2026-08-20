"use client";

import { useState, useMemo } from "react";
import { cardClass } from "@/components/ui/primitives";

// WCE-005 catalogue browser — the widget library reference (§13). Search + category filter over the
// catalogued widget primitives; the detail pane shows each widget's configuration contract (§12): layout,
// data source, filters, thresholds, display modes, actions and safety classification.
/* eslint-disable @typescript-eslint/no-explicit-any */
const catTone = (c: string) => (/risk|heat|matrix/i.test(c) ? "bg-[var(--cmp-surface-error)] text-[var(--cmp-text-error)]" : /trend|comparison|distribution/i.test(c) ? "bg-[var(--cmp-surface-information)] text-[var(--cmp-text-information)]" : /ai/i.test(c) ? "bg-violet-50 text-violet-700" : /alert/i.test(c) ? "bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)]" : "bg-[var(--cmp-surface-success)] text-emerald-700");
const safetyTone = (s: string) => (s.includes("relevant") ? "bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)]" : "bg-gray-50 text-gray-500");
const safetyLabel: Record<string, string> = { non_clinical: "Non-clinical", operational: "Operational", clinical_safety_relevant: "Clinical-safety relevant" };

export default function CatalogueBrowser({ widgets, categories }: { widgets: any[]; categories: string[] }) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [sel, setSel] = useState<any>(widgets[0] ?? null);

  const filtered = useMemo(() => widgets.filter(w => {
    if (cat && w.category !== cat) return false;
    if (!q.trim()) return true;
    const s = q.toLowerCase();
    return w.name.toLowerCase().includes(s) || w.key.toLowerCase().includes(s) || w.category.toLowerCase().includes(s);
  }), [widgets, q, cat]);

  return (
    <div className={cardClass}>
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <h2 className="text-sm font-bold text-gray-900">Widget Library <span className="text-[10px] text-gray-500 font-normal">{widgets.length} catalogued primitives</span></h2>
        <div className="flex items-center gap-2">
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search widgets…" className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/40 w-48" />
          <select value={cat} onChange={e => setCat(e.target.value)} className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm"><option value="">All categories</option>{categories.map(c => <option key={c} value={c}>{c}</option>)}</select>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="max-h-[28rem] overflow-y-auto pr-1 space-y-0.5">
          {filtered.length === 0 ? <p className="text-sm text-gray-500 py-6 text-center">No widgets match.</p> : filtered.map(w => (
            <button key={w.key} onClick={() => setSel(w)} className={`w-full text-left rounded-lg px-2.5 py-1.5 hover:bg-gray-50 ${sel?.key === w.key ? "bg-teal-50/60 ring-1 ring-teal-200" : ""}`}>
              <div className="flex items-center gap-2">
                <span className={`text-[9px] font-semibold rounded px-1.5 py-0.5 shrink-0 ${catTone(w.category)}`}>{w.category}</span>
                <span className="text-xs font-medium text-gray-800 truncate flex-1">{w.name}</span>
                {w.registered ? <span className="text-[9px] text-[var(--cmp-text-success)] shrink-0" title="Registered in WCE-002">● {w.completeness}%</span> : <span className="text-[9px] text-gray-500 shrink-0" title="Not yet synced to the registry">○ unsynced</span>}
              </div>
            </button>
          ))}
        </div>

        <div className="border border-gray-100 rounded-lg p-4 max-h-[28rem] overflow-y-auto">
          {!sel ? <p className="text-sm text-gray-500 py-10 text-center">Select a widget to inspect its configuration contract.</p> : (
            <div className="space-y-3">
              <div>
                <div className="flex items-center gap-2 mb-1"><span className={`text-[9px] font-semibold rounded px-1.5 py-0.5 ${catTone(sel.category)}`}>{sel.category}</span><span className={`text-[9px] font-semibold rounded px-1.5 py-0.5 ${safetyTone(sel.safety)}`}>{safetyLabel[sel.safety] ?? sel.safety}</span>{sel.thresholds && <span className="text-[9px] rounded px-1.5 py-0.5 bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)]">thresholds</span>}</div>
                <h3 className="text-sm font-bold text-gray-900">{sel.name}</h3>
                <p className="text-[10px] text-gray-500 font-mono break-all">{sel.key}</p>
                <p className="text-xs text-gray-600 mt-1">{sel.description}</p>
              </div>
              <dl className="text-xs space-y-1">
                <Row k="Data source" v={sel.dataSource ?? "Composed / derived"} mono={!!sel.dataSource} />
                <Row k="Default layout" v={`${sel.layout.w}×${sel.layout.h} (grid cols ${sel.layout.minW}–${sel.layout.maxW})`} />
                <Row k="Display modes" v={sel.displayModes.join(", ")} />
                <Row k="Filters" v={sel.filters.length ? sel.filters.join(", ") : "—"} />
                <Row k="Actions" v={sel.actions.length ? sel.actions.join(", ") : "—"} />
                <Row k="Mandatory" v={sel.mandatory ? "Yes" : "No"} />
                <Row k="Registered" v={sel.registered ? `Yes · ${sel.completeness}% complete` : "No — run a registry sync"} />
              </dl>
              <p className="text-[10px] text-gray-500 border-t border-gray-100 pt-2">Data-source footnote standard (§13): every rendered instance shows its source service, calculation basis, refresh time and scope.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return <div className="flex items-start gap-2"><dt className="text-gray-500 w-24 shrink-0">{k}</dt><dd className={`text-gray-700 break-words ${mono ? "font-mono text-[10px]" : ""}`}>{v}</dd></div>;
}
