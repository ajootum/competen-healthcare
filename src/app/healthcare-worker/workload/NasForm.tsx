"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { computeWorkload } from "@/lib/hww/assessments";
import { NAS_ITEMS, type WorkloadItem } from "@/lib/hww/assessments";
import { I_LEVELS, levelFromBands } from "@/lib/hww/instruments";

// ICU NAS capture (HWW-ICU-WKL-001): the Miranda activities (23 items,
// mutually-exclusive groups as radio rows) with the I1-I5 workload level +
// staffing ratio live, and a professional-judgement override with mandatory
// reason. The server recomputes authoritatively.

const btn = "px-3.5 py-2 rounded-lg bg-[var(--cmp-color-success)] text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50";
const input = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40";
const I_TONE: Record<string, string> = { I1: "bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)]", I2: "bg-lime-100 text-lime-700", I3: "bg-[var(--cmp-surface-warning)] text-yellow-800", I4: "bg-[var(--cmp-surface-warning)] text-orange-700", I5: "bg-[var(--cmp-surface-critical)] text-[var(--cmp-text-critical)]" };

export default function NasForm({ patientId, patientLabel }: { patientId: string; patientLabel: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [overrideLevel, setOverrideLevel] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const preview = useMemo(() => {
    const r = computeWorkload("nas", selected);
    const band = levelFromBands(r.score, I_LEVELS);
    return { ...r, band };
  }, [selected]);

  const groups = useMemo(() => {
    const g = new Map<string, WorkloadItem[]>();
    const singles: WorkloadItem[] = [];
    for (const it of NAS_ITEMS) {
      if (it.group) g.set(it.group, [...(g.get(it.group) ?? []), it]);
      else singles.push(it);
    }
    return { grouped: [...g.entries()], singles };
  }, []);

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
      body: JSON.stringify({
        kind: "workload", patient_id: patientId, framework: "nas", payload: selected,
        override_level: overrideLevel || undefined, override_reason: overrideReason || undefined,
      }),
    });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setErr(d.error ?? "Failed"); return; }
    setOpen(false); setSelected([]); setOverrideLevel(""); setOverrideReason("");
    router.refresh();
  }

  if (!open) return <button className="px-2.5 py-1 rounded-lg border border-gray-300 text-xs text-gray-700 hover:bg-gray-50" onClick={() => setOpen(true)}>+ Assess (NAS)</button>;

  return (
    <div className="mt-3 border border-[var(--cmp-color-success)] rounded-lg p-4 space-y-3 bg-[var(--cmp-surface-success)]/30 w-full">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-sm font-semibold text-gray-800">NAS Workload — {patientLabel}</h4>
        <span className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full tabular-nums ${I_TONE[preview.band.level] ?? I_TONE.I1}`}>
          {preview.score.toFixed(1)}% · {preview.band.level} {preview.band.label} · {preview.band.ratio}
        </span>
        <button className="ml-auto text-xs text-gray-400 hover:text-gray-600" onClick={() => setOpen(false)}>Close</button>
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

      <div className="grid sm:grid-cols-2 gap-2">
        <label className="text-xs text-gray-600">Professional judgement override (optional)
          <select className={input} value={overrideLevel} onChange={e => setOverrideLevel(e.target.value)}>
            <option value="">— None —</option>
            {I_LEVELS.map(l => <option key={l.level} value={l.level}>{l.level} ({l.label}, {l.ratio})</option>)}
          </select>
        </label>
        {overrideLevel && (
          <label className="text-xs text-gray-600">Override reason (required)
            <input className={input} placeholder="Why the computed level is overridden" value={overrideReason} onChange={e => setOverrideReason(e.target.value)} />
          </label>
        )}
      </div>

      {err && <p className="text-xs text-[var(--cmp-text-warning)]">{err}</p>}
      <button className={btn} disabled={busy || selected.length === 0} onClick={submit}>{busy ? "Recording…" : "Record NAS"}</button>
      <p className="text-[10px] text-gray-400">Bands: I1 0-20 (1:3) · I2 21-40 (1:2) · I3 41-60 (1:1) · I4 61-80 (1:1 + support) · I5 81+ (dedicated) — Competen defaults, configurable. Level changes trigger assignment review.</p>
    </div>
  );
}
