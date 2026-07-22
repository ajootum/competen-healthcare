"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Regulatory & Accreditation canvas (GOV-001.6) — real in-place readiness work:
//   Assess Standard → POST /api/governance/accreditation (insert-only history;
//                     latest wins; gap note REQUIRED when not fully met)
//   Add Action      → POST /api/quality/capa (accreditation action plans reuse
//                     the CAPA workflow — tracked in module 5's ageing view)
// Reference codes suggest from the EQOS catalogue per framework (datalist),
// but new codes can be typed — standards can be assessed before mapping.
/* eslint-disable @typescript-eslint/no-explicit-any */

const input = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/40";
const label = "text-xs font-semibold text-gray-600 mb-1 block";

const STATUSES: Record<string, string> = { met: "Met", partially_met: "Partially met", not_met: "Not met", not_assessed: "Not assessed" };
const PRIORITIES = ["low", "medium", "high"];

type Picker = { id: string; label: string };

const TABS = [
  { key: "assess", label: "Assess Standard", icon: "🧭" },
  { key: "action", label: "Add Action", icon: "🛠️" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

export default function AccreditationCenter({ frameworks, refsByFramework }: { frameworks: Picker[]; refsByFramework: Record<string, string[]> }) {
  const router = useRouter();
  const [tab, setTab] = useState<TabKey>("assess");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ k: "ok" | "err"; t: string } | null>(null);
  const [form, setForm] = useState<any>({});
  const set = (k: string) => (e: any) => setForm((f: any) => ({ ...f, [k]: e.target.value }));
  const toast = (k: "ok" | "err", t: string) => { setMsg({ k, t }); setTimeout(() => setMsg(null), 5000); };
  const switchTab = (k: TabKey) => { setTab(k); setForm({}); setMsg(null); };

  const knownRefs: string[] = form.framework_id ? (refsByFramework[form.framework_id] ?? []) : [];
  const needsGap = form.status === "not_met" || form.status === "partially_met";

  async function act() {
    let url = "", body: any = {}, missing = "", okText = "";
    if (tab === "assess") {
      if (!form.framework_id) missing = "framework";
      else if (!String(form.reference_code ?? "").trim()) missing = "reference code";
      else if (!form.status) missing = "status";
      else if (needsGap && !String(form.gap_note ?? "").trim()) missing = "gap note (required when not fully met)";
      url = "/api/governance/accreditation";
      body = { framework_id: form.framework_id, reference_code: form.reference_code, title: form.title || undefined, status: form.status, gap_note: form.gap_note || undefined, evidence_note: form.evidence_note || undefined };
      okText = `Standard assessed: ${String(form.reference_code ?? "").toUpperCase()} → ${STATUSES[form.status] ?? form.status}`;
    } else {
      if (!String(form.title ?? "").trim()) missing = "title";
      url = "/api/quality/capa";
      body = { title: form.title, description: `Accreditation action plan${form.description ? `: ${form.description}` : ""}`, priority: PRIORITIES.includes(form.priority) ? form.priority : "medium", due_date: form.due_date || undefined };
      okText = "Accreditation action recorded (tracked in the CAPA workflow)";
    }
    if (missing) { toast("err", `${missing} is required`); return; }

    setBusy(true);
    try {
      const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (r.ok) { toast("ok", okText); setForm({}); router.refresh(); }
      else toast("err", (await r.json().catch(() => ({}))).error ?? "Action failed");
    } catch { toast("err", "Network error — nothing was changed"); }
    finally { setBusy(false); }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200">
      <div className="flex items-center gap-2 p-3 border-b border-gray-100 flex-wrap">
        <h2 className="font-semibold text-gray-900 text-[15px] mr-auto">Accreditation Center</h2>
        {msg && <span className={`text-xs rounded-lg px-2.5 py-1 ${msg.k === "ok" ? "bg-green-50 text-green-800" : "bg-amber-50 text-amber-800"}`}>{msg.t}</span>}
        <div className="flex gap-1">
          {TABS.map(b => (
            <button key={b.key} onClick={() => switchTab(b.key)} className={`text-xs font-medium rounded-lg px-2.5 py-1.5 border ${tab === b.key ? "bg-teal-50 border-teal-300 text-teal-700" : "border-gray-200 text-gray-500 hover:bg-gray-50"}`}>{b.icon} {b.label}</button>
          ))}
        </div>
      </div>

      <div className="p-5">
        {tab === "assess" && (
          <div className="grid sm:grid-cols-2 gap-3">
            <div><label className={label}>Framework *</label><select value={form.framework_id ?? ""} onChange={set("framework_id")} className={input}><option value="">— Select framework —</option>{frameworks.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}</select></div>
            <div>
              <label className={label}>Reference code * <span className="font-normal text-gray-400">({knownRefs.length} known)</span></label>
              <input value={form.reference_code ?? ""} onChange={set("reference_code")} className={input} placeholder="e.g. IPSG.1" list="std-refs" />
              <datalist id="std-refs">{knownRefs.map(r => <option key={r} value={r} />)}</datalist>
            </div>
            <div><label className={label}>Status *</label><select value={form.status ?? ""} onChange={set("status")} className={input}><option value="">— Select status —</option>{Object.entries(STATUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
            <div><label className={label}>Standard title</label><input value={form.title ?? ""} onChange={set("title")} className={input} placeholder="Optional description of the standard" /></div>
            {needsGap && (
              <div className="sm:col-span-2"><label className={label}>Gap note *</label><textarea value={form.gap_note ?? ""} onChange={set("gap_note")} rows={2} className={input} placeholder="What is missing to fully meet this standard?" /></div>
            )}
            <div className="sm:col-span-2"><label className={label}>Evidence note</label><textarea value={form.evidence_note ?? ""} onChange={set("evidence_note")} rows={2} className={input} placeholder="Where the supporting evidence lives (documents, records, systems)" /></div>
            <p className="sm:col-span-2 text-[11px] text-gray-400">Assessments are insert-only history — re-assessing the same standard supersedes the previous status and builds a readiness trail.</p>
          </div>
        )}

        {tab === "action" && (
          <div className="grid sm:grid-cols-2 gap-3">
            <div><label className={label}>Action title *</label><input value={form.title ?? ""} onChange={set("title")} className={input} placeholder="e.g. Draft missing medication-safety SOP for MMU.4" /></div>
            <div><label className={label}>Priority</label><select value={form.priority ?? "medium"} onChange={set("priority")} className={input}>{PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}</select></div>
            <div><label className={label}>Due date</label><input type="date" value={form.due_date ?? ""} onChange={set("due_date")} className={input} /></div>
            <div className="sm:col-span-2"><label className={label}>Detail</label><textarea value={form.description ?? ""} onChange={set("description")} rows={2} className={input} /></div>
            <p className="sm:col-span-2 text-[11px] text-gray-400">Accreditation actions reuse the CAPA workflow — they appear in module 5’s open list, ageing buckets and closure tracking.</p>
          </div>
        )}

        <div className="flex items-center gap-2 mt-4">
          <button onClick={act} disabled={busy} className="text-sm font-semibold bg-teal-600 hover:bg-teal-700 text-white rounded-lg px-4 py-2 disabled:opacity-60">{busy ? "Working…" : TABS.find(t => t.key === tab)!.label}</button>
          <button onClick={() => setForm({})} className="text-sm text-gray-500 hover:text-gray-700 px-2">Clear</button>
          <span className="text-[11px] text-gray-400 ml-auto">Real readiness work — audit-logged.</span>
        </div>
      </div>
    </div>
  );
}
