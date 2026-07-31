"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/* eslint-disable @typescript-eslint/no-explicit-any */
const METHODS = [
  { v: "modified_angoff", label: "Modified Angoff" }, { v: "angoff", label: "Angoff" }, { v: "ebel", label: "Ebel" },
  { v: "borderline_group", label: "Borderline Group" }, { v: "borderline_regression", label: "Borderline Regression" },
  { v: "hofstee", label: "Hofstee" }, { v: "bookmark", label: "Bookmark" }, { v: "custom", label: "Custom" },
];
const STATUS_TONE: Record<string, string> = {
  draft: "text-gray-500 bg-gray-50 border-gray-200", calibration: "text-[var(--cmp-text-information)] bg-[var(--cmp-surface-information)] border-[var(--cmp-color-information)]",
  in_progress: "text-[var(--cmp-text-warning)] bg-[var(--cmp-surface-warning)] border-[var(--cmp-color-warning)]", review: "text-violet-600 bg-violet-50 border-violet-200",
  approved: "text-teal-600 bg-teal-50 border-teal-200", published: "text-teal-700 bg-teal-50 border-teal-200",
};

export default function StandardSettingManager({ studies, bankOptions }: { studies: any[]; bankOptions: { id: string; label: string }[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [method, setMethod] = useState("modified_angoff");
  const [bank, setBank] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [judge, setJudge] = useState("");
  const [item, setItem] = useState("");
  const [rating, setRating] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const call = async (url: string, opts: RequestInit) => { setBusy(true); const r = await fetch(url, opts); setBusy(false); if (!r.ok) { const j = await r.json().catch(() => ({})); setErr(j.error ?? "Request failed."); return false; } setErr(null); router.refresh(); return true; };

  async function create() {
    if (!name.trim()) { setErr("Name the study."); return; }
    if (await call("/api/studio/standard-settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, method, bank_id: bank || null }) })) { setName(""); setBank(""); setMethod("modified_angoff"); }
  }
  const setStatus = (id: string, status: string, final_cut?: number | null) => call(`/api/studio/standard-settings?id=${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status, ...(final_cut != null ? { final_cut } : {}) }) });
  const del = (id: string) => call(`/api/studio/standard-settings?id=${id}`, { method: "DELETE" });
  const removeJ = (jid: string) => call(`/api/studio/standard-settings/judgements?id=${jid}`, { method: "DELETE" });
  async function addJ(studyId: string) {
    if (!judge.trim() || !item.trim()) { setErr("Judge and item are required."); return; }
    const r = Number(rating);
    if (!Number.isFinite(r) || r < 0 || r > 1) { setErr("Rating must be a probability 0–1."); return; }
    if (await call("/api/studio/standard-settings/judgements", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ study_id: studyId, judge_name: judge, item_label: item, rating: r }) })) { setItem(""); setRating(""); }
  }

  const inp = "text-xs border border-gray-200 rounded-lg px-2.5 py-2 bg-white focus:outline-none focus:ring-1 focus:ring-teal-400";

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-white rounded-xl border border-gray-100 p-5">
        <h2 className="font-semibold text-gray-900 text-sm mb-3">New standard-setting study</h2>
        <div className="flex flex-col lg:flex-row gap-2">
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Study name" className={`${inp} flex-1`} />
          <select value={method} onChange={e => setMethod(e.target.value)} className={`${inp} lg:w-48`}>{METHODS.map(m => <option key={m.v} value={m.v}>{m.label}</option>)}</select>
          <select value={bank} onChange={e => setBank(e.target.value)} className={`${inp} lg:w-56`}><option value="">Link bank (for impact)…</option>{bankOptions.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}</select>
          <button onClick={create} disabled={busy} className="text-xs font-semibold text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-50 rounded-lg px-4 py-2 whitespace-nowrap">{busy ? "…" : "Create"}</button>
        </div>
        {err && <p className="text-[11px] text-[var(--cmp-text-critical)] mt-1">{err}</p>}
      </div>

      {studies.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-6 text-center text-xs text-gray-400">No studies yet — create one above, link a bank, then record judge ratings to compute a defensible cut score.</div>
      ) : studies.map((s: any) => (
        <div key={s.id} className="bg-white rounded-xl border border-gray-100 p-4">
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => setOpen(open === s.id ? null : s.id)} className="text-sm font-bold text-gray-900 hover:text-teal-700">{open === s.id ? "▾" : "▸"} {s.name}</button>
            <span className="text-[10px] font-semibold text-gray-500 bg-gray-50 border border-gray-100 rounded px-1.5 py-0.5">{s.methodLabel}</span>
            {s.bankName && <span className="text-[10px] text-gray-400">↔ {s.bankName}</span>}
            <span className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border ${STATUS_TONE[s.status] ?? STATUS_TONE.draft}`}>{s.status.replace(/_/g, " ")}</span>
            <div className="ml-auto flex items-center gap-3 text-xs">
              <span className="text-gray-500">{s.judges} judge{s.judges === 1 ? "" : "s"} · {s.items} item{s.items === 1 ? "" : "s"}</span>
              {s.cutPct != null && <span className="font-bold text-gray-900">Cut {s.cutPct}%</span>}
              {s.impactPassRate != null && <span className="text-teal-600">{s.impactPassRate}% pass</span>}
              <button onClick={() => del(s.id)} disabled={busy} className="text-gray-300 hover:text-red-500" title="Delete">✕</button>
            </div>
          </div>

          {open === s.id && (
            <div className="mt-3 ml-4 border-l-2 border-gray-50 pl-3">
              {/* computed summary */}
              <div className="flex flex-wrap gap-4 mb-3 text-xs">
                <span className="text-gray-500">Recommended cut: <b className="text-gray-900">{s.cutPct != null ? `${s.cutPct}%` : "—"}</b></span>
                {s.impactPassRate != null ? <span className="text-gray-500">Impact: <b className="text-gray-900">{s.impactPassRate}% pass</b> of {s.impactAttempts} attempts</span> : s.bankName ? <span className="text-gray-400">No attempt data for impact yet</span> : <span className="text-gray-400">Link a bank to see pass-rate impact</span>}
                {s.finalCut != null && <span className="text-teal-600">Finalised at {s.finalCut}%</span>}
              </div>
              {/* judgements */}
              {s.judgements.length > 0 && (
                <div className="flex flex-col divide-y divide-gray-50 mb-2 max-h-52 overflow-y-auto">
                  {s.judgements.map((j: any) => (
                    <div key={j.id} className="flex items-center gap-2 py-1.5 text-xs">
                      <span className="font-semibold text-gray-700 w-28 truncate">{j.judge_name}</span>
                      <span className="text-gray-500 flex-1 truncate">{j.item_label}</span>
                      <span className="font-semibold text-gray-900 tabular-nums">{Number(j.rating).toFixed(2)}</span>
                      <button onClick={() => removeJ(j.id)} disabled={busy} className="text-gray-300 hover:text-red-500 shrink-0" title="Remove">✕</button>
                    </div>
                  ))}
                </div>
              )}
              {/* add judgement */}
              <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
                <input value={judge} onChange={e => setJudge(e.target.value)} placeholder="Judge" className={`${inp} sm:w-32`} />
                <input value={item} onChange={e => setItem(e.target.value)} placeholder="Item (e.g. Q1)" className={`${inp} flex-1`} />
                <input value={rating} onChange={e => setRating(e.target.value)} type="number" step="0.05" min="0" max="1" placeholder="p (0–1)" className={`${inp} sm:w-24`} />
                <button onClick={() => addJ(s.id)} disabled={busy} className="text-xs font-semibold text-teal-700 border border-teal-200 bg-teal-50 hover:bg-teal-100 rounded-lg px-3 py-2 whitespace-nowrap">Add rating</button>
              </div>
              {/* finalise */}
              {s.cutPct != null && s.status !== "approved" && s.status !== "published" && (
                <button onClick={() => setStatus(s.id, "approved", s.cutPct)} disabled={busy} className="mt-2 text-[11px] font-semibold text-teal-700 hover:underline">Finalise cut at {s.cutPct}% →</button>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
