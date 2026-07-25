"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Education planning console (LDS-005). Create an education plan, add milestones / study-leave /
// sponsorship (quick prompts), decide pending approvals and update plan progress. Posts to
// /api/operations/education-plan. Manager-gated server-side.
/* eslint-disable @typescript-eslint/no-explicit-any */
const card = "bg-white rounded-xl border border-gray-200";
const input = "w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40";
const MODES = ["full_time", "part_time", "blended", "online", "distance"];
const tc = (s: string) => (s ?? "").replace(/_/g, " ").split(" ").filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(" ");

export default function EducationConsole({ staff, plans, pending }: { staff: any[]; plans: any[]; pending: any[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const toast = (kind: "ok" | "err", text: string) => { setMsg({ kind, text }); setTimeout(() => setMsg(null), 5000); };
  const [f, setF] = useState<any>({ user_id: "", programme_title: "", institution: "", study_mode: "part_time", start_date: "", expected_completion: "" });
  const set = (k: string, v: string) => setF((p: any) => ({ ...p, [k]: v }));

  async function post(body: any, ok: string) {
    setBusy(true);
    const r = await fetch("/api/operations/education-plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setBusy(false);
    if (r.ok) { toast("ok", ok); router.refresh(); return true; }
    const d = await r.json().catch(() => ({})); toast("err", d?.error || "Failed"); return false;
  }
  async function patch(id: string, kind: string, body: any, ok: string) {
    setBusy(true);
    const r = await fetch(`/api/operations/education-plan?id=${id}&kind=${kind}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setBusy(false);
    if (r.ok) { toast("ok", ok); router.refresh(); } else { const d = await r.json().catch(() => ({})); toast("err", d?.error || "Failed"); }
  }
  async function createPlan() {
    if (!f.user_id || !f.programme_title.trim()) { toast("err", "Staff and programme required"); return; }
    if (await post({ action: "create_plan", ...f }, "Education plan created")) setF({ user_id: "", programme_title: "", institution: "", study_mode: "part_time", start_date: "", expected_completion: "" });
  }
  const addMilestone = (plan_id: string) => { const name = window.prompt("Milestone name:"); if (!name) return; const planned_date = window.prompt("Planned date (YYYY-MM-DD, optional):") || null; post({ action: "add_milestone", plan_id, name, planned_date }, "Milestone added"); };
  const addLeave = (plan: any) => { const days = window.prompt(`Study-leave days for ${plan.name}:`); if (!days) return; post({ action: "study_leave", plan_id: plan.id, user_id: plan.user_id, leave_type: "study", days: Number(days) }, "Study leave requested"); };
  const addSponsor = (plan: any) => { const amount = window.prompt(`Sponsorship amount for ${plan.name}:`); if (!amount) return; post({ action: "sponsorship", plan_id: plan.id, user_id: plan.user_id, source: "employer", amount: Number(amount) }, "Sponsorship requested"); };
  const setProgress = (plan: any) => { const p = window.prompt("Progress %:", String(plan.progress ?? 0)); if (p == null) return; patch(plan.id, "plan", { progress_pct: Number(p) }, "Progress updated"); };

  return (
    <>
      {msg && <div className={`fixed bottom-4 right-4 z-50 text-sm rounded-lg px-4 py-2.5 shadow-lg ${msg.kind === "ok" ? "bg-emerald-600 text-white" : "bg-rose-600 text-white"}`}>{msg.text}</div>}

      <div className={`${card} p-5`}>
        <h3 className="font-semibold text-gray-900 text-sm mb-3">Create Education Plan</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          <label className="text-xs text-gray-500">Staff<select className={input} value={f.user_id} onChange={e => set("user_id", e.target.value)}><option value="">— select —</option>{staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
          <label className="text-xs text-gray-500">Programme<input className={input} placeholder="e.g. MSc Critical Care Nursing" value={f.programme_title} onChange={e => set("programme_title", e.target.value)} /></label>
          <label className="text-xs text-gray-500">Institution<input className={input} value={f.institution} onChange={e => set("institution", e.target.value)} /></label>
          <label className="text-xs text-gray-500">Study mode<select className={input} value={f.study_mode} onChange={e => set("study_mode", e.target.value)}>{MODES.map(m => <option key={m} value={m}>{tc(m)}</option>)}</select></label>
          <label className="text-xs text-gray-500">Start date<input type="date" className={input} value={f.start_date} onChange={e => set("start_date", e.target.value)} /></label>
          <label className="text-xs text-gray-500">Expected completion<input type="date" className={input} value={f.expected_completion} onChange={e => set("expected_completion", e.target.value)} /></label>
        </div>
        <div className="flex justify-end mt-3"><button onClick={createPlan} disabled={busy || !f.user_id || !f.programme_title.trim()} className="text-sm rounded-lg bg-emerald-600 text-white px-4 py-2 hover:bg-emerald-700 disabled:opacity-50">Create plan</button></div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className={`${card} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">Education Plans</h3>
          {plans.length === 0 ? <p className="text-sm text-gray-400">No education plans yet — create one above.</p> : (
            <div className="space-y-2">{plans.map((p: any) => (
              <div key={p.id} className="rounded-lg border border-gray-100 p-3">
                <div className="flex items-center justify-between gap-2"><div className="min-w-0"><p className="text-xs font-medium text-gray-800 truncate">{p.title}</p><p className="text-[10px] text-gray-400 truncate">{p.name}{p.institution ? ` · ${p.institution}` : ""}</p></div><span className="text-xs font-semibold text-gray-700 tabular-nums shrink-0">{p.progress}%</span></div>
                <div className="w-full h-1.5 rounded-full bg-gray-100 overflow-hidden mt-1.5"><div className="h-full bg-emerald-500" style={{ width: `${p.progress}%` }} /></div>
                <div className="flex flex-wrap items-center gap-2 mt-2 text-[11px]">
                  <button onClick={() => addMilestone(p.id)} className="text-emerald-700 hover:underline">+ Milestone</button>
                  <button onClick={() => addLeave(p)} className="text-emerald-700 hover:underline">+ Study leave</button>
                  <button onClick={() => addSponsor(p)} className="text-emerald-700 hover:underline">+ Sponsorship</button>
                  <button onClick={() => setProgress(p)} className="text-gray-500 hover:underline ml-auto">Set progress</button>
                </div>
              </div>
            ))}</div>
          )}
        </div>

        <div className={`${card} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">Pending Approvals</h3>
          {pending.length === 0 ? <p className="text-sm text-gray-400">Nothing awaiting approval.</p> : (
            <div className="space-y-2">{pending.map((a: any) => (
              <div key={a.id} className="flex items-center justify-between gap-2 py-1.5 border-b border-gray-50 text-xs">
                <div className="min-w-0"><p className="text-gray-800 truncate">{a.name} <span className="text-gray-400">· {a.kind}</span></p><p className="text-[10px] text-gray-400 truncate">{a.detail}</p></div>
                <div className="flex items-center gap-2 shrink-0">
                  <button disabled={busy} onClick={() => patch(a.id, a.type, { decision: "approve" }, "Approved")} className="text-emerald-700 font-medium hover:underline disabled:opacity-50">Approve</button>
                  <button disabled={busy} onClick={() => patch(a.id, a.type, { decision: "reject" }, "Rejected")} className="text-rose-700 font-medium hover:underline disabled:opacity-50">Reject</button>
                </div>
              </div>
            ))}</div>
          )}
        </div>
      </div>
    </>
  );
}
