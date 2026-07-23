"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { resolveSettings, overrideAt, type OverrideRow, type ScopeCtx } from "@/lib/config/workspace-config";
import type { CatalogWorkspace } from "@/lib/config/workspace-catalog";

// Workspace Configuration Engine (WCE-001) Designer — edit draft config per scope,
// publish (draft→published) and roll back. Runtime enforcement is live for wired
// workspaces; edits to others are stored & versioned now.
/* eslint-disable @typescript-eslint/no-explicit-any */

export default function WorkspaceDesigner({ catalog, rows, versions, hospitals, provisioned }: {
  catalog: CatalogWorkspace[]; rows: OverrideRow[]; versions: any[]; hospitals: { id: string; name: string }[]; provisioned: boolean;
}) {
  const router = useRouter();
  const [scopeType, setScopeType] = useState<"platform" | "hospital">("platform");
  const [scopeRef, setScopeRef] = useState<string>("platform");
  const [activeWs, setActiveWs] = useState(catalog[0]?.key ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const ctx: ScopeCtx = scopeType === "hospital" ? { hospitalId: scopeRef } : {};
  const ws = catalog.find(w => w.key === activeWs);

  async function post(payload: any) {
    if (!provisioned) { setErr("Run migration 076 to enable editing."); return; }
    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/platform/workspace-config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scope_type: scopeType, scope_ref: scopeRef, ...payload }) });
      if (!res.ok) { const j = await res.json().catch(() => ({})); setErr(j.error ?? "Failed"); return; }
      router.refresh();
    } catch { setErr("Network error"); } finally { setBusy(false); }
  }
  const draftAt = (path: string) => overrideAt(rows, scopeType, scopeRef, path)?.draft ?? {};
  const toggle = (path: string, curEnabled: boolean) => post({ action: "set", config_path: path, settings: { ...draftAt(path), enabled: !curEnabled } });
  const rename = (path: string, fallback: string) => { const v = window.prompt("Rename to (blank = default):", resolveSettings(rows, ctx, path, "draft").label ?? fallback); if (v !== null) post({ action: "set", config_path: path, settings: { ...draftAt(path), label: v.trim() || undefined } }); };
  const reset = (path: string) => post({ action: "reset", config_path: path });

  const scopeRows = rows.filter(r => r.scope_type === scopeType && (r.scope_ref ?? null) === (scopeRef ?? null));
  const unpublished = scopeRows.filter(r => JSON.stringify(r.draft ?? {}) !== JSON.stringify(r.published ?? null)).length;
  const scopeVersions = versions.filter(v => v.scope_type === scopeType && (v.scope_ref ?? null) === (scopeRef ?? null));

  const Toggle = ({ path, canDisable, fallback }: { path: string; canDisable: boolean; fallback: string }) => {
    const eff = resolveSettings(rows, ctx, path, "draft");
    const has = !!overrideAt(rows, scopeType, scopeRef, path);
    return (
      <div className="flex items-center gap-2">
        <span className={`text-[9px] px-1 py-0.5 rounded ${has ? "bg-violet-50 text-violet-600" : "bg-gray-100 text-gray-400"}`}>{has ? "overridden" : "inherited"}</span>
        <button disabled={!canDisable || busy} onClick={() => toggle(path, eff.enabled)}
          className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${!canDisable ? "bg-gray-100 cursor-not-allowed" : eff.enabled ? "bg-teal-500" : "bg-gray-300"}`} title={canDisable ? (eff.enabled ? "Enabled — click to disable" : "Disabled — click to enable") : "Cannot be disabled"}>
          <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${eff.enabled ? "left-[18px]" : "left-0.5"}`} />
        </button>
        <button onClick={() => rename(path, fallback)} disabled={busy} className="text-[11px] text-gray-400 hover:text-teal-600" title="Rename">✎</button>
        {has && <button onClick={() => reset(path)} disabled={busy} className="text-[11px] text-gray-400 hover:text-rose-600" title="Reset to inherited">↺</button>}
      </div>
    );
  };

  const card = "bg-white rounded-xl border border-gray-200";
  return (
    <div className="space-y-4">
      {/* Scope + publish bar */}
      <div className={`${card} p-4 flex flex-wrap items-center gap-3`}>
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold text-gray-500 uppercase">Scope</span>
          <select value={scopeType} onChange={e => { const t = e.target.value as any; setScopeType(t); setScopeRef(t === "platform" ? "platform" : (hospitals[0]?.id ?? "")); }} className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white">
            <option value="platform">Platform (all tenants)</option>
            <option value="hospital">Hospital</option>
          </select>
          {scopeType === "hospital" && (
            <select value={scopeRef} onChange={e => setScopeRef(e.target.value)} className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white max-w-[180px]">
              {hospitals.length === 0 && <option value="">No hospitals</option>}
              {hospitals.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>
          )}
          <span className="text-[10px] text-gray-400">Unit / Role / User scopes: engine-supported, surfaced here in a later phase.</span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {unpublished > 0 && <span className="text-[11px] text-amber-600 font-medium">{unpublished} unpublished change{unpublished > 1 ? "s" : ""}</span>}
          <button onClick={() => post({ action: "publish", label: `Publish ${new Date().toISOString().slice(0, 16).replace("T", " ")}` })} disabled={busy || !provisioned || unpublished === 0}
            className={`text-xs font-semibold px-3 py-1.5 rounded-lg ${unpublished > 0 && provisioned ? "bg-teal-600 text-white hover:bg-teal-700" : "bg-gray-100 text-gray-400"}`}>Publish</button>
        </div>
      </div>
      {err && <div className="rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs px-3 py-2">{err}</div>}

      {/* Workspace tabs */}
      <div className="flex gap-1 flex-wrap">
        {catalog.map(w => (
          <button key={w.key} onClick={() => setActiveWs(w.key)} className={`text-xs font-medium px-3 py-1.5 rounded-lg flex items-center gap-1.5 ${activeWs === w.key ? "bg-teal-600 text-white" : "bg-white border border-gray-200 text-gray-600"}`}>
            {w.label}{w.wired ? <span className="text-[9px] px-1 rounded bg-green-400/20 text-green-100 border border-green-300/30">live</span> : <span className="text-[9px] px-1 rounded bg-gray-400/20 text-current opacity-60">stored</span>}
          </button>
        ))}
      </div>

      {/* Config tree */}
      <div className={`${card} p-5`}>
        {!ws ? <p className="text-sm text-gray-400">Select a workspace.</p> : (
          <>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-bold text-gray-900">{ws.label}</h2>
              <span className="text-[11px] text-gray-400">{ws.wired ? "Runtime enforcement LIVE — disabling hides it from the app" : "Config stored & versioned; runtime enforcement rolls out per phase"}</span>
            </div>
            <div className="space-y-3">
              {ws.sections.map(s => (
                <div key={s.path} className="rounded-lg border border-gray-100">
                  <div className="flex items-center justify-between px-3 py-2 bg-gray-50/60 rounded-t-lg">
                    <span className="text-sm font-semibold text-gray-800">{resolveSettings(rows, ctx, s.path, "draft").label ?? s.label}</span>
                    <Toggle path={s.path} canDisable={s.canDisable !== false} fallback={s.label} />
                  </div>
                  {s.modules.length > 0 && (
                    <div className="divide-y divide-gray-50">
                      {s.modules.map(mod => (
                        <div key={mod.path} className="flex items-center justify-between px-3 py-2 pl-6">
                          <div className="min-w-0">
                            <p className="text-xs text-gray-700">{resolveSettings(rows, ctx, mod.path, "draft").label ?? mod.label}</p>
                            {mod.note && <p className="text-[10px] text-gray-400">{mod.note}</p>}
                          </div>
                          <Toggle path={mod.path} canDisable={mod.canDisable !== false} fallback={mod.label} />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Version history / rollback */}
      <div className={`${card} p-5`}>
        <h2 className="text-sm font-bold text-gray-900 mb-3">Published Versions — {scopeType === "platform" ? "Platform" : `Hospital ${scopeRef.slice(0, 8)}`}</h2>
        {scopeVersions.length === 0 ? <p className="text-sm text-gray-400">No versions published for this scope yet. Make changes, then Publish.</p> : (
          <div className="space-y-1.5">
            {scopeVersions.map((v: any) => (
              <div key={v.id} className="flex items-center gap-2 text-xs">
                <span className={`px-1.5 py-0.5 rounded ${v.status === "rolled_back" ? "bg-amber-50 text-amber-700" : "bg-green-50 text-green-700"}`}>{v.status}</span>
                <span className="text-gray-700">{v.label ?? "Version"}</span>
                <span className="text-gray-400">· {v.published_by_name ?? "—"} · {new Date(v.created_at).toLocaleString()}</span>
                <button onClick={() => post({ action: "rollback", version_id: v.id })} disabled={busy || !provisioned} className="ml-auto text-[11px] text-teal-700 hover:underline">Roll back to this →</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
