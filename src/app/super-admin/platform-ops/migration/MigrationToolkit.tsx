"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatDateTime } from "@/lib/datetime";

// Configuration Migration Toolkit (NCP-020) — export a dependency-closed config bundle, or import one with a
// dry-run and dependency-ordered, checkpointed apply (rollback-capable). Export pulls in every dependency so the
// bundle is self-contained; import validates against the target (schema + prerequisites) before touching anything.
type ObjRow = { object_key: string; object_type: string; display_name: string };
type Job = { id: string; job_type: string; status: string; object_count: number; summary: any; note?: string; created_by_name?: string; created_at: string };

const input = "border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400 bg-white";
const JT: Record<string, string> = { export: "bg-[var(--cmp-surface-information)] text-[var(--cmp-text-information)]", import: "bg-indigo-100 text-indigo-700", rollback: "bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)]" };
const when = (s: string) => { try { return formatDateTime(s); } catch { return s; } };

export default function MigrationToolkit({ objects, jobs }: { objects: ObjRow[]; jobs: Job[] }) {
  const router = useRouter();
  const [mode, setMode] = useState<"export" | "import">("export");
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [bundleOut, setBundleOut] = useState("");
  const [pasteIn, setPasteIn] = useState("");
  const [dry, setDry] = useState<any | null>(null);
  const [lastJob, setLastJob] = useState<string | null>(null);
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<string | null>(null);

  const toggle = (k: string) => setSel(s => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const filtered = objects.filter(o => !q || o.display_name.toLowerCase().includes(q.toLowerCase()) || o.object_key.includes(q.toLowerCase()));
  const groups = [...new Set(filtered.map(o => o.object_type))].sort();

  async function build() {
    if (!sel.size) return;
    setBusy(true); setMsg(null); setBundleOut("");
    const r = await fetch("/api/config/migration", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "export", objects: [...sel] }) });
    const j = await r.json().catch(() => ({})); setBusy(false);
    if (r.ok) { setBundleOut(JSON.stringify(j.bundle, null, 2)); setMsg(`✓ Bundle: ${j.bundle.count} object(s) (deps included).`); router.refresh(); } else setMsg(j?.error || "Export failed.");
  }
  async function copy() { try { await navigator.clipboard.writeText(bundleOut); setMsg("✓ Copied to clipboard."); } catch { setMsg("Copy failed — select and copy manually."); } }
  async function dryRun() {
    setBusy(true); setMsg(null); setDry(null); setLastJob(null);
    const r = await fetch("/api/config/migration", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "dry_run", bundle: pasteIn }) });
    const j = await r.json().catch(() => ({})); setBusy(false);
    if (r.ok || j.report) setDry(j); else setMsg(j?.error || "Dry run failed.");
  }
  async function execute() {
    setBusy(true); setMsg(null);
    const r = await fetch("/api/config/migration", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "import", bundle: pasteIn }) });
    const j = await r.json().catch(() => ({})); setBusy(false);
    if (r.ok) { setLastJob(j.jobId); setMsg(`✓ Imported ${j.new} new + ${j.updated} updated.`); setDry(null); router.refresh(); } else setMsg(j?.error || (j?.missingDeps ? `Missing prerequisites: ${j.missingDeps.join(", ")}` : "Import failed."));
  }
  async function rollback(jobId: string) {
    if (!confirm("Roll back this import? Updated objects are restored to their pre-import version; newly-created objects are retired.")) return;
    setBusy(true); setMsg(null);
    const r = await fetch("/api/config/migration", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "rollback", job_id: jobId }) });
    const j = await r.json().catch(() => ({})); setBusy(false);
    setMsg(r.ok ? `✓ Rolled back — ${j.restored} restored, ${j.retired} retired.` : (j?.error || "Rollback failed."));
    if (r.ok) { setLastJob(null); router.refresh(); }
  }

  const card = "bg-white rounded-xl border border-gray-200";
  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {(["export", "import"] as const).map(m => <button key={m} onClick={() => { setMode(m); setMsg(null); }} className={`text-xs font-medium rounded-lg px-3 py-1.5 ${mode === m ? "bg-indigo-600 text-white" : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"}`}>{m === "export" ? "⬆ Export" : "⬇ Import"}</button>)}
      </div>

      {mode === "export" ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className={`${card} p-4`}>
            <div className="flex items-center justify-between mb-2"><p className="text-[11px] font-semibold text-gray-500">Select objects ({sel.size})</p><input className={`${input} w-32`} value={q} onChange={e => setQ(e.target.value)} placeholder="search…" /></div>
            <div className="space-y-2 max-h-80 overflow-y-auto border border-gray-100 rounded-lg p-2">
              {groups.map(g => (
                <div key={g}>
                  <p className="text-[9px] font-semibold text-gray-500 uppercase tracking-wide mb-0.5">{g}</p>
                  {filtered.filter(o => o.object_type === g).map(o => <label key={o.object_key} className="flex items-center gap-1.5 text-xs py-0.5 cursor-pointer"><input type="checkbox" checked={sel.has(o.object_key)} onChange={() => toggle(o.object_key)} /><span className="text-gray-700 truncate">{o.display_name}</span></label>)}
                </div>
              ))}
            </div>
            <button onClick={build} disabled={busy || !sel.size} className="w-full mt-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg px-3 py-1.5 disabled:opacity-50">Build bundle (with dependencies)</button>
          </div>
          <div className={`${card} p-4`}>
            <div className="flex items-center justify-between mb-2"><p className="text-[11px] font-semibold text-gray-500">Bundle</p>{bundleOut && <button onClick={copy} className="text-[11px] font-medium text-indigo-700 border border-indigo-200 rounded px-2 py-0.5 hover:bg-indigo-50">Copy</button>}</div>
            <textarea className={`${input} w-full font-mono h-72 resize-none`} value={bundleOut} readOnly spellCheck={false} placeholder="Select objects and build a bundle — dependencies are pulled in automatically so it imports cleanly elsewhere." />
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className={`${card} p-4`}>
            <p className="text-[11px] font-semibold text-gray-500 mb-2">Paste a bundle</p>
            <textarea className={`${input} w-full font-mono h-72 resize-none`} value={pasteIn} onChange={e => { setPasteIn(e.target.value); setDry(null); }} spellCheck={false} placeholder='{ "format": "competen.config.bundle", "objects": [...] }' />
            <div className="flex items-center gap-2 mt-2">
              <button onClick={dryRun} disabled={busy || !pasteIn.trim()} className="text-sm font-medium text-indigo-700 border border-indigo-200 rounded-lg px-3 py-1.5 hover:bg-indigo-50 disabled:opacity-50">Dry run</button>
              <button onClick={execute} disabled={busy || !dry?.ok} title={!dry ? "Run a dry run first" : !dry.ok ? "Resolve issues first" : "Apply the import"} className="text-sm font-medium text-white bg-[var(--cmp-color-success)] hover:bg-emerald-700 rounded-lg px-3 py-1.5 disabled:opacity-40">Execute import</button>
              {lastJob && <button onClick={() => rollback(lastJob)} disabled={busy} className="text-xs font-medium text-[var(--cmp-text-warning)] border border-[var(--cmp-color-warning)] rounded-lg px-2.5 py-1.5 hover:bg-[var(--cmp-surface-warning)] ml-auto">Roll back</button>}
            </div>
          </div>
          <div className={`${card} p-4`}>
            <p className="text-[11px] font-semibold text-gray-500 mb-2">Dry-run report</p>
            {!dry ? <p className="text-xs text-gray-500 py-8 text-center">Paste a bundle and run a dry run to preview the import.</p> : (
              <>
                <div className={`text-xs font-medium mb-2 ${dry.ok ? "text-[var(--cmp-text-success)]" : "text-[var(--cmp-text-error)]"}`}>{dry.ok ? "✓ Safe to import" : "✕ Resolve issues before importing"}</div>
                <div className="flex gap-3 text-[11px] mb-3"><span className="text-[var(--cmp-text-success)]">{dry.counts.new} new</span><span className="text-[var(--cmp-text-warning)]">{dry.counts.update} update</span><span className="text-gray-500">{dry.counts.identical} identical</span></div>
                {dry.missingDeps?.length > 0 && <div className="mb-2 text-[11px] text-[var(--cmp-text-error)]">Missing prerequisites: {dry.missingDeps.join(", ")}</div>}
                <div className="space-y-0.5 max-h-52 overflow-y-auto">
                  {dry.report.map((r: any) => (
                    <div key={r.key} className="flex items-center gap-2 text-[11px]"><span className={`w-14 shrink-0 ${r.op === "new" ? "text-[var(--cmp-text-success)]" : r.op === "update" ? "text-[var(--cmp-text-warning)]" : "text-gray-500"}`}>{r.op}</span><span className="text-gray-700 truncate flex-1">{r.name || r.key}</span>{r.issues.length > 0 && <span className="text-rose-500 text-[10px]" title={r.issues.join("; ")}>⚠ {r.issues.length}</span>}</div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {msg && <p className={`text-xs ${msg.startsWith("✓") ? "text-[var(--cmp-text-success)]" : "text-[var(--cmp-text-error)]"}`}>{msg}</p>}

      {jobs.length > 0 && (
        <div className={`${card} p-4`}>
          <p className="text-[11px] font-semibold text-gray-500 mb-2">Recent jobs</p>
          <div className="space-y-1">
            {jobs.map(j => (
              <div key={j.id} className="flex items-center gap-2 text-[11px]">
                <span className={`text-[9px] px-1.5 py-0.5 rounded ${JT[j.job_type] ?? "bg-gray-100 text-gray-600"}`}>{j.job_type}</span>
                <span className="text-gray-600 flex-1 truncate">{j.note}</span>
                <span className="text-gray-500">{j.status}</span>
                <span className="text-gray-500">{j.created_by_name ?? "—"}</span>
                <span className="text-gray-500">{when(j.created_at)}</span>
                {j.job_type === "import" && j.status === "applied" && <button onClick={() => rollback(j.id)} disabled={busy} className="text-[10px] font-medium text-[var(--cmp-text-warning)] border border-[var(--cmp-color-warning)] rounded px-1.5 py-0.5 hover:bg-[var(--cmp-surface-warning)]">Roll back</button>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
