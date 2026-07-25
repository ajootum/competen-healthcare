"use client";
import { useState } from "react";

// Configuration Versioning & Audit (NCP-018) — version timeline + diff + one-click restore over the registry.
// Pick an object → see its immutable snapshot history → compare any two versions field-by-field → restore a past
// version (the restore is itself snapshotted, so history is append-only). Snapshots accrue automatically whenever
// an object's definition is saved, plus manual capture here.
type ObjRow = { object_key: string; object_type: string; display_name: string };
type Snap = { version: number; action: string; change_reason?: string; restored_from?: number; checksum?: string; actor_name?: string; created_at: string };
type Diff = { path: string; kind: "added" | "removed" | "changed"; before?: unknown; after?: unknown };

const input = "border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400 bg-white";
const AB: Record<string, string> = { defined: "bg-indigo-100 text-indigo-700", captured: "bg-gray-100 text-gray-600", published: "bg-emerald-100 text-emerald-700", restored: "bg-amber-100 text-amber-700" };
const short = (v: unknown) => { const s = typeof v === "string" ? v : JSON.stringify(v); return s == null ? "∅" : s.length > 60 ? s.slice(0, 60) + "…" : s; };
const when = (s: string) => { try { return new Date(s).toLocaleString(); } catch { return s; } };

