"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// What-if Simulator controls (WSE-001H) — interactive parameter sliders that drive the
// server-side re-run via URL params. Apply regenerates the LIVE roster from real data
// (hypothetical inputs are planning-only); Discard resets. The simulation itself never
// alters a live roster.
export default function SimControls({ params }: { params: { absent: number; surge: number; bank: number } }) {
  const router = useRouter();
  const [absent, setAbsent] = useState(params.absent);
  const [surge, setSurge] = useState(params.surge);
  const [bank, setBank] = useState(params.bank);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  function simulate() {
    const q = new URLSearchParams();
    if (absent) q.set("absent", String(absent));
    if (surge) q.set("surge", String(surge));
    if (bank) q.set("bank", String(bank));
    router.push(`/unit-manager/scheduling-engine/what-if${q.toString() ? `?${q}` : ""}`);
  }
  function discard() { setAbsent(0); setSurge(0); setBank(0); setMsg(null); router.push("/unit-manager/scheduling-engine/what-if"); }

  async function apply() {
    setBusy("apply"); setMsg(null);
    const res = await fetch("/api/operations/rosters", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
    setBusy(null);
    if (!res.ok) { const j = await res.json().catch(() => ({})); setMsg(j.error ?? "Apply failed"); return; }
    setMsg("Live roster regenerated from current data. Simulated hypotheticals (bank/absence) are planning-only.");
  }

  const slider = (label: string, value: number, set: (n: number) => void, max: number, step: number, suffix: string) => (
    <div>
      <div className="flex items-center justify-between mb-1"><span className="text-xs text-gray-600">{label}</span><span className="text-xs font-bold text-gray-900">{value}{suffix}</span></div>
      <input type="range" min={0} max={max} step={step} value={value} onChange={(e) => set(Number(e.target.value))} className="w-full accent-emerald-600" />
    </div>
  );

  return (
    <div className="space-y-3">
      {slider("Staff absences / no-shows", absent, setAbsent, 8, 1, " staff")}
      {slider("Census / occupancy surge", surge, setSurge, 50, 5, "%")}
      {slider("Add bank capacity", bank, setBank, 8, 1, " RNs")}
      <div className="flex gap-2 pt-1">
        <button onClick={simulate} className="flex-1 text-xs font-semibold rounded-lg py-2 px-3 bg-emerald-600 text-white">▶ Simulate</button>
        <button onClick={discard} className="text-xs font-semibold rounded-lg py-2 px-3 border border-gray-200 text-gray-600">Discard</button>
      </div>
      <button onClick={apply} disabled={!!busy} className="w-full text-xs font-semibold rounded-lg py-2 px-3 border border-emerald-300 text-emerald-700 disabled:opacity-50">{busy === "apply" ? "Applying…" : "Apply → regenerate live roster"}</button>
      {msg && <p className="text-[10px] text-gray-500">{msg}</p>}
    </div>
  );
}
