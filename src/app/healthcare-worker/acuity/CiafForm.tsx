"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AACN_CHARACTERISTICS, RASS_OPTIONS, CAM_OPTIONS, ORGAN_SUPPORTS, CIAF_RISK_MODIFIERS, computeCiaf } from "@/lib/hww/instruments";

// CIAF capture (HWW-ICU-ACU-001): the Competen default profile — AACN Synergy
// characteristics (1 worst .. 5 best), RASS + CAM-ICU, organ support and risk
// modifiers — composited /100 to A1-A5 with a live preview. The server
// recomputes authoritatively; individual tool results are retained.

const btn = "px-3.5 py-2 rounded-lg bg-[var(--cmp-color-success)] text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50";
const input = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40";
const A_TONE: Record<string, string> = { A1: "bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)]", A2: "bg-[var(--cmp-surface-warning)] text-yellow-800", A3: "bg-[var(--cmp-surface-warning)] text-orange-700", A4: "bg-[var(--cmp-surface-critical)] text-[var(--cmp-text-critical)]", A5: "bg-[var(--cmp-surface-critical)] text-[var(--cmp-text-critical)]" };

export default function CiafForm({ patientId, patientLabel }: { patientId: string; patientLabel: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [aacn, setAacn] = useState<Record<string, number>>({});
  const [rass, setRass] = useState("0");
  const [cam, setCam] = useState("negative");
  const [supports, setSupports] = useState<string[]>([]);
  const [mods, setMods] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const preview = useMemo(() => {
    const filled = Object.fromEntries(AACN_CHARACTERISTICS.map(c => [c.key, aacn[c.key] ?? 3]));
    return computeCiaf({ aacn: filled, rass: Number(rass), cam, organ_supports: supports, risk_modifiers: mods });
  }, [aacn, rass, cam, supports, mods]);

  const toggle = (list: string[], set: (v: string[]) => void, key: string) =>
    set(list.includes(key) ? list.filter(x => x !== key) : [...list, key]);

  async function submit() {
    setBusy(true); setErr(null);
    const filled = Object.fromEntries(AACN_CHARACTERISTICS.map(c => [c.key, aacn[c.key] ?? 3]));
    const r = await fetch("/api/operations/assessments", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "acuity", patient_id: patientId, framework: "ciaf", payload: { aacn: filled, rass: Number(rass), cam, organ_supports: supports, risk_modifiers: mods }, notes }),
    });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setErr(d.error ?? "Failed"); return; }
    setOpen(false); setAacn({}); setSupports([]); setMods([]); setNotes("");
    router.refresh();
  }

  if (!open) return <button className="px-2.5 py-1 rounded-lg border border-gray-300 text-xs text-gray-700 hover:bg-gray-50" onClick={() => setOpen(true)}>+ Assess (CIAF)</button>;

  return (
    <div className="mt-3 border border-[var(--cmp-color-success)] rounded-lg p-4 space-y-3 bg-[var(--cmp-surface-success)]/30 w-full">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-sm font-semibold text-gray-800">ICU Composite Acuity — {patientLabel}</h4>
        <span className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full tabular-nums ${A_TONE[preview.level] ?? A_TONE.A1}`}>
          {preview.score}/100 · {preview.level} {preview.levelLabel} · {preview.ratio}
        </span>
        <button className="ml-auto text-xs text-gray-400 hover:text-gray-600" onClick={() => setOpen(false)}>Close</button>
      </div>

      <div>
        <p className="text-xs font-semibold text-gray-600 mb-1.5">1 · AACN Synergy characteristics <span className="font-normal text-gray-400">(1 = most compromised · 5 = most stable)</span></p>
        <div className="grid sm:grid-cols-2 gap-x-4 gap-y-1.5">
          {AACN_CHARACTERISTICS.map(c => (
            <label key={c.key} className="flex items-center gap-2 text-xs text-gray-700">
              <span className="flex-1">{c.label}</span>
              <select className="border border-gray-300 rounded-lg px-2 py-1 text-xs" value={aacn[c.key] ?? 3} onChange={e => setAacn({ ...aacn, [c.key]: Number(e.target.value) })}>
                {[1, 2, 3, 4, 5].map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </label>
          ))}
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-2">
        <label className="text-xs text-gray-600">2 · RASS (sedation/agitation)
          <select className={input} value={rass} onChange={e => setRass(e.target.value)}>
            {RASS_OPTIONS.map(v => <option key={v} value={v}>{v > 0 ? `+${v}` : v}</option>)}
          </select>
        </label>
        <label className="text-xs text-gray-600">CAM-ICU / CAPD (delirium)
          <select className={input} value={cam} onChange={e => setCam(e.target.value)}>
            {CAM_OPTIONS.map(v => <option key={v} value={v}>{v[0].toUpperCase() + v.slice(1)}</option>)}
          </select>
        </label>
      </div>

      <div>
        <p className="text-xs font-semibold text-gray-600 mb-1.5">3 · Organ support</p>
        <div className="grid sm:grid-cols-2 gap-x-4 gap-y-1">
          {ORGAN_SUPPORTS.map(s => (
            <label key={s.key} className="flex items-center gap-1.5 text-xs text-gray-700">
              <input type="checkbox" checked={supports.includes(s.key)} onChange={() => toggle(supports, setSupports, s.key)} />
              {s.label} <span className="text-gray-400 tabular-nums">(+{s.weight})</span>
            </label>
          ))}
        </div>
      </div>

      <div>
        <p className="text-xs font-semibold text-gray-600 mb-1.5">4 · Clinical risk modifiers</p>
        <div className="grid sm:grid-cols-2 gap-x-4 gap-y-1">
          {CIAF_RISK_MODIFIERS.map(m => (
            <label key={m.key} className="flex items-center gap-1.5 text-xs text-gray-700">
              <input type="checkbox" checked={mods.includes(m.key)} onChange={() => toggle(mods, setMods, m.key)} />
              {m.label} <span className="text-gray-400 tabular-nums">(+{m.weight})</span>
            </label>
          ))}
        </div>
      </div>

      <p className="text-[11px] text-gray-500">Components: AACN {preview.components.aacn}/50 · Neuro {preview.components.neuro}/20 · Organ {preview.components.organ}/20 · Risk {preview.components.risk}/10</p>
      <input className={input} placeholder="Notes (optional)" value={notes} onChange={e => setNotes(e.target.value)} />
      {err && <p className="text-xs text-[var(--cmp-text-warning)]">{err}</p>}
      <button className={btn} disabled={busy} onClick={submit}>{busy ? "Saving…" : "Save composite acuity"}</button>
      <p className="text-[10px] text-gray-400">Weights and bands are the Competen default profile; organisations refine them through governed configuration. A level change signals assignment review.</p>
    </div>
  );
}
