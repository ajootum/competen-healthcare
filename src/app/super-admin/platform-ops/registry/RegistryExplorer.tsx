"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { OBJECT_TYPE_LABEL, CLASS_LABEL, SAFETY_LABEL } from "@/lib/config/registry";
import { cardClass } from "@/components/ui/primitives";

// WCE-002 registry explorer — search / filter the registered objects (§19.2/19.3) with a detail pane
// (§19.4), plus the "sync from catalogue" action. Read-only over the registry; the schema editor and
// dependency graph are next-phase.
/* eslint-disable @typescript-eslint/no-explicit-any */
const TYPE_TONE: Record<string, string> = { PLATFORM: "bg-gray-800 text-white", PRODUCT_SUITE: "bg-gray-600 text-white", WORKSPACE: "bg-violet-100 text-violet-700", NAVIGATION_SECTION: "bg-sky-100 text-sky-700", MODULE: "bg-emerald-100 text-emerald-700", WIDGET: "bg-amber-100 text-amber-700" };
const classTone = (c: string) => (c.startsWith("mandatory") ? "bg-rose-50 text-rose-700" : c === "optional" ? "bg-emerald-50 text-emerald-700" : c === "conditional" ? "bg-amber-50 text-amber-700" : "bg-gray-50 text-gray-600");
const safetyTone = (s: string) => (s.includes("critical") ? "bg-rose-50 text-rose-700" : s.includes("relevant") ? "bg-amber-50 text-amber-700" : "bg-gray-50 text-gray-500");

export default function RegistryExplorer({ objects }: { objects: any[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [sel, setSel] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const types = useMemo(() => [...new Set(objects.map(o => o.object_type))], [objects]);
  const filtered = useMemo(() => objects.filter(o => {
    if (type && o.object_type !== type) return false;
    if (!q.trim()) return true;
    const s = q.toLowerCase();
    return o.object_key.toLowerCase().includes(s) || (o.display_name ?? "").toLowerCase().includes(s);
  }).slice(0, 300), [objects, q, type]);

  async function sync() {
    setBusy(true); setMsg(null);
    const r = await fetch("/api/registry", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "sync" }) });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (r.ok) { setMsg(`Synced — ${d.registered} objects (${d.inserted} new, ${d.updated} updated)`); router.refresh(); }
    else setMsg(d?.error || "Sync failed");
  }

  return (
    <div className={cardClass}>
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <h2 className="text-sm font-bold text-gray-900">Object Explorer <span className="text-[10px] text-gray-400 font-normal">{objects.length} registered</span></h2>
        <div className="flex items-center gap-2">
          {msg && <span className="text-[11px] text-gray-500">{msg}</span>}
          <button onClick={sync} disabled={busy} className="text-xs bg-teal-600 text-white rounded-lg px-3 py-1.5 hover:bg-teal-700 disabled:opacity-50 font-medium">{busy ? "Syncing…" : "↻ Sync from catalogue"}</button>
        </div>
      </div>

      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search by key or name…" className="flex-1 min-w-[200px] border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/40" />
        <select value={type} onChange={e => setType(e.target.value)} className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm">
          <option value="">All types</option>
          {types.map(t => <option key={t} value={t}>{OBJECT_TYPE_LABEL[t] ?? t}</option>)}
        </select>
      </div>

      {objects.length === 0 ? (
        <div className="text-center py-10 border border-dashed border-gray-200 rounded-lg">
          <p className="text-sm font-semibold text-gray-700">Registry is empty</p>
          <p className="text-xs text-gray-400 mt-1">Click “Sync from catalogue” to register the real platform structure (workspaces → sections → modules).</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="max-h-[26rem] overflow-y-auto pr-1">
            {filtered.length === 0 ? <p className="text-sm text-gray-400 py-6 text-center">No objects match.</p> : (
              <div className="space-y-0.5">{filtered.map(o => (
                <button key={o.object_key} onClick={() => setSel(o)} className={`w-full text-left rounded-lg px-2.5 py-1.5 hover:bg-gray-50 transition-colors ${sel?.object_key === o.object_key ? "bg-teal-50/60 ring-1 ring-teal-200" : ""}`}>
                  <div className="flex items-center gap-2">
                    <span className={`text-[9px] font-semibold rounded px-1.5 py-0.5 shrink-0 ${TYPE_TONE[o.object_type] ?? "bg-gray-100 text-gray-500"}`}>{OBJECT_TYPE_LABEL[o.object_type] ?? o.object_type}</span>
                    <span className="text-xs font-medium text-gray-800 truncate">{o.display_name}</span>
                  </div>
                  <p className="text-[10px] text-gray-400 font-mono truncate mt-0.5">{o.object_key}</p>
                </button>
              ))}</div>
            )}
          </div>

          <div className="border border-gray-100 rounded-lg p-4 max-h-[26rem] overflow-y-auto">
            {!sel ? <p className="text-sm text-gray-400 py-10 text-center">Select an object to inspect its configuration contract.</p> : (
              <div className="space-y-3">
                <div>
                  <div className="flex items-center gap-2 mb-1"><span className={`text-[9px] font-semibold rounded px-1.5 py-0.5 ${TYPE_TONE[sel.object_type] ?? "bg-gray-100 text-gray-500"}`}>{OBJECT_TYPE_LABEL[sel.object_type] ?? sel.object_type}</span><span className="text-[10px] text-gray-400">schema v{sel.schema_version} · {sel.status}</span></div>
                  <h3 className="text-sm font-bold text-gray-900">{sel.display_name}</h3>
                  <p className="text-[10px] text-gray-400 font-mono break-all">{sel.object_key}</p>
                  {sel.description && <p className="text-xs text-gray-600 mt-1">{sel.description}</p>}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <span className={`text-[10px] font-medium rounded px-1.5 py-0.5 ${classTone(sel.configurability_class)}`}>{CLASS_LABEL[sel.configurability_class] ?? sel.configurability_class}</span>
                  <span className={`text-[10px] font-medium rounded px-1.5 py-0.5 ${safetyTone(sel.safety_classification)}`}>{SAFETY_LABEL[sel.safety_classification] ?? sel.safety_classification}</span>
                  <span className="text-[10px] font-medium rounded px-1.5 py-0.5 bg-gray-50 text-gray-600">override: {sel.override_policy}</span>
                </div>
                <dl className="text-xs space-y-1">
                  <Row k="Parent" v={sel.parent_object_key ?? "—"} mono />
                  <Row k="Route" v={sel.route ?? "—"} mono />
                  <Row k="Config owner" v={sel.configuration_owner ?? "—"} />
                  <Row k="Default enabled" v={sel.default_enabled ? "Yes" : "No"} />
                  <Row k="Mandatory" v={sel.mandatory ? "Yes" : "No"} />
                  <Row k="Data source" v={sel.data_source_key ?? "— (next-phase)"} mono />
                  <Row k="Config levels" v={(sel.allowed_config_levels ?? []).join(", ") || "—"} />
                  <Row k="Dependencies" v={(sel.dependencies ?? []).map((d: any) => d.objectKey).join(", ") || "—"} mono />
                  <Row k="Source" v={sel.source} />
                </dl>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return <div className="flex items-start gap-2"><dt className="text-gray-400 w-24 shrink-0">{k}</dt><dd className={`text-gray-700 break-all ${mono ? "font-mono text-[10px]" : ""}`}>{v}</dd></div>;
}
