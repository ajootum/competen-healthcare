"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/* eslint-disable @typescript-eslint/no-explicit-any */
const TYPES = [
  { v: "mock_code", label: "Mock Code" }, { v: "emergency", label: "Emergency Response" }, { v: "virtual_patient", label: "Virtual Patient" },
  { v: "skills", label: "Clinical Skills" }, { v: "team", label: "Team Simulation" }, { v: "procedure", label: "Procedure" },
  { v: "communication", label: "Communication" }, { v: "disaster", label: "Disaster" }, { v: "orientation", label: "Orientation" },
  { v: "reassessment", label: "Reassessment" }, { v: "clinical", label: "Clinical" },
];
const DIFF = [{ v: "beginner", label: "Beginner", color: "#10b981" }, { v: "intermediate", label: "Intermediate", color: "#f59e0b" }, { v: "advanced", label: "Advanced", color: "#ef4444" }];
const typeLabel = (t: string) => TYPES.find(x => x.v === t)?.label ?? t;
const diffColor = (d: string) => DIFF.find(x => x.v === d)?.color ?? "#9ca3af";
const diffLabel = (d: string) => DIFF.find(x => x.v === d)?.label ?? d;
const STATUS_TONE: Record<string, string> = { draft: "text-gray-500 bg-gray-50 border-gray-200", published: "text-teal-600 bg-teal-50 border-teal-200", archived: "text-gray-400 bg-gray-50 border-gray-200" };

export default function SimulationManager({ scenarios, competencyOptions }: { scenarios: any[]; competencyOptions: { id: string; label: string }[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [type, setType] = useState("mock_code");
  const [comp, setComp] = useState("");
  const [difficulty, setDifficulty] = useState("intermediate");
  const [participants, setParticipants] = useState("1");
  const [duration, setDuration] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const call = async (url: string, opts: RequestInit) => { setBusy(true); const r = await fetch(url, opts); setBusy(false); if (!r.ok) { const j = await r.json().catch(() => ({})); setErr(j.error ?? "Request failed."); return false; } setErr(null); router.refresh(); return true; };

  async function create() {
    if (!name.trim()) { setErr("Name the scenario."); return; }
    const compLabel = competencyOptions.find(o => o.id === comp)?.label ?? null;
    if (await call("/api/studio/simulations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, scenario_type: type, competency_id: comp || null, competency_name: compLabel, difficulty, participants, duration_min: duration }) })) {
      setName(""); setComp(""); setParticipants("1"); setDuration(""); setType("mock_code"); setDifficulty("intermediate");
    }
  }
  const setStatus = (id: string, status: string) => call(`/api/studio/simulations?id=${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
  const del = (id: string) => call(`/api/studio/simulations?id=${id}`, { method: "DELETE" });

  const inp = "text-xs border border-gray-200 rounded-lg px-2.5 py-2 bg-white focus:outline-none focus:ring-1 focus:ring-teal-400";

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-white rounded-xl border border-gray-100 p-5">
        <h2 className="font-semibold text-gray-900 text-sm mb-3">Author a scenario</h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 mb-2">
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Scenario name" className={inp} />
          <select value={type} onChange={e => setType(e.target.value)} className={inp}>{TYPES.map(t => <option key={t.v} value={t.v}>{t.label}</option>)}</select>
          <select value={comp} onChange={e => setComp(e.target.value)} className={inp}><option value="">Link competency (optional)…</option>{competencyOptions.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}</select>
          <select value={difficulty} onChange={e => setDifficulty(e.target.value)} className={inp}>{DIFF.map(d => <option key={d.v} value={d.v}>{d.label}</option>)}</select>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
          <input value={participants} onChange={e => setParticipants(e.target.value)} type="number" min="1" placeholder="Participants" className={`${inp} sm:w-32`} />
          <input value={duration} onChange={e => setDuration(e.target.value)} type="number" min="1" placeholder="Duration (min)" className={`${inp} sm:w-36`} />
          <button onClick={create} disabled={busy} className="text-xs font-semibold text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-50 rounded-lg px-4 py-2">{busy ? "…" : "Create scenario"}</button>
          {err && <p className="text-[11px] text-red-600 sm:ml-1">{err}</p>}
        </div>
      </div>

      {scenarios.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-6 text-center text-xs text-gray-400">No scenarios yet — author one above. The branching flow-builder is the next-phase layer on top of this store.</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <h3 className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-2">Scenarios ({scenarios.length})</h3>
          <div className="flex flex-col divide-y divide-gray-50">
            {scenarios.map((s: any) => (
              <div key={s.id} className="flex items-center gap-2 py-2 text-xs flex-wrap">
                <span className="font-semibold text-gray-800 truncate max-w-[30%]">{s.name}</span>
                <span className="text-[10px] font-semibold text-gray-500 bg-gray-50 border border-gray-100 rounded px-1.5 py-0.5 shrink-0">{typeLabel(s.scenario_type)}</span>
                <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded shrink-0" style={{ color: diffColor(s.difficulty), backgroundColor: `${diffColor(s.difficulty)}14` }}>{diffLabel(s.difficulty)}</span>
                {s.competency_name && <span className="text-[10px] text-gray-400 truncate max-w-[24%] hidden md:inline">↔ {s.competency_name}</span>}
                <span className="text-[10px] text-gray-400">{s.participants ?? 1}p{s.duration_min ? ` · ${s.duration_min}m` : ""}</span>
                <span className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border ${STATUS_TONE[s.status] ?? STATUS_TONE.draft}`}>{s.status}</span>
                <div className="ml-auto flex items-center gap-1.5">
                  {s.status !== "published" && <button onClick={() => setStatus(s.id, "published")} disabled={busy} className="text-[10px] font-semibold text-teal-700 hover:underline">Publish</button>}
                  {s.status !== "archived" ? <button onClick={() => setStatus(s.id, "archived")} disabled={busy} className="text-[10px] font-semibold text-gray-400 hover:underline">Archive</button>
                    : <button onClick={() => setStatus(s.id, "draft")} disabled={busy} className="text-[10px] font-semibold text-gray-500 hover:underline">Restore</button>}
                  <button onClick={() => del(s.id)} disabled={busy} className="text-gray-300 hover:text-red-500" title="Delete">✕</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
