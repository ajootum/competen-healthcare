"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from "react";

// Runtime Resolution explorer (NCP-015) — pick a configuration object, set a runtime context (tenant / hospital /
// unit / roles) and resolve its EFFECTIVE settings with a full precedence trace: every layer that contributed,
// least → most specific, so any runtime value is explainable. Calls GET /api/config/runtime.
type ObjRow = { object_key: string; object_type: string; display_name: string };

const input = "border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400 bg-white";
const LEVEL_TONE: Record<string, string> = { platform_default: "bg-gray-100 text-gray-600", platform: "bg-gray-100 text-gray-600", tenant: "bg-indigo-100 text-indigo-700", hospital: "bg-[var(--cmp-surface-information)] text-[var(--cmp-text-information)]", unit: "bg-teal-100 text-teal-700", role: "bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)]", user: "bg-violet-100 text-violet-700" };
const COMPOSABLE = ["PAGE", "DASHBOARD", "NAVIGATION_SECTION"];

function NavTree({ items, depth = 0 }: { items: any[]; depth?: number }) {
  return <>{items.map((it: any) => (
    <div key={it.key}>
      <div className={`flex items-center gap-1.5 text-[11px] py-0.5 ${it.visible ? "text-gray-700" : "text-gray-300 line-through"}`} style={{ paddingLeft: depth * 14 }}>
        <span className="w-3 text-center">{it.icon || (depth ? "◦" : "•")}</span>
        <span className="truncate">{it.label || it.key}</span>
        {!it.visible && <span className="text-[9px] text-rose-400 no-underline">hidden · {it.reason}</span>}
        {it.target && it.visible && <span className="text-[9px] text-indigo-400">→ {it.target.name}</span>}
      </div>
      {it.children?.length > 0 && <NavTree items={it.children} depth={depth + 1} />}
    </div>
  ))}</>;
}

