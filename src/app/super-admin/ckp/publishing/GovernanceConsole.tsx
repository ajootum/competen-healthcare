"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Knowledge Publishing & Governance console (CKP-001.5) — real in-place
// governance actions. Four tabs, each wired to its live API:
//   Lifecycle → PATCH /api/content/lifecycle  {frameworkId, action}
//               (publish snapshots framework_versions; submit_review opens a
//                pending content_approvals row)
//   Review    → PATCH /api/content/review     {approvalId, decision, comment}
//               (decision enum is 'approve'/'reject'; separation of duties —
//                the submitter cannot decide their own approval)
//   KO Status → PATCH /api/knowledge-objects?id=…  {status}
//   Engine    → POST  /api/platform/approvals {workflow_key, entity_name}
//               (the generic approval engine; its decide enum is
//                'approved'/'rejected' — decided in the Platform Ops console)
// CPU pub_status is deliberately NOT exposed: its PATCH path is unvalidated and
// unaudited — a governance gap to harden before surfacing.
/* eslint-disable @typescript-eslint/no-explicit-any */

const input = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/40";
const label = "text-xs font-semibold text-gray-600 mb-1 block";

type Picker = { id: string; label: string };

const LIFECYCLE_ACTIONS: Record<string, string> = {
  submit_review: "Submit for review (→ in review)",
  publish: "Publish (snapshots a version)",
  archive: "Archive",
  revert: "Revert to draft",
};
const KO_STATUSES: Record<string, string> = { draft: "Draft", active: "Active (published)", retired: "Retired" };
// WORKFLOW_CATALOGUE keys (lib/platform/approvals.ts) — content-relevant first.
const WORKFLOWS: Record<string, string> = {
  framework_publication: "Framework Publication",
  competency_publication: "Competency Publication",
  assessment_publication: "Assessment Publication",
  knowledge_publication: "Knowledge Publication",
  ai_content_review: "AI Content Review",
};