export default function VersionManager({ objects }: { objects: ObjRow[] }) {
  const [q, setQ] = useState("");
  const [selKey, setSelKey] = useState<string | null>(null);
  const selO = objects.find(o => o.object_key === selKey) ?? null;
  const [snaps, setSnaps] = useState<Snap[]>([]);
  const [loading, setLoading] = useState(false);
  const [a, setA] = useState<number | "">(""); const [b, setB] = useState<number | "">("");
  const [diff, setDiff] = useState<Diff[] | null>(null);
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<string | null>(null);

  async function loadVersions(key: string) {
    setLoading(true); setDiff(null); setA(""); setB(""); setMsg(null);
    const r = await fetch(`/api/config/versions?object_key=${encodeURIComponent(key)}`);
    const j = await r.json().catch(() => ({}));
    setLoading(false);
    setSnaps(r.ok ? (j.versions ?? []) : []);
    if (!r.ok) setMsg(j?.error || "Could not load versions.");
  }
  function pick(k: string) { setSelKey(k); setSnaps([]); loadVersions(k); }

  async function capture() {
    if (!selO) return;
    setBusy(true); setMsg(null);
    const r = await fetch("/api/config/versions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "capture", object_key: selO.object_key }) });
    const j = await r.json().catch(() => ({})); setBusy(false);
    setMsg(r.ok ? `✓ Captured v${j.version}.` : (j?.error || "Capture failed."));
    if (r.ok) loadVersions(selO.object_key);
  }
  async function compare() {
    if (!selO || a === "" || b === "") return;
    setBusy(true); setMsg(null); setDiff(null);
    const r = await fetch("/api/config/versions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "compare", object_key: selO.object_key, a, b }) });
    const j = await r.json().catch(() => ({})); setBusy(false);
    if (r.ok) setDiff(j.diff ?? []); else setMsg(j?.error || "Compare failed.");
  }
  async function restore(version: number) {
    if (!selO || !confirm(`Restore ${selO.display_name} to v${version}? Current state is snapshotted first, so this is reversible.`)) return;
    setBusy(true); setMsg(null);
    const r = await fetch("/api/config/versions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "restore", object_key: selO.object_key, version }) });
    const j = await r.json().catch(() => ({})); setBusy(false);
    setMsg(r.ok ? `✓ Restored from v${version} → new v${j.new_version}${j.warnings ? ` (${j.warnings} schema warning(s))` : ""}.` : (j?.error || "Restore failed."));
    if (r.ok) loadVersions(selO.object_key);
  }

  const card = "bg-white rounded-xl border border-gray-200";
  const list = objects.filter(o => !q || o.display_name.toLowerCase().includes(q.toLowerCase()) || o.object_key.includes(q.toLowerCase()));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
      <div className={`${card} p-4`}>
        <input className={`${input} w-full mb-2`} value={q} onChange={e => setQ(e.target.value)} placeholder="search objects…" />
        <div className="space-y-1 max-h-[540px] overflow-y-auto">
          {list.map(o => <button key={o.object_key} onClick={() => pick(o.object_key)} className={`w-full text-left rounded-lg px-2.5 py-1.5 transition-colors ${selKey === o.object_key ? "bg-indigo-50 ring-1 ring-indigo-200" : "hover:bg-gray-50"}`}><p className="text-xs font-medium text-gray-800 truncate">{o.display_name}</p><p className="text-[10px] text-gray-400 font-mono truncate">{o.object_type}</p></button>)}
          {list.length === 0 && <p className="text-[11px] text-gray-400 py-2">No objects match.</p>}
        </div>
      </div>

      <div className={`${card} p-5 lg:col-span-3`}>
        {!selO ? <p className="text-sm text-gray-400 py-16 text-center">Select an object to see its version history.</p> : (
          <>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-900">{selO.display_name}</h3>
              <button onClick={capture} disabled={busy} className="text-xs font-medium text-indigo-700 border border-indigo-200 rounded-lg px-2.5 py-1 hover:bg-indigo-50 disabled:opacity-50">Capture snapshot</button>
            </div>

            {loading ? <p className="text-xs text-gray-400 py-4">Loading…</p> : snaps.length === 0 ? <p className="text-xs text-gray-400 py-4">No snapshots yet — save this object&apos;s definition in its designer, or capture one now.</p> : (
              <>
                {/* Compare bar */}
                <div className="flex items-center gap-2 mb-3 text-xs">
                  <span className="text-gray-500">Compare</span>
                  <select className={`${input} w-20`} value={a} onChange={e => setA(e.target.value ? Number(e.target.value) : "")}><option value="">v…</option>{snaps.map(s => <option key={s.version} value={s.version}>v{s.version}</option>)}</select>
                  <span className="text-gray-300">→</span>
                  <select className={`${input} w-20`} value={b} onChange={e => setB(e.target.value ? Number(e.target.value) : "")}><option value="">v…</option>{snaps.map(s => <option key={s.version} value={s.version}>v{s.version}</option>)}</select>
                  <button onClick={compare} disabled={busy || a === "" || b === ""} className="text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded px-2.5 py-1 disabled:opacity-40">Diff</button>
                </div>

                {diff && (
                  <div className="rounded-lg bg-gray-50 border border-gray-100 p-3 mb-4">
                    <p className="text-[11px] font-semibold text-gray-500 mb-1.5">v{a} → v{b} · {diff.length} change(s)</p>
                    {diff.length === 0 ? <p className="text-[11px] text-gray-400">Identical.</p> : (
                      <div className="space-y-1 max-h-52 overflow-y-auto">
                        {diff.map((d, i) => (
                          <div key={i} className="text-[11px] flex items-start gap-1.5">
                            <span className={`font-semibold w-14 shrink-0 ${d.kind === "added" ? "text-emerald-600" : d.kind === "removed" ? "text-rose-600" : "text-amber-600"}`}>{d.kind}</span>
                            <span className="font-mono text-gray-600 shrink-0">{d.path}</span>
                            <span className="text-gray-400">{d.kind === "changed" ? <>{short(d.before)} <span className="text-gray-300">→</span> {short(d.after)}</> : d.kind === "added" ? short(d.after) : short(d.before)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Timeline */}
                <p className="text-[11px] font-semibold text-gray-500 mb-1.5">History ({snaps.length})</p>
                <div className="space-y-1 max-h-72 overflow-y-auto">
                  {snaps.map((s, i) => (
                    <div key={s.version} className="flex items-center gap-2 border border-gray-100 rounded-lg px-2.5 py-1.5">
                      <span className="text-xs font-semibold text-gray-700 w-8 tabular-nums">v{s.version}</span>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded ${AB[s.action] ?? AB.captured}`}>{s.action}{s.restored_from ? ` ←v${s.restored_from}` : ""}</span>
                      <span className="text-[11px] text-gray-500 flex-1 truncate">{s.change_reason ?? ""}</span>
                      <span className="text-[10px] text-gray-400">{s.actor_name ?? "—"}</span>
                      <span className="text-[10px] text-gray-300">{when(s.created_at)}</span>
                      <span className="text-[9px] text-gray-300 font-mono">{s.checksum}</span>
                      {i !== 0 && <button onClick={() => restore(s.version)} disabled={busy} className="text-[10px] font-medium text-amber-700 border border-amber-200 rounded px-1.5 py-0.5 hover:bg-amber-50 disabled:opacity-40">Restore</button>}
                    </div>
                  ))}
                </div>
              </>
            )}
            {msg && <p className={`text-xs mt-3 ${msg.startsWith("✓") ? "text-emerald-600" : "text-rose-600"}`}>{msg}</p>}
          </>
        )}
      </div>
    </div>
  );
}
