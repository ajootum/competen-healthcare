"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

// Navigation & Experience Designer (NCP-009) — the no-code menu composer on top of governed NAVIGATION_SECTION
// registry objects authored in the Configuration Studio. Compose a role-aware menu tree (one level of nesting),
// each item linked either to a real MODULE/PAGE/DASHBOARD object or a custom route, plus a landing page and
// quick actions. The signature interactive piece is the LIVE MENU PREVIEW with a "preview as role" filter that
// dims items hidden from that role. Persists onto object.definition via PATCH /api/config/objects, which
// validates items and wires linked objects into dependencies (NAV_TARGET). The runtime navigation resolver,
// breadcrumb/search services, personalisation and responsive rendering (NCP-009 §3/§7) are honest next-phase.
type Item = { key: string; label: string; icon?: string; target?: string; route?: string; roles?: string; children?: Item[] };
type QA = { key: string; label: string; target?: string; route?: string };
type Def = { navType?: string; items?: Item[]; landing?: string; landingRoute?: string; quickActions?: QA[]; theme?: string };
type Obj = { object_key: string; object_type: string; display_name: string; status: string; definition?: Def };
type Target = { object_key: string; object_type: string; display_name: string };

const NAV = [
  { v: "sidebar", l: "Sidebar" }, { v: "top", l: "Top nav" }, { v: "tabbed", l: "Tabbed" },
  { v: "tree", l: "Tree" }, { v: "mega", l: "Mega menu" }, { v: "wizard", l: "Wizard" },
];
const input = "border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400 bg-white";
const freeKey = (prefix: string, have: Set<string>) => { let n = 1; while (have.has(`${prefix}_${n}`)) n++; return `${prefix}_${n}`; };
const roleList = (v?: string) => (v ?? "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
const load = (o?: Obj): Def => ({ navType: o?.definition?.navType ?? "sidebar", items: o?.definition?.items ?? [], landing: o?.definition?.landing ?? "", landingRoute: o?.definition?.landingRoute ?? "", quickActions: o?.definition?.quickActions ?? [], theme: o?.definition?.theme ?? "" });

function LinkPicker({ item, onPatch, targets, w = "w-36" }: { item: { target?: string; route?: string }; onPatch: (p: Partial<Item>) => void; targets: Target[]; w?: string }) {
  const val = item.target ? item.target : item.route ? "__route__" : "";
  return (
    <>
      <select className={`${input} ${w}`} value={val} onChange={e => { const v = e.target.value; if (v === "__route__") onPatch({ target: "", route: item.route || "/" }); else onPatch({ target: v, route: "" }); }}>
        <option value="">— link —</option>
        <option value="__route__">custom route…</option>
        {targets.map(t => <option key={t.object_key} value={t.object_key}>{t.display_name}</option>)}
      </select>
      {!item.target && item.route !== undefined && item.route !== "" && <input className={`${input} w-24`} value={item.route ?? ""} onChange={e => onPatch({ route: e.target.value, target: "" })} placeholder="/path" />}
    </>
  );
}

export default function NavigationDesigner({ navs, targets }: { navs: Obj[]; targets: Target[] }) {
  const router = useRouter();
  const [selKey, setSelKey] = useState<string | null>(navs[0]?.object_key ?? null);
  const selO = navs.find(o => o.object_key === selKey) ?? null;
  const [d, setD] = useState<Def>(load(navs[0]));
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<string | null>(null);
  const [asRole, setAsRole] = useState("");

  const items = d.items ?? []; const qas = d.quickActions ?? [];
  const setItems = (fn: (i: Item[]) => Item[]) => setD(p => ({ ...p, items: fn(p.items ?? []) }));
  const setQAs = (fn: (q: QA[]) => QA[]) => setD(p => ({ ...p, quickActions: fn(p.quickActions ?? []) }));
  const allKeys = () => new Set([...items.map(i => i.key), ...items.flatMap(i => (i.children ?? []).map(c => c.key))]);

  function pick(k: string) { setSelKey(k); setD(load(navs.find(o => o.object_key === k))); setMsg(null); setAsRole(""); }
  const addTop = () => setItems(i => [...i, { key: freeKey("nav", allKeys()), label: "", icon: "", target: "", route: "", roles: "", children: [] }]);
  const patchTop = (i: number, p: Partial<Item>) => setItems(it => it.map((x, j) => j === i ? { ...x, ...p } : x));
  const rmTop = (i: number) => setItems(it => it.filter((_, j) => j !== i));
  const moveTop = (i: number, dir: -1 | 1) => setItems(it => { const j = i + dir; if (j < 0 || j >= it.length) return it; const c = [...it]; [c[i], c[j]] = [c[j], c[i]]; return c; });
  const addChild = (i: number) => setItems(it => it.map((x, j) => j === i ? { ...x, children: [...(x.children ?? []), { key: freeKey("nav", allKeys()), label: "", icon: "", target: "", route: "", roles: "" }] } : x));
  const patchChild = (i: number, ci: number, p: Partial<Item>) => setItems(it => it.map((x, j) => j === i ? { ...x, children: (x.children ?? []).map((c, k) => k === ci ? { ...c, ...p } : c) } : x));
  const rmChild = (i: number, ci: number) => setItems(it => it.map((x, j) => j === i ? { ...x, children: (x.children ?? []).filter((_, k) => k !== ci) } : x));
  const addQA = () => setQAs(q => [...q, { key: freeKey("qa", new Set(q.map(x => x.key))), label: "", target: "", route: "" }]);

  const targetName = (k?: string) => k ? (targets.find(t => t.object_key === k)?.display_name ?? k) : null;
  const visibleFor = (it: Item) => { const r = roleList(it.roles); return !asRole.trim() || r.length === 0 || r.includes(asRole.trim().toLowerCase()); };

  async function save() {
    if (!selO) return;
    setBusy(true); setMsg(null);
    const r = await fetch("/api/config/objects", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ object_key: selO.object_key, definition: d }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    setMsg(r.ok ? `✓ Saved ${items.length} item(s).` : (j?.error || "Could not save."));
    if (r.ok) router.refresh();
  }

  const card = "bg-white rounded-xl border border-gray-200";
  if (!navs.length) return <div className={`${card} p-8 text-center`}><p className="text-sm text-gray-500">No navigation sections yet.</p><p className="text-xs text-gray-500 mt-1">Author a <b>Navigation Section</b> in the <a href="/super-admin/platform-ops/studio" className="text-indigo-700 underline">Configuration Studio</a> first, then design it here.</p></div>;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
      <div className={`${card} p-4`}>
        <p className="text-[11px] font-semibold text-gray-500 mb-2">Navigation sections ({navs.length})</p>
        <div className="space-y-1 max-h-[560px] overflow-y-auto">
          {navs.map(o => <button key={o.object_key} onClick={() => pick(o.object_key)} className={`w-full text-left rounded-lg px-2.5 py-1.5 transition-colors ${selKey === o.object_key ? "bg-indigo-50 ring-1 ring-indigo-200" : "hover:bg-gray-50"}`}><p className="text-xs font-medium text-gray-800 truncate">{o.display_name}</p><p className="text-[10px] text-gray-500 truncate">{(o.definition?.items?.length ?? 0)} item(s)</p></button>)}
        </div>
      </div>

      <div className={`${card} p-5 lg:col-span-3`}>
        {!selO ? <p className="text-sm text-gray-500 py-16 text-center">Select a navigation section.</p> : (
          <>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-900">{selO.display_name}</h3>
              <div className="flex items-center gap-2">
                <select className={`${input} w-28`} value={d.navType ?? "sidebar"} onChange={e => setD(p => ({ ...p, navType: e.target.value }))}>{NAV.map(n => <option key={n.v} value={n.v}>{n.l}</option>)}</select>
                <span className="text-[10px] text-gray-500 font-mono">{selO.object_key}</span>
              </div>
            </div>

            {/* Menu tree */}
            <div className="flex items-center justify-between mb-2"><p className="text-[11px] font-semibold text-gray-500">Menu items <span className="font-normal text-gray-500">· one level of nesting</span></p><button onClick={addTop} className="text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg px-3 py-1">+ Item</button></div>
            {items.length === 0 ? <p className="text-xs text-gray-500 py-3 text-center">Add items to compose the menu.</p> : (
              <div className="space-y-2 mb-4">
                {items.map((it, i) => (
                  <div key={it.key} className="border border-gray-100 rounded-lg p-2">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <div className="flex flex-col leading-none"><button onClick={() => moveTop(i, -1)} disabled={i === 0} className="text-gray-500 hover:text-gray-600 disabled:opacity-30 text-[10px]">▲</button><button onClick={() => moveTop(i, 1)} disabled={i === items.length - 1} className="text-gray-500 hover:text-gray-600 disabled:opacity-30 text-[10px]">▼</button></div>
                      <input className={`${input} w-10 text-center`} value={it.icon ?? ""} onChange={e => patchTop(i, { icon: e.target.value })} placeholder="⬚" title="icon" />
                      <input className={`${input} flex-1 min-w-[6rem]`} value={it.label} onChange={e => patchTop(i, { label: e.target.value })} placeholder="Label" />
                      <LinkPicker item={it} onPatch={p => patchTop(i, p)} targets={targets} />
                      <input className={`${input} w-24`} value={it.roles ?? ""} onChange={e => patchTop(i, { roles: e.target.value })} placeholder="roles (opt)" />
                      <button onClick={() => addChild(i)} className="text-[10px] font-medium text-indigo-700 border border-indigo-200 rounded px-1.5 py-0.5 hover:bg-indigo-50">+ sub</button>
                      <button onClick={() => rmTop(i)} className="text-gray-500 hover:text-[var(--cmp-text-error)] text-xs">✕</button>
                    </div>
                    {(it.children ?? []).length > 0 && (
                      <div className="mt-1.5 ml-6 space-y-1 border-l border-gray-100 pl-2">
                        {(it.children ?? []).map((c, ci) => (
                          <div key={c.key} className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-gray-500 text-[10px]">↳</span>
                            <input className={`${input} w-10 text-center`} value={c.icon ?? ""} onChange={e => patchChild(i, ci, { icon: e.target.value })} placeholder="⬚" />
                            <input className={`${input} flex-1 min-w-[5rem]`} value={c.label} onChange={e => patchChild(i, ci, { label: e.target.value })} placeholder="Sub-item" />
                            <LinkPicker item={c} onPatch={p => patchChild(i, ci, p)} targets={targets} w="w-32" />
                            <input className={`${input} w-20`} value={c.roles ?? ""} onChange={e => patchChild(i, ci, { roles: e.target.value })} placeholder="roles" />
                            <button onClick={() => rmChild(i, ci)} className="text-gray-500 hover:text-[var(--cmp-text-error)] text-xs">✕</button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Landing + quick actions */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div>
                <p className="text-[11px] font-semibold text-gray-500 mb-1.5">Landing page</p>
                <div className="flex items-center gap-1.5">
                  <select className={`${input} flex-1`} value={d.landing ? d.landing : d.landingRoute ? "__route__" : ""} onChange={e => { const v = e.target.value; if (v === "__route__") setD(p => ({ ...p, landing: "", landingRoute: p.landingRoute || "/" })); else setD(p => ({ ...p, landing: v, landingRoute: "" })); }}>
                    <option value="">— default —</option><option value="__route__">custom route…</option>
                    {targets.map(t => <option key={t.object_key} value={t.object_key}>{t.display_name}</option>)}
                  </select>
                  {!d.landing && d.landingRoute !== "" && d.landingRoute !== undefined && <input className={`${input} w-24`} value={d.landingRoute ?? ""} onChange={e => setD(p => ({ ...p, landingRoute: e.target.value }))} placeholder="/home" />}
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-1.5"><p className="text-[11px] font-semibold text-gray-500">Quick actions</p><button onClick={addQA} className="text-[11px] font-medium text-indigo-700 border border-indigo-200 rounded px-2 py-0.5 hover:bg-indigo-50">+ Action</button></div>
                <div className="space-y-1">
                  {qas.map((q, i) => (
                    <div key={q.key} className="flex items-center gap-1.5">
                      <input className={`${input} flex-1`} value={q.label} onChange={e => setQAs(qq => qq.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} placeholder="Action label" />
                      <LinkPicker item={q} onPatch={p => setQAs(qq => qq.map((x, j) => j === i ? { ...x, ...p } : x))} targets={targets} w="w-28" />
                      <button onClick={() => setQAs(qq => qq.filter((_, j) => j !== i))} className="text-gray-500 hover:text-[var(--cmp-text-error)] text-xs">✕</button>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Live preview */}
            {items.length > 0 && (
              <div className="rounded-lg bg-gray-50 border border-gray-100 p-3">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[11px] font-semibold text-gray-500">Preview <span className="font-normal text-gray-500">· {NAV.find(n => n.v === d.navType)?.l}</span></p>
                  <label className="flex items-center gap-1 text-[11px] text-gray-500">preview as role <input className={`${input} w-24`} value={asRole} onChange={e => setAsRole(e.target.value)} placeholder="e.g. nurse" /></label>
                </div>
                <div className="bg-white border border-gray-200 rounded-md p-2 max-w-xs">
                  {items.map(it => {
                    const vis = visibleFor(it);
                    return (
                      <div key={it.key} className={vis ? "" : "opacity-40"}>
                        <div className="flex items-center gap-1.5 px-1.5 py-1 text-xs text-gray-700"><span className="w-4 text-center">{it.icon || "•"}</span><span className={vis ? "" : "line-through"}>{it.label || <span className="text-gray-500">untitled</span>}</span>{targetName(it.target) && <span className="text-[9px] text-indigo-400 ml-auto truncate max-w-[7rem]">{targetName(it.target)}</span>}</div>
                        {(it.children ?? []).map(c => { const cv = visibleFor(c); return <div key={c.key} className={`flex items-center gap-1.5 pl-6 pr-1.5 py-0.5 text-[11px] text-gray-500 ${cv ? "" : "opacity-40"}`}><span className="w-3 text-center">{c.icon || "◦"}</span><span className={cv ? "" : "line-through"}>{c.label || <span className="text-gray-500">untitled</span>}</span></div>; })}
                      </div>
                    );
                  })}
                  {qas.length > 0 && <div className="mt-1.5 pt-1.5 border-t border-gray-100 flex flex-wrap gap-1 px-1.5">{qas.map(q => <span key={q.key} className="text-[10px] bg-gray-100 text-gray-600 rounded px-1.5 py-0.5">{q.label || "action"}</span>)}</div>}
                </div>
              </div>
            )}

            {msg && <p className={`text-xs mt-3 ${msg.startsWith("✓") ? "text-[var(--cmp-text-success)]" : "text-[var(--cmp-text-error)]"}`}>{msg}</p>}
            <div className="flex items-center justify-end mt-4"><button onClick={save} disabled={busy} className="text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg px-4 py-2 disabled:opacity-50">{busy ? "Saving…" : "Save navigation"}</button></div>
          </>
        )}
      </div>
    </div>
  );
}
