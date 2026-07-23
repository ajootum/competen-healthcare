"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Automation runner canvas — runs a real background job on demand via
// POST /api/jobs?key=<job> (POS-001F job runner, super_admin). Shows the live
// result (status, detail, duration) and refreshes the page so the run appears in
// the automation registry / job queue. No AI dependency — always functional.

type Job = { key: string; name: string; runnable: boolean; category?: string };

export default function JobRunner({ jobs, title = "Run Automation" }: { jobs: Job[]; title?: string }) {
  const router = useRouter();
  const runnable = jobs.filter(j => j.runnable);
  const [key, setKey] = useState<string>(runnable[0]?.key ?? "");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  async function run() {
    if (!key) return;
    setBusy(true); setResult(null);
    const r = await fetch(`/api/jobs?key=${encodeURIComponent(key)}`, { method: "POST" });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (r.ok && j.ok) { setResult({ ok: true, text: `${j.status} · ${j.detail ?? ""} (${j.duration_ms ?? "?"}ms)` }); router.refresh(); }
    else setResult({ ok: false, text: j.error ?? j.status ?? "Failed to run" });
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <h2 className="font-semibold text-gray-900 text-[15px] mb-3">{title}</h2>
      {runnable.length === 0 ? <p className="text-sm text-gray-400">No on-demand automations registered.</p> : (
        <div className="flex flex-wrap items-center gap-2">
          <select value={key} onChange={e => setKey(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/40 min-w-[220px]">
            {runnable.map(j => <option key={j.key} value={j.key}>{j.name}</option>)}
          </select>
          <button onClick={run} disabled={busy} className="text-sm font-semibold bg-teal-600 hover:bg-teal-700 text-white rounded-lg px-4 py-2 disabled:opacity-60">{busy ? "Running…" : "Run now"}</button>
          {result && <span className={`text-xs rounded-lg px-2.5 py-1.5 ${result.ok ? "bg-green-50 text-green-800" : "bg-amber-50 text-amber-800"}`}>{result.text}</span>}
        </div>
      )}
      <p className="text-[11px] text-gray-400 mt-3">Runs the selected job immediately and records it to the job history. Handler-backed jobs do real, safe, idempotent work.</p>
    </div>
  );
}
