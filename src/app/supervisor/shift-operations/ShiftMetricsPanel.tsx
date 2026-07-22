"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { METRIC_DEFS } from "@/lib/operations/shift-metrics";

// Persisted shift metrics (SSW-002 §19). Live KPIs are always shown (derived by
// the engine); when the metrics table exists, the supervisor can persist them for
// this shift and see a cross-shift trend. Persist writes through the audited API.
/* eslint-disable @typescript-eslint/no-explicit-any */

type Kpis = Record<string, number | null> | null;
type TrendRow = { shift_id: string; overall_score: number | null; computed_at: string };

const scoreTone = (n: number | null) => (n == null ? "text-gray-300" : n >= 90 ? "text-green-600" : n >= 75 ? "text-amber-600" : "text-rose-600");
const fmt = (v: number | null, unit: string) => (v == null ? "—" : unit === "pct" ? `${v}%` : String(v));

export default function ShiftMetricsPanel({ shiftId, provisioned, live, persisted, trend, editable }: {
  shiftId: string | null; provisioned: boolean; live: Kpis; persisted: any; trend: TrendRow[]; editable: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function persist() {
    if (!shiftId) return;
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/operations/shift-metrics`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ shift_id: shiftId }) });
      if (!res.ok) { const j = await res.json().catch(() => ({})); setErr(j.error ?? "Compute failed"); return; }
      router.refresh();
    } catch { setErr("Network error"); }
    finally { setBusy(false); }
  }

  const k = live ?? {};
  const score = (k.overall_score ?? null) as number | null;
  const trendMax = Math.max(1, ...trend.map(t => t.overall_score ?? 0));

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-sm font-bold text-gray-900">Shift Metrics</h2>
          <p className="text-[11px] text-gray-500">Live KPIs derived by the engine (SSW-002 §19)</p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <div className="text-right">
            <p className={`text-2xl font-bold tabular-nums leading-none ${scoreTone(score)}`}>{score == null ? "—" : `${score}%`}</p>
            <p className="text-[9px] text-gray-400 uppercase">Overall</p>
          </div>
          {provisioned && editable && (
            <button onClick={persist} disabled={busy} className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50">{busy ? "…" : "Compute & persist"}</button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {METRIC_DEFS.filter(m => m.key !== "overall_score").map((m) => (
          <div key={m.key} className="rounded-lg border border-gray-100 p-2 text-center">
            <p className={`text-base font-bold tabular-nums ${m.unit === "pct" ? scoreTone((k[m.key] ?? null) as number | null) : "text-gray-900"}`}>{fmt((k[m.key] ?? null) as number | null, m.unit)}</p>
            <p className="text-[8px] text-gray-500 uppercase tracking-wide truncate">{m.label}</p>
          </div>
        ))}
      </div>

      {!provisioned ? (
        <p className="text-[10px] text-gray-400 mt-3">Live only — run migration <span className="font-mono">068-shift-metrics</span> to persist per-shift KPIs and trend across shifts.</p>
      ) : (
        <div className="mt-3 pt-3 border-t border-gray-100">
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-[10px] font-semibold text-gray-400 uppercase">Overall-score trend (last {trend.length || 0})</p>
            {persisted?.computed_at && <p className="text-[10px] text-gray-400">saved {new Date(persisted.computed_at).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</p>}
          </div>
          {trend.length === 0 ? (
            <p className="text-xs text-gray-400">No persisted metrics yet — compute to start the trend.</p>
          ) : (
            <div className="flex items-end gap-1 h-16">
              {trend.map((t, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-0.5" title={`${t.overall_score ?? "—"}%`}>
                  <div className={`w-full rounded-t ${(t.overall_score ?? 0) >= 90 ? "bg-green-400" : (t.overall_score ?? 0) >= 75 ? "bg-amber-400" : "bg-rose-400"}`} style={{ height: `${((t.overall_score ?? 0) / trendMax) * 100}%`, minHeight: (t.overall_score ?? 0) > 0 ? "3px" : "0" }} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {err && <p className="text-[11px] text-rose-600 mt-2">{err}</p>}
    </div>
  );
}
