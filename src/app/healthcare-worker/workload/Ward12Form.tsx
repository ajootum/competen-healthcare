"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { WARD12_DOMAINS, WARD12_MODIFIERS, W_LEVELS, computeWard12 } from "@/lib/hww/instruments";

// Ward workload capture (HWW-WARD-WKL-001): 12 domains scored 0-3, optional
// admission/transfer/observation modifiers, live W1-W5 + ratio preview, and a
// professional-judgement override with mandatory reason. Server recomputes.

const btn = "px-3.5 py-2 rounded-lg bg-[var(--cmp-color-success)] text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50";
const input = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40";
const W_TONE: Record<string, string> = { W1: "bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)]", W2: "bg-lime-100 text-lime-700", W3: "bg-[var(--cmp-surface-warning)] text-yellow-800", W4: "bg-[var(--cmp-surface-warning)] text-orange-700", W5: "bg-[var(--cmp-surface-critical)] text-[var(--cmp-text-critical)]" };

export default function Ward12Form({ patientId, patientLabel }: { patientId: string; patientLabel: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [domains, setDomains] = useState<Record<string, number>>({});
  const [mods, setMods] = useState<string[]>([]);
  const [overrideLevel, setOverrideLevel] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const preview = useMemo(() => {
    const filled = Object.fromEntries(WARD12_DOMAINS.map(d => [d.key, domains[d.key] ?? 0]));
    return computeWard12({ domains: filled, modifiers: mods });
  }, [domains, mods]);

  async function submit() {
    setBusy(true); setErr(null);
    const filled = Object.fromEntries(WARD12_DOMAINS.map(d => [d.key, domains[d.key] ?? 0]));
    const r = await fetch("/api/operations/assessments", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "workload", patient_id: patientId, framework: "ward12",
        payload: { domains: filled, modifiers: mods },
        override_level: overrideLevel || undefined, override_reason: overrideReason || undefined,
      }),
    });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setErr(d.error ?? "Failed"); return; }
    setOpen(false); setDomains({}); setMods([]); setOverrideLevel(""); setOverrideReason("");
    router.refresh();
  }

  if (!open) return <button className="px-2.5 py-1 rounded-lg border border-gray-300 text-xs text-gray-700 hover:bg-gray-50" onClick={() => setOpen(true)}>+ Assess</button>;

  return (
    <div className="mt-3 border border-[var(--cmp-color-success)] rounded-lg p-4 space-y-3 bg-[var(--cmp-surface-success)]/30 w-full">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-sm font-semibold text-gray-800">Ward Workload — {patientLabel}</h4>
        <span className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full tabular-nums ${W_TONE[preview.level] ?? W_TONE.W1}`}>
          {preview.score} pts · {preview.level} {preview.levelLabel} · {preview.ratio}
        </span>
        <button className="ml-auto text-xs text-gray-400 hover:text-gray-600" onClick={() => setOpen(false)}>Close</button>
      </div>

      <div className="grid sm:grid-cols-2 gap-x-4 gap-y-1.5">
        {WARD12_DOMAINS.map(d => (
          <label key={d.key} className="flex items-center gap-2 text-xs text-gray-700">
            <span className="flex-1">{d.label}</span>
            <span className="flex gap-1">
              {[0, 1, 2, 3].map(v => (
                <button key={v} onClick={() => setDomains({ ...domains, [d.key]: v })}
                  className={`w-7 h-7 rounded-lg text-xs font-semibold tabular-nums border ${(domains[d.key] ?? 0) === v ? "bg-[var(--cmp-color-success)] text-white border-emerald-600" : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"}`}>
                  {v}
                </button>
              ))}
            </span>
          </label>
        ))}
      </div>

      <div>
        <p className="text-xs font-semibold text-gray-600 mb-1">Modifiers (optional)</p>
        <div className="grid sm:grid-cols-2 gap-x-4 gap-y-1">
          {WARD12_MODIFIERS.map(m => (
            <label key={m.key} className="flex items-center gap-1.5 text-xs text-gray-700">
              <input type="checkbox" checked={mods.includes(m.key)} onChange={() => setMods(mods.includes(m.key) ? mods.filter(x => x !== m.key) : [...mods, m.key])} />
              {m.label} <span className="text-gray-400 tabular-nums">(+{m.weight})</span>
            </label>
          ))}
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-2">
        <label className="text-xs text-gray-600">Professional judgement override (optional)
          <select className={input} value={overrideLevel} onChange={e => setOverrideLevel(e.target.value)}>
            <option value="">— None —</option>
            {W_LEVELS.map(l => <option key={l.level} value={l.level}>{l.level} ({l.label}, {l.ratio})</option>)}
          </select>
        </label>
        {overrideLevel && (
          <label className="text-xs text-gray-600">Override reason (required)
            <input className={input} placeholder="Why the computed level is overridden" value={overrideReason} onChange={e => setOverrideReason(e.target.value)} />
          </label>
        )}
      </div>

      {err && <p className="text-xs text-[var(--cmp-text-warning)]">{err}</p>}
      <button className={btn} disabled={busy} onClick={submit}>{busy ? "Saving…" : "Save workload"}</button>
      <p className="text-[10px] text-gray-400">Bands: W1 0-7 (1:6) · W2 8-14 (1:5) · W3 15-22 (1:4) · W4 23-30 (1:3) · W5 31+ (1:2) — Competen defaults, configurable by nursing governance. Level changes trigger assignment review.</p>
    </div>
  );
}
