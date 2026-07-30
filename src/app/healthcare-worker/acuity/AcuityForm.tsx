"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ACUITY_FRAMEWORKS, computeAcuity } from "@/lib/hww/assessments";

// Acuity capture (Competen Ward / ICU Acuity Assessment). Six domains 0-3 with
// a live preview; the SERVER recomputes the authoritative score from the same
// engine. Repeated reassessment is the point — every submission is a new row.

const input = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40";
const btn = "px-3.5 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50";
const LEVEL_TONE: Record<string, string> = { stable: "bg-green-100 text-green-700", moderate: "bg-yellow-100 text-yellow-700", high: "bg-orange-100 text-orange-700", critical: "bg-red-100 text-red-700" };

export default function AcuityForm({ patientId, patientLabel, defaultFramework }: { patientId: string; patientLabel: string; defaultFramework: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [framework, setFramework] = useState(defaultFramework);
  const [domains, setDomains] = useState<Record<string, number>>({});
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const fw = ACUITY_FRAMEWORKS[framework] ?? ACUITY_FRAMEWORKS.ward;
  const preview = useMemo(() => {
    const filled = Object.fromEntries(fw.domains.map(d => [d.key, domains[d.key] ?? 0]));
    return computeAcuity(framework, filled);
  }, [framework, domains, fw.domains]);

  function switchFramework(f: string) { setFramework(f); setDomains({}); }

  async function submit() {
    setBusy(true); setErr(null);
    const filled = Object.fromEntries(fw.domains.map(d => [d.key, domains[d.key] ?? 0]));
    const r = await fetch("/api/operations/assessments", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "acuity", patient_id: patientId, framework, domains: filled, notes }),
    });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setErr(d.error ?? "Failed"); return; }
    setOpen(false); setDomains({}); setNotes("");
    router.refresh();
  }

  if (!open) return <button className="px-2.5 py-1 rounded-lg border border-gray-300 text-xs text-gray-700 hover:bg-gray-50" onClick={() => setOpen(true)}>+ Assess</button>;

  return (
    <div className="mt-3 border border-emerald-200 rounded-lg p-4 space-y-3 bg-emerald-50/30">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-sm font-semibold text-gray-800">Assess {patientLabel}</h4>
        <div className="flex rounded-lg border border-gray-300 overflow-hidden text-xs">
          {Object.entries(ACUITY_FRAMEWORKS).map(([key, f]) => (
            <button key={key} className={`px-2.5 py-1 ${framework === key ? "bg-emerald-600 text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}
              onClick={() => switchFramework(key)}>{f.label}</button>
          ))}
        </div>
        <span className="ml-auto flex items-center gap-2 text-sm">
          <span className="font-bold tabular-nums text-gray-900">{preview.score}<span className="text-gray-400 font-normal">/18</span></span>
          <span className={`text-[10px] px-2 py-0.5 rounded-full ${LEVEL_TONE[preview.level]}`}>{preview.level}</span>
        </span>
        <button className="text-xs text-gray-400 hover:text-gray-600" onClick={() => setOpen(false)}>Close</button>
      </div>
      <div className="grid sm:grid-cols-2 gap-2.5">
        {fw.domains.map(d => (
          <label key={d.key} className="text-sm">
            <span className="text-gray-700 text-xs font-medium">{d.label}</span>
            <select className={input} value={domains[d.key] ?? 0} onChange={e => setDomains({ ...domains, [d.key]: Number(e.target.value) })}>
              {[0, 1, 2, 3].map(v => <option key={v} value={v}>{v}</option>)}
            </select>
            <span className="text-[10px] text-gray-400">{d.hint}</span>
          </label>
        ))}
      </div>
      <input className={input} placeholder="Notes (optional)" value={notes} onChange={e => setNotes(e.target.value)} />
      {err && <p className="text-xs text-amber-700">{err}</p>}
      <button className={btn} disabled={busy} onClick={submit}>{busy ? "Recording…" : "Record assessment"}</button>
      <p className="text-[10px] text-gray-400">A jump of ≥4 points or a level change flags the assignment for supervisor review. The patient&apos;s acuity level updates across every workspace immediately.</p>
    </div>
  );
}
