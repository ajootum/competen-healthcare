"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Compliance Management canvas (GOV-001.3) — real in-place register actions.
//   New Obligation  → POST  /api/governance/obligations (isAdmin; platform
//                     super admins create PLATFORM-WIDE obligations)
//   Update Status   → PATCH /api/governance/obligations?id=… (compliant /
//                     at_risk / non_compliant / not_assessed / waived —
//                     waiving requires a justification, per the spec's
//                     exception & waiver management)
// Both audit-logged server-side; 409 with a migration hint until 059 runs.
/* eslint-disable @typescript-eslint/no-explicit-any */

const input = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/40";
const label = "text-xs font-semibold text-gray-600 mb-1 block";

const DOMAINS: Record<string, string> = { regulatory: "Regulatory", clinical: "Clinical", workforce: "Workforce", licence: "Licence", training: "Training", competency: "Competency", data_privacy: "Data Privacy", cybersecurity: "Cybersecurity", financial: "Financial", contractual: "Contractual", documentation: "Documentation", ai: "AI" };
const FREQUENCIES: Record<string, string> = { monthly: "Monthly", quarterly: "Quarterly", biannual: "Bi-annual", annual: "Annual", once: "Once" };
const RATINGS: Record<string, string> = { low: "Low", medium: "Medium", high: "High", critical: "Critical" };
const STATUSES: Record<string, string> = { compliant: "Compliant", at_risk: "At risk", non_compliant: "Non-compliant", not_assessed: "Not assessed", waived: "Waived (exception)" };

type Picker = { id: string; label: string };

