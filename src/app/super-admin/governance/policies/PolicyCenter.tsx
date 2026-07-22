"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Policy & Standards Center canvas (GOV-001.2) — real in-place policy authoring.
// Two tabs wired to live APIs:
//   Create Policy        → POST /api/policies (isAdmin; super_admin without a
//                          hospital creates PLATFORM-WIDE policies, hospital_id
//                          bound server-side — never client-supplied)
//   Submit for Approval  → POST /api/platform/approvals with the
//                          policy_publication workflow (2 steps: technical
//                          review → governance approval; decide in Platform
//                          Ops → Approvals; per-step decisions are audited)
/* eslint-disable @typescript-eslint/no-explicit-any */

const input = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/40";
const label = "text-xs font-semibold text-gray-600 mb-1 block";

const POLICY_TYPES = ["clinical", "hr", "safety", "governance", "infection_control", "quality"];
type Picker = { id: string; label: string };

const TABS = [
  { key: "create", label: "Create Policy", icon: "📄" },
  { key: "approve", label: "Submit for Approval", icon: "🚦" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

export default function PolicyCenter({ frameworks, policies }: { frameworks: Picker[]; policies: Picker[] }) {
  const router = useRouter();
  const [tab, setTab] = useState<TabKey>("create");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ k: "ok" | "err"; t: string } | null>(null);
  const [form, setForm] = useState<any>({});
  const set = (k: string) => (e: any) => setForm((f: any) => ({ ...f, [k]: e.target.value }));
  const toast = (k: "ok" | "err", t: string) => { setMsg({ k, t }); setTimeout(() => setMsg(null), 5000); };
  const switchTab = (k: TabKey) => { setTab(k); setForm({}); setMsg(null); };

  async function act() {
    let url = "", body: any = {}, missing = "", okText = "";
    if (tab === "create") {
      if (!String(form.title ?? "").trim()) missing = "title";
      url = "/api/policies";
      body = {
        title: form.title, policy_type: form.policy_type || "governance", version: form.version || "1.0",
        content: form.content || undefined, effective_date: form.effective_date || undefined,
        review_date: form.review_date || undefined, framework_id: form.framework_id || undefined,
      };
      okText = "Policy created";
    } else {
      if (!form.policy_id) missing = "policy";
      url = "/api/platform/approvals";
      const chosen = policies.find(p => p.id === form.policy_id);
      body = { workflow_key: "policy_publication", entity_id: form.policy_id, entity_name: chosen?.label ?? "Policy" };
      okText = "Approval request opened (decide in Platform Ops → Approvals)";
    }
    if (missing) { toast("err", `${missing} is required`); return; }

    setBusy(true);
    try {
      const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (r.ok) { toast("ok", okText); setForm({}); router.refresh(); }
      else toast("err", (await r.json().catch(() => ({}))).error ?? "Action failed");
    } catch { toast("err", "Network error — nothing was created"); }
    finally { setBusy(false); }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200">
      <div className="flex items-center gap-2 p-3 border-b border-gray-100 flex-wrap">
        <h2 className="font-semibold text-gray-900 text-[15px] mr-auto">Policy Center</h2>
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
            <div><label className={label}>Title *</label><input value={form.title ?? ""} onChange={set("title")} className={input} placeholder="e.g. Data Protection Policy" /></div>
            <div><label className={label}>Policy type</label><select value={form.policy_type ?? "governance"} onChange={set("policy_type")} className={input}>{POLICY_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}</select></div>
            <div><label className={label}>Version</label><input value={form.version ?? ""} onChange={set("version")} className={input} placeholder="1.0" /></div>
            <div><label className={label}>Linked competency framework</label><select value={form.framework_id ?? ""} onChange={set("framework_id")} className={input}><option value="">— None —</option>{frameworks.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}</select></div>
            <div><label className={label}>Effective date</label><input type="date" value={form.effective_date ?? ""} onChange={set("effective_date")} className={input} /></div>
            <div><label className={label}>Review date</label><input type="date" value={form.review_date ?? ""} onChange={set("review_date")} className={input} /></div>
            <div className="sm:col-span-2"><label className={label}>Content</label><textarea value={form.content ?? ""} onChange={set("content")} rows={4} className={input} placeholder="Policy body (markdown supported)" /></div>
            <p className="sm:col-span-2 text-[11px] text-gray-400">Created by a platform super admin → the policy is <span className="font-medium text-gray-500">platform-wide</span> (tenant scope is bound server-side, never client-supplied).</p>
          </div>
        )}

        {tab === "approve" && (
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2"><label className={label}>Policy *</label><select value={form.policy_id ?? ""} onChange={set("policy_id")} className={input}><option value="">— Select policy —</option>{policies.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}</select></div>
            {policies.length === 0 && <p className="sm:col-span-2 text-[11px] text-amber-600">No active policies yet — create one first.</p>}
            <p className="sm:col-span-2 text-[11px] text-gray-400">Opens a governed 2-step approval (technical review → governance approval) in the platform engine, with per-step decision audit. Decide it in Platform Ops → Approvals.</p>
          </div>
        )}

        <div className="flex items-center gap-2 mt-4">
          <button onClick={act} disabled={busy} className="text-sm font-semibold bg-teal-600 hover:bg-teal-700 text-white rounded-lg px-4 py-2 disabled:opacity-60">{busy ? "Working…" : tab === "create" ? "Create policy" : "Submit for approval"}</button>
          <button onClick={() => setForm({})} className="text-sm text-gray-500 hover:text-gray-700 px-2">Clear</button>
          <span className="text-[11px] text-gray-400 ml-auto">Real policy actions via the live APIs.</span>
        </div>
      </div>
    </div>
  );
}
