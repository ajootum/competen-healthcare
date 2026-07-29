"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/* eslint-disable @typescript-eslint/no-explicit-any */
const GROUPS = [
  { v: "self", label: "Self" }, { v: "peer", label: "Peer" }, { v: "supervisor", label: "Supervisor" }, { v: "subordinate", label: "Direct Reports" },
  { v: "team", label: "Team" }, { v: "patient", label: "Patient" }, { v: "family", label: "Family" }, { v: "external", label: "External" },
];
const SCALES = [{ v: "likert5", label: "5-point Likert" }, { v: "likert3", label: "3-point" }, { v: "bars", label: "BARS" }, { v: "global", label: "Global rating" }, { v: "binary", label: "Binary" }];
const groupLabel = (g: string) => GROUPS.find(x => x.v === g)?.label ?? g;
const STATUS_TONE: Record<string, string> = { draft: "text-gray-500 bg-gray-50 border-gray-200", active: "text-teal-600 bg-teal-50 border-teal-200", archived: "text-gray-400 bg-gray-50 border-gray-200" };

export default function ThreeSixtyManager({ assessments }: { assessments: any[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [scale, setScale] = useState("likert5");
  const [open, setOpen] = useState<string | null>(null);
  const [gType, setGType] = useState("supervisor");
  const [gWeight, setGWeight] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const call = async (url: string, opts: RequestInit) => { setBusy(true); const r = await fetch(url, opts); setBusy(false); if (!r.ok) { const j = await r.json().catch(() => ({})); setErr(j.error ?? "Request failed."); return false; } setErr(null); router.refresh(); return true; };

  async function create() {
    if (!name.trim()) { setErr("Name the assessment."); return; }
    if (await call("/api/studio/three-sixty", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, rating_scale: scale }) })) { setName(""); setScale("likert5"); }
  }
  const setStatus = (id: string, status: string) => call(`/api/studio/three-sixty?id=${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
  const del = (id: string) => call(`/api/studio/three-sixty?id=${id}`, { method: "DELETE" });
  const removeG = (gid: string) => call(`/api/studio/three-sixty/groups?id=${gid}`, { method: "DELETE" });
  async function addG(aid: string) {
    const w = parseInt(gWeight, 10);
    if (!Number.isFinite(w) || w < 0 || w > 100) { setErr("Weight must be 0–100."); return; }
    if (await call("/api/studio/three-sixty/groups", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ assessment_id: aid, group_type: gType, weight: w }) })) { setGWeight(""); }
  }

  const inp = "text-xs border border-gray-200 rounded-lg px-2.5 py-2 bg-white focus:outline-none focus:ring-1 focus:ring-teal-400";

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-white rounded-xl border border-gray-100 p-5">
        <h2 className="font-semibold text-gray-900 text-sm mb-3">New 360° assessment</h2>
        <div className="flex flex-col sm:flex-row gap-2">
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Assessment name (e.g. Leadership 360°)" className={`${inp} flex-1`} />
          <select value={scale} onChange={e => setScale(e.target.value)} className={`${inp} sm:w-44`}>{SCALES.map(s => <option key={s.v} value={s.v}>{s.label}</option>)}</select>
          <button onClick={create} disabled={busy} className="text-xs font-semibold text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-50 rounded-lg px-4 py-2 whitespace-nowrap">{busy ? "…" : "Create"}</button>
        </div>
        {err && <p className="text-[11px] text-red-600 mt-1">{err}</p>}
      </div>

      {assessments.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-6 text-center text-xs text-gray-400">No 360° assessments yet — create one, then add weighted respondent groups (they should sum to 100%).</div>
      ) : assessments.map((a: any) => (
        <div key={a.id} className="bg-white rounded-xl border border-gray-100 p-4">
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => setOpen(open === a.id ? null : a.id)} className="text-sm font-bold text-gray-900 hover:text-teal-700">{open === a.id ? "▾" : "▸"} {a.name}</button>
            <span className="text-[10px] font-semibold text-gray-500 bg-gray-50 border border-gray-100 rounded px-1.5 py-0.5">{a.scaleLabel}</span>
            {a.anonymous && <span className="text-[10px] text-gray-400">anonymous · min {a.minRaters}</span>}
            <span className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border ${STATUS_TONE[a.status] ?? STATUS_TONE.draft}`}>{a.status}</span>
            <div className="ml-auto flex items-center gap-2 text-xs">
              <span className={a.balanced ? "text-teal-600 font-semibold" : a.weightSum > 0 ? "text-amber-600" : "text-gray-400"}>{a.weightSum}% weighted{a.balanced ? " ✓" : ""}</span>
              <span className="text-gray-400">{a.groups.length} group{a.groups.length === 1 ? "" : "s"}</span>
              <button onClick={() => del(a.id)} disabled={busy} className="text-gray-300 hover:text-red-500" title="Delete">✕</button>
            </div>
          </div>

          {open === a.id && (
            <div className="mt-3 ml-4 border-l-2 border-gray-50 pl-3">
              {a.groups.length > 0 && (
                <div className="flex flex-col divide-y divide-gray-50 mb-2">
                  {a.groups.map((g: any) => (
                    <div key={g.id} className="flex items-center gap-3 py-1.5 text-xs">
                      <span className="font-semibold text-gray-700 w-32">{groupLabel(g.group_type)}</span>
                      <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden max-w-[240px]"><div className="h-full rounded-full bg-teal-500" style={{ width: `${Math.min(100, g.weight)}%` }} /></div>
                      <span className="font-semibold text-gray-900 w-10 text-right tabular-nums">{g.weight}%</span>
                      <button onClick={() => removeG(g.id)} disabled={busy} className="text-gray-300 hover:text-red-500 shrink-0" title="Remove">✕</button>
                    </div>
                  ))}
                  <div className="flex items-center gap-3 py-1.5 text-xs font-semibold">
                    <span className="w-32 text-gray-500">Total</span>
                    <span className="flex-1" />
                    <span className={`w-10 text-right ${a.balanced ? "text-teal-600" : "text-amber-600"}`}>{a.weightSum}%</span>
                    <span className="w-4" />
                  </div>
                </div>
              )}
              <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
                <select value={gType} onChange={e => setGType(e.target.value)} className={`${inp} sm:w-40`}>{GROUPS.map(g => <option key={g.v} value={g.v}>{g.label}</option>)}</select>
                <input value={gWeight} onChange={e => setGWeight(e.target.value)} type="number" min="0" max="100" placeholder="Weight %" className={`${inp} sm:w-28`} />
                <button onClick={() => addG(a.id)} disabled={busy} className="text-xs font-semibold text-teal-700 border border-teal-200 bg-teal-50 hover:bg-teal-100 rounded-lg px-3 py-2 whitespace-nowrap">Add group</button>
                {a.balanced && a.status !== "active" && <button onClick={() => setStatus(a.id, "active")} disabled={busy} className="text-[11px] font-semibold text-teal-700 hover:underline sm:ml-2">Activate →</button>}
                {a.status === "active" && <button onClick={() => setStatus(a.id, "archived")} disabled={busy} className="text-[11px] font-semibold text-gray-400 hover:underline sm:ml-2">Archive</button>}
              </div>
              {!a.balanced && a.weightSum !== 100 && <p className="text-[10px] text-amber-600 mt-1">Respondent-group weights sum to {a.weightSum}% — adjust to 100% to activate.</p>}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
