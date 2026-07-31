"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { cardClass } from "@/components/ui/primitives";

// Configuration Studio authoring form. Creates a draft registry object (POST /api/config/objects), then raises
// a governance change request for it (POST /api/governance/config) so it is governed + dependency-gated from
// birth. No visual field-level designer yet — this authors the governed object identity/metadata.
const TYPES: [string, string][] = [["METRIC", "Metric"], ["FORM", "Form"], ["REPORT", "Report"], ["DASHBOARD", "Dashboard"], ["WORKFLOW", "Workflow"], ["BUSINESS_RULE", "Business Rule"], ["MODULE", "Module"], ["WIDGET", "Widget"], ["PAGE", "Page"], ["NAVIGATION_SECTION", "Navigation Section"], ["PERMISSION", "Permission"], ["DATA_SOURCE", "Data Source"]];
const CLASSES: [string, string][] = [["optional", "Optional"], ["mandatory_configurable", "Mandatory · Configurable"], ["conditional", "Conditional"], ["user_personalisable", "User-personalisable"]];
const SAFETY: [string, string][] = [["operational", "Operational"], ["non_clinical", "Non-clinical"], ["administrative", "Administrative"], ["clinical_support", "Clinical support"], ["clinical_safety_relevant", "Clinical-safety relevant"], ["clinical_safety_critical", "Clinical-safety critical"], ["security_critical", "Security critical"], ["regulatory_critical", "Regulatory critical"], ["financial_control_critical", "Financial-control critical"]];
const input = "w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30";
const label = "text-[11px] font-semibold text-gray-500";
const EMPTY = { object_type: "METRIC", object_key: "", display_name: "", parent_object_key: "", safety_classification: "operational", configurability_class: "optional", data_source_key: "", description: "" };

export default function StudioForm({ existingKeys, sources }: { existingKeys: string[]; sources: string[] }) {
  const router = useRouter();
  const [f, setF] = useState({ ...EMPTY });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ key: string; cr?: string } | null>(null);
  const set = (k: string, v: string) => setF(p => ({ ...p, [k]: v }));

  async function submit() {
    setErr(null); setDone(null);
    if (!f.object_key.trim() || !f.display_name.trim()) { setErr("Object key and display name are required."); return; }
    setBusy(true);
    const r1 = await fetch("/api/config/objects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(f) });
    const d1 = await r1.json().catch(() => ({}));
    if (!r1.ok) { setBusy(false); setErr(d1?.error || "Could not create the object."); return; }
    const typeLabel = TYPES.find(t => t[0] === f.object_type)?.[1] ?? f.object_type;
    const r2 = await fetch("/api/governance/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "create", title: `Author ${typeLabel}: ${f.display_name.trim()}`, description: f.description || null, business_reason: "Authored via the Configuration Studio", affected_objects: [f.object_key.trim().toLowerCase()], scope_type: "platform", change_type: "normal" }) });
    const d2 = await r2.json().catch(() => ({}));
    setBusy(false);
    setDone({ key: f.object_key.trim().toLowerCase(), cr: r2.ok ? d2?.cr?.cr_ref : undefined });
    setF({ ...EMPTY });
    router.refresh();
  }

  return (
    <div className={cardClass}>
      <h2 className="font-semibold text-gray-900 text-sm mb-1">Author a Configuration Object</h2>
      <p className="text-[11px] text-gray-400 mb-4">Create a governed object of any builder type. It enters the registry as a <b>draft</b> and a change request is raised — it goes active only through governance + the dependency gate.</p>

      {done && (
        <div className="mb-4 rounded-lg bg-emerald-50 border border-emerald-100 p-3 text-[12px] text-emerald-800">
          ✓ Created draft <code className="font-mono">{done.key}</code>{done.cr ? <> · change request <b>{done.cr}</b> raised.</> : <> — raise a change request in Governance to publish it.</>} <a href="/super-admin/platform-ops/governance" className="underline">Open Governance →</a>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className={label}>Object Type<select className={input} value={f.object_type} onChange={e => set("object_type", e.target.value)}>{TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        <label className={label}>Display Name<input className={input} value={f.display_name} onChange={e => set("display_name", e.target.value)} placeholder="e.g. Falls per 1000 bed-days" /></label>
        <label className={label}>Object Key<input className={input} value={f.object_key} onChange={e => set("object_key", e.target.value)} placeholder="workspace.ward.falls_rate" /></label>
        <label className={label}>Parent Object <span className="font-normal text-gray-400">(optional)</span><input className={input} list="reg-keys" value={f.parent_object_key} onChange={e => set("parent_object_key", e.target.value)} placeholder="workspace.unit-manager.quality" /></label>
        <label className={label}>Configurability<select className={input} value={f.configurability_class} onChange={e => set("configurability_class", e.target.value)}>{CLASSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        <label className={label}>Safety Classification<select className={input} value={f.safety_classification} onChange={e => set("safety_classification", e.target.value)}>{SAFETY.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        <label className={label}>Data Source <span className="font-normal text-gray-400">(optional)</span><input className={input} list="src-keys" value={f.data_source_key} onChange={e => set("data_source_key", e.target.value)} placeholder="op_incidents" /></label>
        <label className={`${label} sm:col-span-2`}>Description<textarea className={input} rows={2} value={f.description} onChange={e => set("description", e.target.value)} placeholder="What this object represents." /></label>
      </div>
      <datalist id="reg-keys">{existingKeys.slice(0, 400).map(k => <option key={k} value={k} />)}</datalist>
      <datalist id="src-keys">{sources.map(k => <option key={k} value={k} />)}</datalist>

      {err && <p className="text-xs text-rose-600 mt-3">{err}</p>}
      <div className="flex items-center justify-end gap-2 mt-4">
        <button onClick={() => { setF({ ...EMPTY }); setErr(null); setDone(null); }} className="text-xs text-gray-500 hover:underline">Clear</button>
        <button onClick={submit} disabled={busy} className="text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg px-4 py-2 disabled:opacity-50">{busy ? "Creating…" : "Create & raise change request"}</button>
      </div>
    </div>
  );
}
