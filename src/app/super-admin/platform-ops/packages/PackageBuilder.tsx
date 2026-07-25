"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

// Template, Package & Marketplace Manager (NCP-011) — the capstone. Bundles governed configuration objects
// authored by the other NCP builders into versioned, installable packages. The signature interactive piece is
// the DEPENDENCY RESOLVER: as members are added, it computes (client-side, over the same dependsOn graph the
// server uses) every object the members transitively depend on and flags any that are missing from the bundle —
// with one-click "add all missing". Publish is gated on completeness. Create/save/publish go through
// /api/config/packages. The installation engine, upgrade/rollback, licensing and marketplace portal
// (NCP-011 §4/§8) are honest next-phase.
type Pkg = { package_key: string; package_name: string; description?: string; category: string; version: string; license: string; pricing_model: string; visibility: string; members?: string[]; status: string };
type ObjRow = { object_key: string; object_type: string; display_name: string };

const CATS = ["clinical", "operational", "analytics", "governance", "workforce", "learning", "general"];
const LICENSES = ["proprietary", "open", "subscription", "enterprise"];
const PRICING = ["included", "subscription", "one_time", "usage_based"];
const VIS = ["private", "enterprise", "public"];
const ST: Record<string, string> = { draft: "bg-gray-100 text-gray-600", validated: "bg-sky-100 text-sky-700", published: "bg-emerald-100 text-emerald-700", deprecated: "bg-amber-100 text-amber-700", retired: "bg-gray-100 text-gray-400" };
const input = "border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400 bg-white";

function closure(members: string[], dep: Record<string, string[]>): Set<string> {
  const out = new Set<string>(); const stack = [...members];
  while (stack.length) { const k = stack.pop()!; for (const d of (dep[k] ?? [])) { if (!out.has(d)) { out.add(d); stack.push(d); } } }
  return out;
}