const TABS = [
  { key: "lifecycle", label: "Lifecycle", icon: "🚦" },
  { key: "review", label: "Review", icon: "✅" },
  { key: "ko", label: "KO Status", icon: "🧠" },
  { key: "engine", label: "Engine", icon: "⚖️" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

export default function GovernanceConsole({ frameworks, knowledgeObjects, pendingReviews }: { frameworks: Picker[]; knowledgeObjects: Picker[]; pendingReviews: Picker[] }) {
  const router = useRouter();
  const [tab, setTab] = useState<TabKey>("lifecycle");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ k: "ok" | "err"; t: string } | null>(null);
  const [form, setForm] = useState<any>({});
  const set = (k: string) => (e: any) => setForm((f: any) => ({ ...f, [k]: e.target.value }));
  const toast = (k: "ok" | "err", t: string) => { setMsg({ k, t }); setTimeout(() => setMsg(null), 5000); };
  const switchTab = (k: TabKey) => { setTab(k); setForm({}); setMsg(null); };

  async function act() {
    let url = "", method = "PATCH", body: any = {}, missing = "", okText = "";
    if (tab === "lifecycle") {
      if (!form.frameworkId) missing = "framework";
      else if (!form.action) missing = "action";
      url = "/api/content/lifecycle";
      body = { frameworkId: form.frameworkId, action: form.action };
      okText = `Framework ${String(form.action ?? "").replace(/_/g, " ")} applied`;
    } else if (tab === "review") {
      if (!form.approvalId) missing = "pending review";
      else if (!form.decision) missing = "decision";
      else if (form.decision === "reject" && !String(form.comment ?? "").trim()) missing = "comment (required on reject)";
      url = "/api/content/review";
      body = { approvalId: form.approvalId, decision: form.decision, comment: String(form.comment ?? "").trim() || null }; // enum: approve | reject
      okText = `Review ${form.decision === "approve" ? "approved" : "rejected"}`;
    } else if (tab === "ko") {
      if (!form.koId) missing = "knowledge object";
      else if (!form.status) missing = "status";
      url = `/api/knowledge-objects?id=${encodeURIComponent(form.koId)}`;
      body = { status: form.status };
      okText = `Knowledge object set to ${form.status}`;
    } else {
      if (!form.workflow_key) missing = "workflow";
      else if (!String(form.entity_name ?? "").trim()) missing = "entity name";
      url = "/api/platform/approvals";
      method = "POST";
      body = { workflow_key: form.workflow_key, entity_name: form.entity_name };
      okText = "Approval request opened (decide in Platform Ops → Approvals)";
    }
    if (missing) { toast("err", `${missing} is required`); return; }

    setBusy(true);
    try {
      const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({} as any));
      if (r.ok) { toast(j.warning ? "err" : "ok", j.warning ?? okText); setForm({}); router.refresh(); }
      else toast("err", j.error ?? "Action failed");
    } catch { toast("err", "Network error — nothing was changed"); }
    finally { setBusy(false); }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200">
      <div className="flex items-center gap-2 p-3 border-b border-gray-100 flex-wrap">
        <h2 className="font-semibold text-gray-900 text-[15px] mr-auto">Governance Console</h2>
        {msg && <span className={`text-xs rounded-lg px-2.5 py-1 ${msg.k === "ok" ? "bg-green-50 text-green-800" : "bg-amber-50 text-amber-800"}`}>{msg.t}</span>}
        <div className="flex gap-1 flex-wrap">
          {TABS.map(b => (
            <button key={b.key} onClick={() => switchTab(b.key)} className={`text-xs font-medium rounded-lg px-2.5 py-1.5 border ${tab === b.key ? "bg-teal-50 border-teal-300 text-teal-700" : "border-gray-200 text-gray-500 hover:bg-gray-50"}`}>{b.icon} {b.label}</button>
          ))}
        </div>
      </div>

      <div className="p-5">
        {tab === "lifecycle" && (
          <div className="grid sm:grid-cols-2 gap-3">
            <div><label className={label}>Framework *</label><select value={form.frameworkId ?? ""} onChange={set("frameworkId")} className={input}><option value="">— Select framework —</option>{frameworks.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}</select></div>
            <div><label className={label}>Action *</label><select value={form.action ?? ""} onChange={set("action")} className={input}><option value="">— Select action —</option>{Object.entries(LIFECYCLE_ACTIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
            <p className="sm:col-span-2 text-[11px] text-gray-400">Canonical flow: draft → submit for review → approve (Review tab) → publish → archive. Publishing snapshots the full framework into version history; submitting opens a pending review below.</p>
          </div>
        )}

        {tab === "review" && (
          <div className="grid sm:grid-cols-2 gap-3">
            <div><label className={label}>Pending review *</label><select value={form.approvalId ?? ""} onChange={set("approvalId")} className={input}><option value="">— Select submission —</option>{pendingReviews.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}</select></div>
            <div><label className={label}>Decision *</label><select value={form.decision ?? ""} onChange={set("decision")} className={input}><option value="">— Select decision —</option><option value="approve">Approve (→ approved)</option><option value="reject">Reject (→ back to draft)</option></select></div>
            <div className="sm:col-span-2"><label className={label}>Comment{form.decision === "reject" ? " *" : ""}</label><textarea value={form.comment ?? ""} onChange={set("comment")} rows={2} className={input} placeholder="Review rationale — required when rejecting" /></div>
            {pendingReviews.length === 0 && <p className="sm:col-span-2 text-[11px] text-amber-600">No pending reviews — submit a framework for review in the Lifecycle tab first.</p>}
            <p className="sm:col-span-2 text-[11px] text-gray-400">Separation of duties applies: the submitter cannot decide their own review.</p>
          </div>
        )}

        {tab === "ko" && (
          <div className="grid sm:grid-cols-2 gap-3">
            <div><label className={label}>Knowledge object *</label><select value={form.koId ?? ""} onChange={set("koId")} className={input}><option value="">— Select object —</option>{knowledgeObjects.map(k => <option key={k.id} value={k.id}>{k.label}</option>)}</select></div>
            <div><label className={label}>New status *</label><select value={form.status ?? ""} onChange={set("status")} className={input}><option value="">— Select status —</option>{Object.entries(KO_STATUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
            <p className="sm:col-span-2 text-[11px] text-gray-400">Status changes are audit-logged (knowledge_draft / knowledge_active / knowledge_retired).</p>
          </div>
        )}

        {tab === "engine" && (
          <div className="grid sm:grid-cols-2 gap-3">
            <div><label className={label}>Workflow *</label><select value={form.workflow_key ?? ""} onChange={set("workflow_key")} className={input}><option value="">— Select workflow —</option>{Object.entries(WORKFLOWS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
            <div><label className={label}>Entity name *</label><input value={form.entity_name ?? ""} onChange={set("entity_name")} className={input} placeholder="e.g. Sepsis Bundle v2" /></div>
            <p className="sm:col-span-2 text-[11px] text-gray-400">Opens a governed approval request in the platform engine (with per-step decision audit). Decide it in Platform Ops → Approvals; engine approval is bookkeeping — content state still changes via the Lifecycle/Review tabs.</p>
          </div>
        )}

        <div className="flex items-center gap-2 mt-4">
          <button onClick={act} disabled={busy} className="text-sm font-semibold bg-teal-600 hover:bg-teal-700 text-white rounded-lg px-4 py-2 disabled:opacity-60">{busy ? "Applying…" : "Apply"}</button>
          <button onClick={() => setForm({})} className="text-sm text-gray-500 hover:text-gray-700 px-2">Clear</button>
          <span className="text-[11px] text-gray-400 ml-auto">Real governance actions via the live APIs — all audit-logged.</span>
        </div>
      </div>
    </div>
  );
}
