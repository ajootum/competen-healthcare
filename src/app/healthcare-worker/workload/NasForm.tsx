"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { WORKLOAD_FRAMEWORKS, computeWorkload, type WorkloadItem } from "@/lib/hww/assessments";

// Workload capture — Nursing Activities Score (23 items, Miranda 2003
// weightings, mutually-exclusive groups rendered as radio rows) or the
// Competen Ward Workload components. Live total preview; the server
// recomputes the authoritative score from the same engine.

const btn = "px-3.5 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50";

export default function NasForm({ patientId, patientLabel, defaultFramework }: { patientId: string; patientLabel: string; defaultFramework: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [framework, setFramework] = useState(defaultFramework === "icu" ? "nas" : "ward");
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const fw = WORKLOAD_FRAMEWORKS[framework] ?? WORKLOAD_FRAMEWORKS.nas;
  const preview = useMemo(() => computeWorkload(framework, selected), [framework, selected]);

  // Group items: exclusive groups render as radio rows, singles as checkboxes.
  const groups = useMemo(() => {
    const g = new Map<string, WorkloadItem[]>();
    const singles: WorkloadItem[] = [];
    for (const it of fw.items) {
      if (it.group) g.set(it.group, [...(g.get(it.group) ?? []), it]);
      else singles.push(it);
    }
    return { grouped: [...g.entries()], singles };
  }, [fw.items]);

  function toggleSingle(key: string) {
    setSelected(s => s.includes(key) ? s.filter(x => x !== key) : [...s, key]);
  }
  function pickGroup(group: WorkloadItem[], key: string | null) {
    const keys = group.map(i => i.key);
    setSelected(s => [...s.filter(x => !keys.includes(x)), ...(key ? [key] : [])]);
  }

  async function submit() {
    setBusy(true); setErr(null);
    const r = await fetch("/api/operations/assessments", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "workload", patient_id: patientId, framework, items: selected }),
    });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setErr(d.error ?? "Failed"); return; }
    setOpen(false); setSelected([]);
    router.refresh();
  }

  if (!open) return <button className="px-2.5 py-1 rounded-lg border border-gray-300 text-xs text-gray-700 hover:bg-gray-50" onClick={() => setOpen(true)}>+ Assess</button>;

  return (
    <div className="mt-3 border border-emerald-200 rounded-lg p-4 space-y-3 bg-emerald-50/30 w-full">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-sm font-semibold text-gray-800">Workload — {patientLabel}</h4>
        <div className="flex rounded-lg border border-gray-300 overflow-hidden text-xs">
          {Object.entries(WORKLOAD_FRAMEWORKS).map(([key, f]) => (
            <button key={key} className={`px-2.5 py-1 ${framework === key ? "bg-emerald-600 text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}
              onClick={() => { setFramework(key); setSelected([]); }}>{f.label}</button>
          ))}
        </div>
        <span className="ml-auto text-sm font-bold tabular-nums text-gray-900">{preview.score.toFixed(1)}<span className="text-gray-400 font-normal text-xs"> % of one nurse</span></span>
        <button className="text-xs text-gray-400 hover:text-gray-600" onClick={() => setOpen(false)}>Close</button>
      </div>

      {groups.grouped.map(([group, items]) => {
        const current = selected.find(k => items.some(i => i.key === k)) ?? null;
        return (
          <div key={group} className="border border-gray-200 bg-white rounded-lg p-2.5">
            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              <label className="flex items-center gap-1.5 text-xs text-gray-500">
                <input type="radio" name={`g-${group}-${patientId}`} checked={current === null} onChange={() => pickGroup(items, null)} /> None
              </label>
              {items.map(it => (
                <label key={it.key} className="flex items-center gap-1.5 text-xs text-gray-700">
                  <input type="radio" name={`g-${group}-${patientId}`} checked={current === it.key} onChange={() => pickGroup(items, it.key)} />
                  {it.label} <span className="text-gray-400 tabular-nums">({it.weight})</span>
                </label>
              ))}
            </div>
          </div>
        );
      })}
      <div className="grid sm:grid-cols-2 gap-x-4 gap-y-1.5">
        {groups.singles.map(it => (
          <label key={it.key} className="flex items-center gap-1.5 text-xs text-gray-700">
            <input type="checkbox" checked={selected.includes(it.key)} onChange={() => toggleSingle(it.key)} />
            {it.label} <span className="text-gray-400 tabular-nums">({it.weight})</span>
          </label>
        ))}
      </div>

      {err && <p className="text-xs text-amber-700">{err}</p>}
      <button className={btn} disabled={busy || selected.length === 0} onClick={submit}>{busy ? "Recording…" : "Record workload"}</button>
      <p className="text-[10px] text-gray-400">Your cumulative load across assigned patients is recalculated on every record; exceeding 100% notifies your supervisor to consider rebalancing.</p>
    </div>
  );
}