export default function RuntimeResolver({ objects }: { objects: ObjRow[] }) {
  const [q, setQ] = useState("");
  const [object, setObject] = useState<string>("");
  const [ctx, setCtx] = useState({ tenant: "", hospital: "", unit: "", roles: "" });
  const [res, setRes] = useState<any | null>(null);
  const [composed, setComposed] = useState<any | null>(null);
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<string | null>(null);

  const filtered = objects.filter(o => !q || o.display_name.toLowerCase().includes(q.toLowerCase()) || o.object_key.includes(q.toLowerCase())).slice(0, 200);

  async function resolve() {
    if (!object) { setMsg("Pick an object to resolve."); return; }
    setBusy(true); setMsg(null); setRes(null); setComposed(null);
    const p = new URLSearchParams({ object, tenant: ctx.tenant, hospital: ctx.hospital, unit: ctx.unit, roles: ctx.roles });
    const r = await fetch(`/api/config/runtime?${p.toString()}`);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setBusy(false); setMsg(j?.error || "Resolve failed."); return; }
    setRes(j);
    if (COMPOSABLE.includes(j.object?.type)) {
      const cr = await fetch(`/api/config/runtime?${p.toString()}&compose=1`);
      const cj = await cr.json().catch(() => ({}));
      if (cr.ok && cj.composable) setComposed(cj);
    }
    setBusy(false);
  }

  const card = "bg-white rounded-xl border border-gray-200";
  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
      <div className={`${card} p-4`}>
        <input className={`${input} w-full mb-2`} value={q} onChange={e => setQ(e.target.value)} placeholder="search objects…" />
        <div className="space-y-1 max-h-[300px] overflow-y-auto mb-3">
          {filtered.map(o => <button key={o.object_key} onClick={() => { setObject(o.object_key); setRes(null); }} className={`w-full text-left rounded-lg px-2.5 py-1.5 transition-colors ${object === o.object_key ? "bg-indigo-50 ring-1 ring-indigo-200" : "hover:bg-gray-50"}`}><p className="text-xs font-medium text-gray-800 truncate">{o.display_name}</p><p className="text-[10px] text-gray-400 font-mono truncate">{o.object_type}</p></button>)}
        </div>
        <div className="border-t border-gray-100 pt-3 space-y-1.5">
          <p className="text-[11px] font-semibold text-gray-500">Context</p>
          <input className={`${input} w-full`} value={ctx.tenant} onChange={e => setCtx(c => ({ ...c, tenant: e.target.value }))} placeholder="tenant id" />
          <input className={`${input} w-full`} value={ctx.hospital} onChange={e => setCtx(c => ({ ...c, hospital: e.target.value }))} placeholder="hospital id" />
          <input className={`${input} w-full`} value={ctx.unit} onChange={e => setCtx(c => ({ ...c, unit: e.target.value }))} placeholder="unit id" />
          <input className={`${input} w-full`} value={ctx.roles} onChange={e => setCtx(c => ({ ...c, roles: e.target.value }))} placeholder="roles (comma)" />
          <button onClick={resolve} disabled={busy || !object} className="w-full text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-50">{busy ? "Resolving…" : "Resolve"}</button>
        </div>
      </div>

      <div className={`${card} p-5 lg:col-span-3`}>
        {msg && <p className="text-xs text-[var(--cmp-text-error)] mb-2">{msg}</p>}
        {!res ? <p className="text-sm text-gray-400 py-16 text-center">Pick an object and a context, then resolve its effective configuration.</p> : (
          <>
            <div className="flex items-center gap-2 mb-3"><h3 className="text-sm font-semibold text-gray-900">{res.object.name}</h3><span className="text-[10px] text-gray-400 font-mono">{res.object.key}</span></div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              <div className={`rounded-lg border p-3 ${res.effective.enabled ? "border-[var(--cmp-color-success)] bg-[var(--cmp-surface-success)]" : "border-[var(--cmp-color-error)] bg-[var(--cmp-surface-error)]"}`}><p className="text-[10px] text-gray-500 uppercase">Effective</p><p className={`text-sm font-bold ${res.effective.enabled ? "text-emerald-700" : "text-[var(--cmp-text-error)]"}`}>{res.effective.enabled ? "enabled" : "disabled"}</p></div>
              <div className="rounded-lg border border-gray-200 p-3"><p className="text-[10px] text-gray-500 uppercase">Label</p><p className="text-sm font-medium text-gray-800 truncate">{res.effective.label}</p></div>
              <div className="rounded-lg border border-gray-200 p-3"><p className="text-[10px] text-gray-500 uppercase">Layers applied</p><p className="text-sm font-bold text-gray-800 tabular-nums">{res.layers}</p></div>
              <div className="rounded-lg border border-gray-200 p-3"><p className="text-[10px] text-gray-500 uppercase">Object status</p><p className="text-sm font-medium text-gray-800">{res.object.status}</p></div>
            </div>

            <p className="text-[11px] font-semibold text-gray-500 mb-1.5">Resolution trace <span className="font-normal text-gray-400">· least → most specific; later layers win</span></p>
            <div className="space-y-1.5 mb-4">
              {res.trace.map((t: any, i: number) => (
                <div key={i} className="flex items-start gap-2 border border-gray-100 rounded-lg px-2.5 py-1.5">
                  <span className="text-[9px] text-gray-300 w-4 tabular-nums pt-0.5">{i + 1}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${LEVEL_TONE[t.level] ?? "bg-gray-100 text-gray-600"}`}>{t.level}{t.scopeRef ? `:${String(t.scopeRef).slice(0, 8)}` : ""}</span>
                  <span className="text-[11px] text-gray-600 flex-1 font-mono break-all">{Object.entries(t.contributed).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(", ") || "—"}</span>
                  {t.note && <span className="text-[10px] text-gray-400 shrink-0">{t.note}</span>}
                </div>
              ))}
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] text-gray-400">Allowed levels:</span>
              {(res.allowedLevels ?? []).map((l: string) => <span key={l} className="text-[10px] bg-gray-50 border border-gray-100 rounded px-1.5 py-0.5 text-gray-500">{l}</span>)}
              <span className="text-[10px] text-gray-400 ml-auto font-mono">{res.cacheKey}</span>
            </div>

            {composed && (
              <div className="mt-5 pt-4 border-t border-gray-100">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[11px] font-semibold text-gray-500">Composed runtime model <span className="font-normal text-gray-400">· what renders in this context</span></p>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-gray-400">{composed.stats.included} shown · {composed.stats.excluded} hidden · {composed.stats.references} ref(s)</span>
                    <a href={`/config-view/${encodeURIComponent(res.object.key)}`} target="_blank" rel="noopener" className="text-[10px] font-medium text-indigo-700 border border-indigo-200 rounded px-1.5 py-0.5 hover:bg-indigo-50">Open live view ↗</a>
                  </div>
                </div>

                {composed.model.kind === "page" && (
                  <div className="space-y-1.5">
                    {composed.model.rows.map((row: any, ri: number) => (
                      <div key={ri} className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${composed.model.grid}, minmax(0,1fr))` }}>
                        {row.columns.map((col: any, ci: number) => (
                          <div key={ci} className={`rounded-md border px-2 py-1.5 min-h-[40px] ${col.shown ? "bg-white border-gray-200" : "bg-gray-50 border-dashed border-gray-200 opacity-50"}`} style={{ gridColumn: `span ${col.span} / span ${col.span}` }}>
                            <p className={`text-[11px] font-medium truncate ${col.shown ? "text-gray-800" : "text-gray-400 line-through"}`}>{col.widget?.name ?? "—"}</p>
                            {col.widget && !col.shown && <p className="text-[9px] text-rose-400">disabled here</p>}
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                )}

                {composed.model.kind === "dashboard" && (
                  <div className="grid gap-1.5" style={{ gridTemplateColumns: "repeat(12, minmax(0,1fr))" }}>
                    {composed.model.tiles.map((t: any) => (
                      <div key={t.key} className={`rounded-md border px-2 py-1.5 min-h-[44px] ${t.shown ? "bg-white border-gray-200" : "bg-gray-50 border-dashed border-gray-200 opacity-50"}`} style={{ gridColumn: `span ${t.span || 4} / span ${t.span || 4}` }}>
                        <p className={`text-[11px] font-medium truncate ${t.shown ? "text-gray-800" : "text-gray-400 line-through"}`}>{t.title || t.key}</p>
                        {t.metric && <p className={`text-[9px] truncate ${t.metric.enabled ? "text-indigo-500" : "text-rose-400"}`}>↳ {t.metric.name}{!t.metric.enabled ? " (off)" : ""}</p>}
                      </div>
                    ))}
                  </div>
                )}

                {composed.model.kind === "navigation" && (
                  <div className="bg-white border border-gray-200 rounded-md p-2 max-w-xs"><NavTree items={composed.model.items} /></div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
