"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/* eslint-disable @typescript-eslint/no-explicit-any */
const DIFF = [{ v: "easy", label: "Easy" }, { v: "medium", label: "Medium" }, { v: "hard", label: "Hard" }];
const STATUS_TONE: Record<string, string> = { draft: "text-gray-500 bg-gray-50 border-gray-200", active: "text-teal-600 bg-teal-50 border-teal-200", archived: "text-gray-400 bg-gray-50 border-gray-200" };

export default function AdaptiveManager({ exams, bankOptions }: { exams: any[]; bankOptions: { id: string; label: string }[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [bank, setBank] = useState("");
  const [minItems, setMinItems] = useState("20");
  const [maxItems, setMaxItems] = useState("60");
  const [start, setStart] = useState("medium");
  const [pass, setPass] = useState("70");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const call = async (url: string, opts: RequestInit) => { setBusy(true); const r = await fetch(url, opts); setBusy(false); if (!r.ok) { const j = await r.json().catch(() => ({})); setErr(j.error ?? "Request failed."); return false; } setErr(null); router.refresh(); return true; };

  async function create() {
    if (!name.trim()) { setErr("Name the exam."); return; }
    if (await call("/api/studio/adaptive", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, bank_id: bank || null, min_items: minItems, max_items: maxItems, start_difficulty: start, pass_threshold: pass }) })) {
      setName(""); setBank(""); setMinItems("20"); setMaxItems("60"); setStart("medium"); setPass("70");
    }
  }
  const setStatus = (id: string, status: string) => call(`/api/studio/adaptive?id=${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
  const del = (id: string) => call(`/api/studio/adaptive?id=${id}`, { method: "DELETE" });

  const inp = "text-xs border border-gray-200 rounded-lg px-2.5 py-2 bg-white focus:outline-none focus:ring-1 focus:ring-teal-400";

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-white rounded-xl border border-gray-100 p-5">
        <h2 className="font-semibold text-gray-900 text-sm mb-3">New adaptive exam blueprint</h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 mb-2">
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Exam name (e.g. Critical Care Adaptive)" className={inp} />
          <select value={bank} onChange={e => setBank(e.target.value)} className={inp}><option value="">Item pool (bank)…</option>{bankOptions.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}</select>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <label className="text-[10px] text-gray-400">Length</label>
          <input value={minItems} onChange={e => setMinItems(e.target.value)} type="number" min="1" placeholder="min" className={`${inp} w-20`} />
          <span className="text-gray-300 text-xs">–</span>
          <input value={maxItems} onChange={e => setMaxItems(e.target.value)} type="number" min="1" placeholder="max" className={`${inp} w-20`} />
          <label className="text-[10px] text-gray-400 ml-2">Start</label>
          <select value={start} onChange={e => setStart(e.target.value)} className={`${inp} w-28`}>{DIFF.map(d => <option key={d.v} value={d.v}>{d.label}</option>)}</select>
          <label className="text-[10px] text-gray-400 ml-2">Pass %</label>
          <input value={pass} onChange={e => setPass(e.target.value)} type="number" min="1" max="100" className={`${inp} w-20`} />
          <button onClick={create} disabled={busy} className="text-xs font-semibold text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-50 rounded-lg px-4 py-2 ml-auto">{busy ? "…" : "Create"}</button>
        </div>
        {err && <p className="text-[11px] text-red-600 mt-1">{err}</p>}
      </div>

      {exams.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-6 text-center text-xs text-gray-400">No adaptive exams yet — create a blueprint over a question-bank item pool.</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <div className="flex flex-col divide-y divide-gray-50">
            {exams.map((e: any) => (
              <div key={e.id} className="flex items-center gap-2 py-2.5 text-xs flex-wrap">
                <span className="font-semibold text-gray-800 truncate max-w-[26%]">{e.name}</span>
                <span className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border ${STATUS_TONE[e.status] ?? STATUS_TONE.draft}`}>{e.status}</span>
                {e.bankName ? <span className="text-[10px] text-gray-500 truncate max-w-[22%]">📚 {e.bankName} ({e.poolSize})</span> : <span className="text-[10px] text-gray-400">no pool</span>}
                <span className="text-gray-500">{e.minItems}–{e.maxItems} items · start {e.startLabel} · pass {e.passThreshold}% · SE≤{e.seStop}</span>
                {e.bankId && !e.poolAdequate && <span className="text-[9px] font-semibold text-amber-600 bg-amber-50 border border-amber-100 rounded px-1.5 py-0.5">pool &lt; max</span>}
                <div className="ml-auto flex items-center gap-1.5">
                  {e.status !== "active" && <button onClick={() => setStatus(e.id, "active")} disabled={busy} className="text-[10px] font-semibold text-teal-700 hover:underline">Publish</button>}
                  {e.status === "active" ? <button onClick={() => setStatus(e.id, "archived")} disabled={busy} className="text-[10px] font-semibold text-gray-400 hover:underline">Archive</button>
                    : e.status === "archived" && <button onClick={() => setStatus(e.id, "draft")} disabled={busy} className="text-[10px] font-semibold text-gray-500 hover:underline">Restore</button>}
                  <button onClick={() => del(e.id)} disabled={busy} className="text-gray-300 hover:text-red-500" title="Delete">✕</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
