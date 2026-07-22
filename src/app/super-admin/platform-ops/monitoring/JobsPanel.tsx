"use client";

import { useState, useCallback } from "react";

// POS-001F Jobs panel — the background-job registry with last-run status and an
// on-demand "Run" per runnable job, plus recent run history. Fed by /api/jobs.
/* eslint-disable @typescript-eslint/no-explicit-any */

const STATUS: Record<string, { dot: string; text: string }> = {
  success: { dot: "bg-green-500", text: "text-green-600" },
  failed: { dot: "bg-rose-500", text: "text-rose-600" },
  running: { dot: "bg-amber-500 animate-pulse", text: "text-amber-600" },
};
const rel = (iso?: string | null) => { if (!iso) return "never"; const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000); if (s < 60) return "just now"; if (s < 3600) return `${Math.floor(s / 60)}m ago`; if (s < 86400) return `${Math.floor(s / 3600)}h ago`; return `${Math.floor(s / 86400)}d ago`; };

export default function JobsPanel({ initial }: { initial: any }) {
  const [data, setData] = useState<any>(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ k: "ok" | "err"; t: string } | null>(null);
  const toast = (k: "ok" | "err", t: string) => { setMsg({ k, t }); setTimeout(() => setMsg(null), 4000); };

  const reload = useCallback(async () => {
    try { const r = await fetch("/api/jobs", { cache: "no-store" }); if (r.ok) setData(await r.json()); } catch { /* keep */ }
  }, []);

  async function run(key: string, name: string) {
    setBusy(key);
    try {
      const r = await fetch(`/api/jobs?key=${encodeURIComponent(key)}`, { method: "POST" });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.ok) toast("ok", `${name}: ${j.detail ?? "done"}`);
      else toast("err", j.error ?? `${name} failed`);
    } catch { toast("err", "Request failed"); }
    setBusy(null);
    reload();
  }

  const jobs = data?.jobs ?? [];
  const s = data?.summary ?? {};

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold text-gray-900 text-[15px]">Operational Jobs &amp; Backups
          {s.ready && <span className="ml-2 text-[10px] font-medium text-gray-400">{s.runs24h} runs 24h{s.failed24h ? ` · ${s.failed24h} failed` : ""}</span>}
        </h2>
        {msg && <span className={`text-xs rounded-lg px-2.5 py-1 ${msg.k === "ok" ? "bg-green-50 text-green-800" : "bg-amber-50 text-amber-800"}`}>{msg.t}</span>}
      </div>

      {!s.ready && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 mb-3">
          Run <code className="font-mono">supabase/RUN-ME-054-jobs-deployments.sql</code> to enable the job runner (registry shown below; run history &amp; triggering activate after).
        </div>
      )}

      <div className="space-y-1.5">
        {jobs.map((j: any) => (
          <div key={j.key} className="flex items-center gap-3 py-1.5">
            <span className={`w-2 h-2 rounded-full shrink-0 ${STATUS[j.last?.status]?.dot ?? "bg-gray-300"}`} />
            <div className="min-w-0 flex-1">
              <p className="text-sm text-gray-800 truncate">{j.name} <span className="text-[10px] text-gray-400">· {j.category}</span></p>
              <p className="text-[10px] text-gray-400 truncate">{j.last ? `${j.last.status} ${rel(j.last.started_at)}${j.last.detail ? ` · ${j.last.detail}` : ""}` : (j.runnable ? "not yet run" : "runs on its own cron")}</p>
            </div>
            {j.runnable ? (
              <button onClick={() => run(j.key, j.name)} disabled={busy === j.key || !s.ready}
                className="text-[11px] font-medium rounded-lg border border-gray-200 px-2.5 py-1 text-gray-600 hover:bg-gray-50 disabled:opacity-40 shrink-0">
                {busy === j.key ? "Running…" : "Run"}
              </button>
            ) : <span className="text-[10px] text-gray-400 shrink-0">cron</span>}
          </div>
        ))}
      </div>

      <div className="mt-3 pt-3 border-t border-gray-50 flex items-center gap-2">
        <span className="text-lg">💾</span>
        <div><p className="text-sm font-medium text-gray-700">Database Backups</p><p className="text-[11px] text-gray-500">Managed by Supabase — run history not surfaced here.</p></div>
        <span className="ml-auto text-[9px] font-medium px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">Not connected</span>
      </div>
    </div>
  );
}