const TABS = [
  { key: "create", label: "New Obligation", icon: "📋" },
  { key: "status", label: "Update Status", icon: "✅" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

export default function ComplianceCenter({ frameworks, obligations }: { frameworks: Picker[]; obligations: Picker[] }) {
  const router = useRouter();
  const [tab, setTab] = useState<TabKey>("create");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ k: "ok" | "err"; t: string } | null>(null);
  const [form, setForm] = useState<any>({});
  const set = (k: string) => (e: any) => setForm((f: any) => ({ ...f, [k]: e.target.value }));
  const toast = (k: "ok" | "err", t: string) => { setMsg({ k, t }); setTimeout(() => setMsg(null), 5000); };
  const switchTab = (k: TabKey) => { setTab(k); setForm({}); setMsg(null); };

  async function act() {
    let url = "", method = "POST", body: any = {}, missing = "", okText = "";
    if (tab === "create") {
      if (!String(form.title ?? "").trim()) missing = "title";
      url = "/api/governance/obligations";
      body = {
        title: form.title, source_authority: form.source_authority || undefined, framework_id: form.framework_id || undefined,
        domain: form.domain || "regulatory", review_frequency: form.review_frequency || "annual",
        risk_rating: form.risk_rating || "medium", evidence_required: form.evidence_required || undefined,
        effective_date: form.effective_date || undefined, expiry_date: form.expiry_date || undefined, note: form.note || undefined,
      };
      okText = "Obligation registered";
    } else {
      if (!form.obligation_id) missing = "obligation";
      else if (!form.status) missing = "status";
      else if (form.status === "waived" && !String(form.waiver_note ?? "").trim()) missing = "waiver justification";
      url = `/api/governance/obligations?id=${encodeURIComponent(form.obligation_id)}`;
      method = "PATCH";
      body = { status: form.status, note: form.note || undefined, waiver_note: form.waiver_note || undefined };
      okText = `Obligation marked ${String(form.status ?? "").replace(/_/g, " ")}`;
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
        <h2 className="font-semibold text-gray-900 text-[15px] mr-auto">Compliance Center</h2>
        {msg && <span className={`text-xs rounded-lg px-2.5 py-1 ${msg.k === "ok" ? "bg-green-50 text-green-800" : "bg-amber-50 text-amber-800"}`}>{msg.t}</span>}
        <div className="flex gap-1">
          {TABS.map(b => (
            <button key={b.key} onClick={() => switchTab(b.key)} className={`text-xs font-medium rounded-lg px-2.5 py-1.5 border ${tab === b.key ? "bg-teal-50 border-teal-300 text-teal-700" : "border-gray-200 text-gray-500 hover:bg-gray-50"}`}>{b.icon} {b.label}</button>
          ))}
        </div>
      </div>

      <div className="p-5">
        {tab === "create" && (
          <div className="grid sm:grid-cols-2 gap-3">
            <div><label className={label}>Requirement title *</label><input value={form.title ?? ""} onChange={set("title")} className={input} placeholder="e.g. Annual fire-safety inspection" /></div>
            <div><label className={label}>Source authority</label><input value={form.source_authority ?? ""} onChange={set("source_authority")} className={input} placeholder="e.g. Ministry of Health" /></div>
            <div><label className={label}>Domain</label><select value={form.domain ?? "regulatory"} onChange={set("domain")} className={input}>{Object.entries(DOMAINS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
            <div><label className={label}>Framework</label><select value={form.framework_id ?? ""} onChange={set("framework_id")} className={input}><option value="">— None —</option>{frameworks.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}</select></div>
            <div><label className={label}>Risk rating</label><select value={form.risk_rating ?? "medium"} onChange={set("risk_rating")} className={input}>{Object.entries(RATINGS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
            <div><label className={label}>Review frequency</label><select value={form.review_frequency ?? "annual"} onChange={set("review_frequency")} className={input}>{Object.entries(FREQUENCIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
            <div><label className={label}>Effective date</label><input type="date" value={form.effective_date ?? ""} onChange={set("effective_date")} className={input} /></div>
            <div><label className={label}>Expiry / renewal date</label><input type="date" value={form.expiry_date ?? ""} onChange={set("expiry_date")} className={input} /></div>
            <div className="sm:col-span-2"><label className={label}>Evidence required</label><input value={form.evidence_required ?? ""} onChange={set("evidence_required")} className={input} placeholder="e.g. Inspection certificate, training records" /></div>
            <p className="sm:col-span-2 text-[11px] text-gray-400">Registered by a platform super admin → the obligation is <span className="font-medium text-gray-500">platform-wide</span> (tenant scope bound server-side). Starts as “not assessed”.</p>
          </div>
        )}

        {tab === "status" && (
          <div className="grid sm:grid-cols-2 gap-3">
            <div><label className={label}>Obligation *</label><select value={form.obligation_id ?? ""} onChange={set("obligation_id")} className={input}><option value="">— Select obligation —</option>{obligations.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}</select></div>
            <div><label className={label}>New status *</label><select value={form.status ?? ""} onChange={set("status")} className={input}><option value="">— Select status —</option>{Object.entries(STATUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
            {form.status === "waived" && (
              <div className="sm:col-span-2"><label className={label}>Waiver justification *</label><textarea value={form.waiver_note ?? ""} onChange={set("waiver_note")} rows={2} className={input} placeholder="Why is this obligation waived, until when, and what compensating control applies?" /></div>
            )}
            <div className="sm:col-span-2"><label className={label}>Note</label><textarea value={form.note ?? ""} onChange={set("note")} rows={2} className={input} /></div>
            {obligations.length === 0 && <p className="sm:col-span-2 text-[11px] text-amber-600">No obligations registered yet — create one first.</p>}
          </div>
        )}

        <div className="flex items-center gap-2 mt-4">
          <button onClick={act} disabled={busy} className="text-sm font-semibold bg-teal-600 hover:bg-teal-700 text-white rounded-lg px-4 py-2 disabled:opacity-60">{busy ? "Working…" : tab === "create" ? "Register obligation" : "Update status"}</button>
          <button onClick={() => setForm({})} className="text-sm text-gray-500 hover:text-gray-700 px-2">Clear</button>
          <span className="text-[11px] text-gray-400 ml-auto">Real register actions — audit-logged.</span>
        </div>
      </div>
    </div>
  );
}