export default function PackageBuilder({ packages, objects, dependsOn }: { packages: Pkg[]; objects: ObjRow[]; dependsOn: Record<string, string[]> }) {
  const router = useRouter();
  const byKey = new Map(objects.map(o => [o.object_key, o]));
  const [selKey, setSelKey] = useState<string | null>(packages[0]?.package_key ?? null);
  const selP = packages.find(p => p.package_key === selKey) ?? null;
  const [members, setMembers] = useState<string[]>(selP?.members ?? []);
  const [meta, setMeta] = useState({ category: selP?.category ?? "general", version: selP?.version ?? "1.0.0", license: selP?.license ?? "proprietary", pricing_model: selP?.pricing_model ?? "included", visibility: selP?.visibility ?? "private" });
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<string | null>(null);
  const [nk, setNk] = useState(""); const [nn, setNn] = useState(""); const [creating, setCreating] = useState(false);

  function pick(p: Pkg) { setSelKey(p.package_key); setMembers(p.members ?? []); setMeta({ category: p.category, version: p.version, license: p.license, pricing_model: p.pricing_model, visibility: p.visibility }); setMsg(null); setQ(""); }
  const toggle = (k: string) => setMembers(m => m.includes(k) ? m.filter(x => x !== k) : [...m, k]);

  // Live dependency resolution — mirrors the server's resolveManifest.
  const required = closure(members, dependsOn);
  const missingDeps = [...required].filter(k => !members.includes(k));
  const complete = missingDeps.length === 0;
  const addMissing = () => setMembers(m => [...new Set([...m, ...missingDeps])]);

  async function create() {
    const key = nk.trim().toLowerCase(), name = nn.trim();
    if (!/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$/.test(key)) { setMsg("Key must be lowercase, dot-separated (e.g. bundle.ward_pack)"); return; }
    if (!name) { setMsg("Package name required"); return; }
    setCreating(true); setMsg(null);
    const r = await fetch("/api/config/packages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ package_key: key, package_name: name }) });
    const j = await r.json().catch(() => ({}));
    setCreating(false);
    if (r.ok) { setNk(""); setNn(""); setSelKey(key); setMembers([]); router.refresh(); } else setMsg(j?.error || "Could not create package.");
  }
  async function save(publish = false) {
    if (!selP) return;
    setBusy(true); setMsg(null);
    const r = await fetch("/api/config/packages", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ package_key: selP.package_key, members, ...meta, publish }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    setMsg(r.ok ? (publish ? "✓ Published." : `✓ Saved — ${members.length} member(s), ${j?.status ?? ""}.`) : (j?.error || "Could not save."));
    if (r.ok) router.refresh();
  }

  const card = "bg-white rounded-xl border border-gray-200";
  const palette = objects.filter(o => !q || o.display_name.toLowerCase().includes(q.toLowerCase()) || o.object_key.includes(q.toLowerCase()));
  const groups = [...new Set(palette.map(o => o.object_type))].sort();

  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
      <div className={`${card} p-4`}>
        <p className="text-[11px] font-semibold text-gray-500 mb-2">Packages ({packages.length})</p>
        <div className="space-y-1 max-h-[300px] overflow-y-auto mb-3">
          {packages.map(p => <button key={p.package_key} onClick={() => pick(p)} className={`w-full text-left rounded-lg px-2.5 py-1.5 transition-colors ${selKey === p.package_key ? "bg-indigo-50 ring-1 ring-indigo-200" : "hover:bg-gray-50"}`}><p className="text-xs font-medium text-gray-800 truncate flex items-center gap-1.5">{p.package_name}<span className={`text-[8px] px-1 py-px rounded ${ST[p.status] ?? ST.draft}`}>{p.status}</span></p><p className="text-[10px] text-gray-400 truncate">v{p.version} · {(p.members?.length ?? 0)} member(s)</p></button>)}
          {packages.length === 0 && <p className="text-[11px] text-gray-400 py-2">No packages yet.</p>}
        </div>
        <div className="border-t border-gray-100 pt-3 space-y-1.5">
          <p className="text-[11px] font-semibold text-gray-500">New package</p>
          <input className={`${input} w-full`} value={nn} onChange={e => setNn(e.target.value)} placeholder="Package name" />
          <input className={`${input} w-full font-mono`} value={nk} onChange={e => setNk(e.target.value)} placeholder="bundle.key" />
          <button onClick={create} disabled={creating} className="w-full text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg px-3 py-1.5 disabled:opacity-50">{creating ? "Creating…" : "+ Create"}</button>
        </div>
      </div>

      <div className={`${card} p-5 lg:col-span-3`}>
        {!selP ? <p className="text-sm text-gray-400 py-16 text-center">Select or create a package.</p> : (
          <>
            <div className="flex items-center justify-between mb-3"><h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">{selP.package_name}<span className={`text-[9px] px-1.5 py-0.5 rounded ${ST[selP.status] ?? ST.draft}`}>{selP.status}</span></h3><span className="text-[10px] text-gray-400 font-mono">{selP.package_key}</span></div>

            {/* Metadata */}
            <div className="flex items-end gap-2 mb-4 flex-wrap">
              <label className="text-[10px] text-gray-500">Category<select className={`${input} w-28 block mt-0.5`} value={meta.category} onChange={e => setMeta(m => ({ ...m, category: e.target.value }))}>{CATS.map(c => <option key={c} value={c}>{c}</option>)}</select></label>
              <label className="text-[10px] text-gray-500">Version<input className={`${input} w-20 block mt-0.5`} value={meta.version} onChange={e => setMeta(m => ({ ...m, version: e.target.value }))} /></label>
              <label className="text-[10px] text-gray-500">License<select className={`${input} w-28 block mt-0.5`} value={meta.license} onChange={e => setMeta(m => ({ ...m, license: e.target.value }))}>{LICENSES.map(l => <option key={l} value={l}>{l}</option>)}</select></label>
              <label className="text-[10px] text-gray-500">Pricing<select className={`${input} w-28 block mt-0.5`} value={meta.pricing_model} onChange={e => setMeta(m => ({ ...m, pricing_model: e.target.value }))}>{PRICING.map(p => <option key={p} value={p}>{p}</option>)}</select></label>
              <label className="text-[10px] text-gray-500">Marketplace<select className={`${input} w-28 block mt-0.5`} value={meta.visibility} onChange={e => setMeta(m => ({ ...m, visibility: e.target.value }))}>{VIS.map(v => <option key={v} value={v}>{v}</option>)}</select></label>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              {/* Members */}
              <div>
                <p className="text-[11px] font-semibold text-gray-500 mb-1.5">Members ({members.length})</p>
                {members.length === 0 ? <p className="text-xs text-gray-400 py-3">No members yet — add objects from the registry.</p> : (
                  <div className="space-y-1 max-h-52 overflow-y-auto">
                    {members.map(k => { const o = byKey.get(k); const dep = required.has(k); return (
                      <div key={k} className="flex items-center gap-1.5 text-xs">
                        <span className="text-[8px] px-1 py-px rounded bg-gray-100 text-gray-500 shrink-0">{o?.object_type ?? "?"}</span>
                        <span className="text-gray-700 truncate flex-1">{o?.display_name ?? k}</span>
                        {dep && <span className="text-[8px] text-indigo-400" title="also required by another member">dep</span>}
                        <button onClick={() => toggle(k)} className="text-gray-300 hover:text-rose-600">✕</button>
                      </div>
                    ); })}
                  </div>
                )}
              </div>
              {/* Palette */}
              <div>
                <div className="flex items-center justify-between mb-1.5"><p className="text-[11px] font-semibold text-gray-500">Add from registry</p><input className={`${input} w-32`} value={q} onChange={e => setQ(e.target.value)} placeholder="search…" /></div>
                <div className="space-y-2 max-h-52 overflow-y-auto border border-gray-100 rounded-lg p-2">
                  {groups.length === 0 ? <p className="text-[11px] text-gray-400">No objects match.</p> : groups.map(g => (
                    <div key={g}>
                      <p className="text-[9px] font-semibold text-gray-400 uppercase tracking-wide mb-0.5">{g}</p>
                      {palette.filter(o => o.object_type === g).map(o => (
                        <label key={o.object_key} className="flex items-center gap-1.5 text-xs py-0.5 cursor-pointer">
                          <input type="checkbox" checked={members.includes(o.object_key)} onChange={() => toggle(o.object_key)} />
                          <span className="text-gray-700 truncate">{o.display_name}</span>
                        </label>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Dependency resolver — the signature piece */}
            <div className={`rounded-lg border p-3 ${complete ? "bg-emerald-50 border-emerald-200" : "bg-rose-50 border-rose-200"}`}>
              <div className="flex items-center justify-between">
                <p className={`text-xs font-semibold ${complete ? "text-emerald-800" : "text-rose-800"}`}>{complete ? `✓ Dependency-complete — ${members.length} member(s), ${required.size} satisfied` : `✕ ${missingDeps.length} required object(s) missing from the bundle`}</p>
                {!complete && <button onClick={addMissing} className="text-[11px] font-medium text-white bg-rose-600 hover:bg-rose-700 rounded px-2.5 py-1">Add all missing</button>}
              </div>
              {!complete && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {missingDeps.map(k => { const o = byKey.get(k); return <button key={k} onClick={() => toggle(k)} className="text-[10px] bg-white border border-rose-200 text-rose-700 rounded px-1.5 py-0.5 hover:bg-rose-100" title="click to add">{o ? o.display_name : k} +</button>; })}
                </div>
              )}
            </div>

            {msg && <p className={`text-xs mt-3 ${msg.startsWith("✓") ? "text-emerald-600" : "text-rose-600"}`}>{msg}</p>}
            <div className="flex items-center justify-end gap-2 mt-4">
              <button onClick={() => save(false)} disabled={busy} className="text-sm font-medium text-indigo-700 border border-indigo-200 rounded-lg px-4 py-2 hover:bg-indigo-50 disabled:opacity-50">{busy ? "…" : "Save"}</button>
              <button onClick={() => save(true)} disabled={busy || !complete || members.length === 0} title={!complete ? "Resolve missing dependencies first" : members.length === 0 ? "Add members first" : "Publish to the marketplace"} className="text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg px-4 py-2 disabled:opacity-40">Publish</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
