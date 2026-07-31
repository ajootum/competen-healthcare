"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { REVIEW_LABEL, RISK_TONE } from "@/lib/config/governance";
import { cardClass } from "@/components/ui/primitives";

// WCE-004 governance console — create change requests (risk + reviews auto-derived from the registry on the
// server) and drive the lifecycle (submit → review → approve → publish → verify → rollback). Separation of
// duties and review-completeness are enforced server-side; this is the operational surface.
/* eslint-disable @typescript-eslint/no-explicit-any */
const SCOPES = ["platform", "enterprise", "tenant", "hospital", "unit", "role"];
const TYPES = ["standard", "normal", "major", "emergency", "security", "clinical_safety", "ai", "template", "rollback", "deprecation"];
const statusTone = (s: string) => (["published", "verified", "closed"].includes(s) ? "bg-emerald-50 text-emerald-700" : ["rejected", "cancelled", "rolled_back", "failed"].includes(s) ? "bg-gray-100 text-gray-500" : s === "approved" ? "bg-sky-50 text-sky-700" : "bg-amber-50 text-amber-700");

export default function GovernanceConsole({ list, objectKeys }: { list: any[]; objectKeys: { key: string; name: string }[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const [f, setF] = useState<any>({ title: "", description: "", business_reason: "", scope_type: "platform", change_type: "normal", affected: "", rollback_plan: "" });
  const set = (k: string, v: string) => setF((p: any) => ({ ...p, [k]: v }));
  const toast = (kind: "ok" | "err", text: string) => { setMsg({ kind, text }); setTimeout(() => setMsg(null), 5000); };

  async function post(body: any, ok: string) {
    setBusy(true);
    const r = await fetch("/api/governance/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (r.ok) { toast("ok", ok); router.refresh(); return true; }
    toast("err", d?.error || "Failed"); return false;
  }
  async function create() {
    if (!f.title.trim()) { toast("err", "Title required"); return; }
    const affected = f.affected.split(/[\n,]/).map((s: string) => s.trim()).filter(Boolean);
    if (await post({ action: "create", title: f.title, description: f.description, business_reason: f.business_reason, scope_type: f.scope_type, change_type: f.change_type, affected_objects: affected, rollback_plan: f.rollback_plan, emergency_justification: f.change_type === "emergency" ? f.business_reason : undefined }, "Change request created")) {
      setF({ title: "", description: "", business_reason: "", scope_type: "platform", change_type: "normal", affected: "", rollback_plan: "" }); setOpen(false);
    }
  }
  const act = (id: string, action: string, label: string) => post({ action, id }, label);
  const review = (id: string) => { const rt = window.prompt("Review type (product / technical / clinical_safety / security / data_governance / ai_governance / tenant_approval / enterprise_approval / release_manager):"); if (!rt) return; const dec = window.prompt("Decision (approve / approve_conditions / request_changes / reject):", "approve"); if (!dec) return; const findings = window.prompt("Findings (optional):") || undefined; post({ action: "review", id, review_type: rt.trim(), decision: dec.trim(), findings }, "Review recorded"); };

  return (
    <div className={cardClass}>
      {msg && <div className={`fixed bottom-4 right-4 z-50 text-sm rounded-lg px-4 py-2.5 shadow-lg ${msg.kind === "ok" ? "bg-emerald-600 text-white" : "bg-rose-600 text-white"}`}>{msg.text}</div>}
      <div className="flex items-center justify-between mb-3"><h2 className="text-sm font-bold text-gray-900">Change Requests</h2><button onClick={() => setOpen(o => !o)} className="text-xs bg-teal-600 text-white rounded-lg px-3 py-1.5 hover:bg-teal-700 font-medium">{open ? "Close" : "+ New Change Request"}</button></div>

      {open && (
        <div className="rounded-lg border border-gray-100 p-4 mb-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="text-xs text-gray-500">Title<input className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm mt-0.5" value={f.title} onChange={e => set("title", e.target.value)} placeholder="e.g. Enable CAPA trend widget" /></label>
            <label className="text-xs text-gray-500">Business reason<input className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm mt-0.5" value={f.business_reason} onChange={e => set("business_reason", e.target.value)} /></label>
            <label className="text-xs text-gray-500">Scope<select className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm mt-0.5" value={f.scope_type} onChange={e => set("scope_type", e.target.value)}>{SCOPES.map(s => <option key={s} value={s}>{s}</option>)}</select></label>
            <label className="text-xs text-gray-500">Change type<select className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm mt-0.5" value={f.change_type} onChange={e => set("change_type", e.target.value)}>{TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}</select></label>
          </div>
          <label className="text-xs text-gray-500 block">Affected registry objects <span className="text-gray-300">(object keys, comma or newline separated — risk &amp; reviews derive from these)</span>
            <input className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm mt-0.5 font-mono text-[11px]" value={f.affected} onChange={e => set("affected", e.target.value)} placeholder="workspace.unit-manager.quality" list="reg-keys" />
          </label>
          <datalist id="reg-keys">{objectKeys.slice(0, 500).map(o => <option key={o.key} value={o.key}>{o.name}</option>)}</datalist>
          <div className="flex justify-end"><button onClick={create} disabled={busy || !f.title.trim()} className="text-sm bg-teal-600 text-white rounded-lg px-4 py-2 hover:bg-teal-700 disabled:opacity-50">Create (auto-classify risk)</button></div>
        </div>
      )}

      {list.length === 0 ? <p className="text-sm text-gray-400 py-8 text-center">No change requests yet. Every governed configuration change starts here.</p> : (
        <div className="space-y-1.5">{list.map((c: any) => (
          <div key={c.id} className="rounded-lg border border-gray-100">
            <button onClick={() => setSel(sel === c.id ? null : c.id)} className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50">
              <span className="text-[10px] font-mono text-gray-400 shrink-0">{c.cr_ref}</span>
              <span className="text-xs font-medium text-gray-800 truncate flex-1">{c.title}</span>
              <span className={`text-[9px] font-semibold rounded px-1.5 py-0.5 shrink-0 ${RISK_TONE[c.risk_level]}`}>{c.risk_level}</span>
              <span className="text-[9px] text-gray-400 shrink-0">{c.reviewsDone}/{c.reviewsTotal} reviews</span>
              <span className={`text-[9px] font-semibold rounded px-1.5 py-0.5 shrink-0 ${statusTone(c.status)}`}>{c.status.replace(/_/g, " ")}</span>
            </button>
            {sel === c.id && (
              <div className="px-3 pb-3 pt-1 border-t border-gray-50">
                <div className="flex flex-wrap gap-2 text-[10px] text-gray-500 mb-2">
                  <span>Scope: <b className="text-gray-700">{c.scope_type}</b></span><span>Type: <b className="text-gray-700">{c.change_type}</b></span><span>Risk score: <b className="text-gray-700">{c.risk_score}</b></span>
                  <span>Reviews: <b className="text-gray-700">{(c.required_reviews ?? []).map((r: string) => REVIEW_LABEL[r] ?? r).join(", ") || "—"}</b></span>
                  {(c.affected_objects ?? []).length > 0 && <span>Affects: <b className="font-mono text-gray-600">{(c.affected_objects ?? []).join(", ")}</b></span>}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {c.status === "draft" && <Btn onClick={() => act(c.id, "submit", "Submitted")} disabled={busy}>Submit</Btn>}
                  {["submitted", "under_review", "changes_requested"].includes(c.status) && <><Btn onClick={() => review(c.id)} disabled={busy}>Record review</Btn><Btn onClick={() => act(c.id, "approve", "Approved")} disabled={busy} tone="sky">Approve</Btn></>}
                  {c.status === "approved" && <Btn onClick={() => act(c.id, "publish", "Published")} disabled={busy} tone="emerald">Publish</Btn>}
                  {c.change_type === "emergency" && c.status === "draft" && <Btn onClick={() => act(c.id, "publish", "Emergency published")} disabled={busy} tone="rose">Emergency publish</Btn>}
                  {c.status === "published" && <Btn onClick={() => act(c.id, "verify", "Verified")} disabled={busy} tone="emerald">Verify</Btn>}
                  {["published", "verified"].includes(c.status) && <Btn onClick={() => act(c.id, "rollback", "Rolled back")} disabled={busy} tone="amber">Rollback</Btn>}
                  {!["published", "verified", "closed", "cancelled", "rejected", "rolled_back"].includes(c.status) && <Btn onClick={() => act(c.id, "cancel", "Cancelled")} disabled={busy} tone="gray">Cancel</Btn>}
                </div>
              </div>
            )}
          </div>
        ))}</div>
      )}
    </div>
  );
}

function Btn({ children, onClick, disabled, tone }: { children: any; onClick: () => void; disabled?: boolean; tone?: string }) {
  const t = tone === "emerald" ? "bg-emerald-600 hover:bg-emerald-700" : tone === "sky" ? "bg-sky-600 hover:bg-sky-700" : tone === "rose" ? "bg-rose-600 hover:bg-rose-700" : tone === "amber" ? "bg-amber-500 hover:bg-amber-600" : tone === "gray" ? "bg-gray-400 hover:bg-gray-500" : "bg-gray-700 hover:bg-gray-800";
  return <button onClick={onClick} disabled={disabled} className={`text-[11px] text-white rounded-lg px-2.5 py-1 disabled:opacity-50 ${t}`}>{children}</button>;
}
