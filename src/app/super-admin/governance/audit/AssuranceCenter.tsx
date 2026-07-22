"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Audit & Assurance canvas (GOV-001.5) — real in-place assurance actions:
//   Plan Audit    → POST /api/quality/audits {mode:"plan"} (schedules a
//                   status='planned' audit; completed audits are recorded
//                   through the assessor cockpit's checklist flow)
//   Record CAPA   → POST /api/quality/capa (standalone corrective action)
//   Advance CAPA  → PATCH /api/quality/capa (FORWARD-ONLY workflow:
//                   open → in_progress → completed → verified → closed —
//                   the server rejects backwards moves)
// All audit-logged; CAPA owners are notified server-side.
/* eslint-disable @typescript-eslint/no-explicit-any */

const input = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/40";
const label = "text-xs font-semibold text-gray-600 mb-1 block";

const AUDIT_TYPES: Record<string, string> = { clinical: "Clinical", concurrent: "Concurrent", retrospective: "Retrospective" };
const PRIORITIES = ["low", "medium", "high"];
const CAPA_STATUSES: Record<string, string> = { in_progress: "In progress", completed: "Completed (action done)", verified: "Verified (effectiveness checked)", closed: "Closed" };

type Picker = { id: string; label: string };

const TABS = [
  { key: "plan", label: "Plan Audit", icon: "📅" },
  { key: "capa", label: "Record CAPA", icon: "🛠️" },
  { key: "advance", label: "Advance CAPA", icon: "✅" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

export default function AssuranceCenter({ openCapas }: { openCapas: Picker[] }) {
  const router = useRouter();
  const [tab, setTab] = useState<TabKey>("plan");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ k: "ok" | "err"; t: string } | null>(null);
  const [form, setForm] = useState<any>({});
  const set = (k: string) => (e: any) => setForm((f: any) => ({ ...f, [k]: e.target.value }));
  const toast = (k: "ok" | "err", t: string) => { setMsg({ k, t }); setTimeout(() => setMsg(null), 5000); };
  const switchTab = (k: TabKey) => { setTab(k); setForm({}); setMsg(null); };

  async function act() {
    let url = "", method = "POST", body: any = {}, missing = "", okText = "";
    if (tab === "plan") {
      if (!String(form.title ?? "").trim()) missing = "title";
      url = "/api/quality/audits";
      body = { mode: "plan", title: form.title, audit_type: form.audit_type || "clinical", area: form.area || undefined, planned_for: form.planned_for || undefined, note: form.note || undefined };
      okText = "Audit planned";
    } else if (tab === "capa") {
      if (!String(form.title ?? "").trim()) missing = "title";
      url = "/api/quality/capa";
      body = { title: form.title, description: form.description || undefined, priority: PRIORITIES.includes(form.priority) ? form.priority : "medium", due_date: form.due_date || undefined };
      okText = "Corrective action recorded (owner notified)";
    } else {
      if (!form.capa_id) missing = "corrective action";
      else if (!form.status) missing = "status";
      url = "/api/quality/capa";
      method = "PATCH";
      body = { id: form.capa_id, status: form.status, evidence_note: form.evidence_note || undefined };
      okText = `CAPA advanced to ${String(form.status ?? "").replace(/_/g, " ")}`;
    }
    if (missing) { toast("err", `${missing} is required`); return; }

    setBusy(true);
    try {
      const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (r.ok) { toast("ok", okText); setForm({}); router.refresh(); }
      else toast("err", (await r.json().catch(() => ({}))).error ?? "Action failed");
    } catch { toast("err", "Network error — nothing was changed"); }
    finally { setBusy(false); }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200">
      <div className="flex items-center gap-2 p-3 border-b border-gray-100 flex-wrap">
        <h2 className="font-semibold text-gray-900 text-[15px] mr-auto">Assurance Center</h2>
        {msg && <span className={`text-xs rounded-lg px-2.5 py-1 ${msg.k === "ok" ? "bg-green-50 text-green-800" : "bg-amber-50 text-amber-800"}`}>{msg.t}</span>}
        <div className="flex gap-1">
          {TABS.map(b => (
            <button key={b.key} onClick={() => switchTab(b.key)} className={`text-xs font-medium rounded-lg px-2.5 py-1.5 border ${tab === b.key ? "bg-teal-50 border-teal-300 text-teal-700" : "border-gray-200 text-gray-500 hover:bg-gray-50"}`}>{b.icon} {b.label}</button>
          ))}
        </div>
      </div>

      <div className="p-5">
        {tab === "plan" && (
          <div className="grid sm:grid-cols-2 gap-3">
            <div><label className={label}>Audit title *</label><input value={form.title ?? ""} onChange={set("title")} className={input} placeholder="e.g. Q3 hand-hygiene compliance audit" /></div>
            <div><label className={label}>Audit type</label><select value={form.audit_type ?? "clinical"} onChange={set("audit_type")} className={input}>{Object.entries(AUDIT_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
            <div><label className={label}>Area / department</label><input value={form.area ?? ""} onChange={set("area")} className={input} placeholder="e.g. ICU" /></div>
            <div><label className={label}>Planned for</label><input type="date" value={form.planned_for ?? ""} onChange={set("planned_for")} className={input} /></div>
            <div className="sm:col-span-2"><label className={label}>Scope / note</label><textarea value={form.note ?? ""} onChange={set("note")} rows={2} className={input} /></div>
            <p className="sm:col-span-2 text-[11px] text-gray-400">Schedules the audit as <span className="font-medium text-gray-500">planned</span>. Conducting it (checklist responses, findings, auto-CAPA on critical fails) happens through the assessor cockpit’s governed flow.</p>
          </div>
        )}

        {tab === "capa" && (
          <div className="grid sm:grid-cols-2 gap-3">
            <div><label className={label}>Action title *</label><input value={form.title ?? ""} onChange={set("title")} className={input} placeholder="e.g. Retrain ward B on documentation standard" /></div>
            <div><label className={label}>Priority</label><select value={form.priority ?? "medium"} onChange={set("priority")} className={input}>{PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}</select></div>
            <div><label className={label}>Due date</label><input type="date" value={form.due_date ?? ""} onChange={set("due_date")} className={input} /></div>
            <div className="sm:col-span-2"><label className={label}>Description</label><textarea value={form.description ?? ""} onChange={set("description")} rows={2} className={input} /></div>
          </div>
        )}

        {tab === "advance" && (
          <div className="grid sm:grid-cols-2 gap-3">
            <div><label className={label}>Corrective action *</label><select value={form.capa_id ?? ""} onChange={set("capa_id")} className={input}><option value="">— Select open CAPA —</option>{openCapas.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select></div>
            <div><label className={label}>Advance to *</label><select value={form.status ?? ""} onChange={set("status")} className={input}><option value="">— Select status —</option>{Object.entries(CAPA_STATUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
            <div className="sm:col-span-2"><label className={label}>Evidence note</label><textarea value={form.evidence_note ?? ""} onChange={set("evidence_note")} rows={2} className={input} placeholder="What was done / how effectiveness was verified" /></div>
            {openCapas.length === 0 && <p className="sm:col-span-2 text-[11px] text-amber-600">No open corrective actions.</p>}
            <p className="sm:col-span-2 text-[11px] text-gray-400">The workflow is forward-only (open → in progress → completed → verified → closed); the server rejects backwards moves.</p>
          </div>
        )}

        <div className="flex items-center gap-2 mt-4">
          <button onClick={act} disabled={busy} className="text-sm font-semibold bg-teal-600 hover:bg-teal-700 text-white rounded-lg px-4 py-2 disabled:opacity-60">{busy ? "Working…" : TABS.find(t => t.key === tab)!.label}</button>
          <button onClick={() => setForm({})} className="text-sm text-gray-500 hover:text-gray-700 px-2">Clear</button>
          <span className="text-[11px] text-gray-400 ml-auto">Real assurance actions — audit-logged.</span>
        </div>
      </div>
    </div>
  );
}
