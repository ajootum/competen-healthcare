"use client";

import { useState } from "react";

// What-If Simulator (Predictive Intelligence spec §6). Client-side, deterministic
// rule model: adjust the assessor count and immediately see the projected effect
// on the validation backlog and turnaround. It changes NO production data — it's
// a transparent formula, not a trained model, and is labelled as such.
//
// Model: each assessor above the current count clears ~ (backlog / current)
// additional items per cycle, so projected backlog ≈ backlog × current / new,
// and turnaround scales inversely with capacity. Confidence falls as the change
// moves further from the observed baseline (extrapolation uncertainty).

export default function WhatIf({ currentAssessors, currentBacklog }: { currentAssessors: number; currentBacklog: number }) {
  const base = Math.max(1, currentAssessors);
  const [value, setValue] = useState(base);

  const capacityRatio = value / base;
  const projectedBacklog = Math.max(0, Math.round(currentBacklog / capacityRatio));
  const backlogDelta = currentBacklog > 0 ? Math.round(((projectedBacklog - currentBacklog) / currentBacklog) * 100) : 0;
  const turnaroundDelta = Math.round((1 / capacityRatio - 1) * 100);
  const readinessDelta = Math.max(0, Math.round((value - base) * 0.8));
  const drift = Math.abs(value - base) / base;
  const confidence = Math.max(50, Math.round(90 - drift * 30));

  return (
    <div>
      <label className="block text-[10px] text-slate-500 mb-1">Variable</label>
      <div className="rounded-lg bg-white/[0.05] border border-white/10 px-2.5 py-1.5 text-[12px] text-slate-200 mb-3">Number of Assessors</div>

      <div className="flex items-center justify-between text-[10px] text-slate-500 mb-1"><span>Current: {base}</span><span>New: <span className="text-white font-bold">{value}</span></span></div>
      <input type="range" min={Math.max(1, base - 4)} max={base + 8} value={value} onChange={e => setValue(Number(e.target.value))}
        className="w-full accent-violet-500 mb-3" />

      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg bg-white/[0.03] border border-white/10 p-2">
          <p className={`text-sm font-extrabold ${backlogDelta <= 0 ? "text-emerald-400" : "text-rose-400"}`}>{backlogDelta > 0 ? "↑" : "↓"}{Math.abs(backlogDelta)}%</p>
          <p className="text-[8px] text-slate-500 leading-tight">Backlog ({projectedBacklog})</p>
        </div>
        <div className="rounded-lg bg-white/[0.03] border border-white/10 p-2">
          <p className={`text-sm font-extrabold ${turnaroundDelta <= 0 ? "text-emerald-400" : "text-rose-400"}`}>{turnaroundDelta > 0 ? "↑" : "↓"}{Math.abs(turnaroundDelta)}%</p>
          <p className="text-[8px] text-slate-500 leading-tight">Turnaround</p>
        </div>
        <div className="rounded-lg bg-white/[0.03] border border-white/10 p-2">
          <p className="text-sm font-extrabold text-slate-200">{confidence}%</p>
          <p className="text-[8px] text-slate-500 leading-tight">Confidence</p>
        </div>
      </div>
      <p className="text-[9px] text-slate-500 mt-2">Projected readiness impact +{readinessDelta}%. Deterministic rule model, computed in-browser — no production data changes.</p>
    </div>
  );
}
