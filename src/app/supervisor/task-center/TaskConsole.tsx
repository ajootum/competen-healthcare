"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Task Center console (SSW-001) — real task coordination via /api/operations/
// tasks. Create Task assigns to a staff member (POST → status 'assigned',
// notifies the assignee); Update Status advances the lifecycle (PATCH, legal
// transitions enforced server-side; 'verified' is separation-of-duties — a
// coordinator who did not perform the task). All audit-logged.
/* eslint-disable @typescript-eslint/no-explicit-any */

const input = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/40";
const label = "text-xs font-semibold text-gray-600 mb-1 block";

const PRIORITIES: Record<string, string> = { urgent: "Critical", high: "High", normal: "Medium", low: "Low" };
const STATUSES: Record<string, string> = { accepted: "Accepted", in_progress: "In progress", completed: "Completed", verified: "Verified (coordinator sign-off)", cancelled: "Cancelled" };

type Picker = { id: string; label: string };

const TABS = [
  { key: "create", label: "Create Task", icon: "➕" },
  { key: "status", label: "Update Status", icon: "🔄" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

export default function TaskConsole({ staff, openTasks, presetTask, presetStaff }: { staff: Picker[]; openTasks: Picker[]; presetTask?: { desc: string; staffId: string | null } | null; presetStaff?: string | null }) {
  const router = useRouter();
  const [tab, setTab] = useState<TabKey>("create");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ k: "ok" | "err"; t: string } | null>(null);
  const [form, setForm] = useState<any>(presetTask ? { description: presetTask.desc, assigned_to: presetTask.staffId ?? "" } : {});
  const set = (k: string) => (e: any) => setForm((f: any) => ({ ...f, [k]: e.target.value }));
  const toast = (k: "ok" | "err", t: string) => { setMsg({ k, t }); setTimeout(() => setMsg(null), 5000); };
  const switchTab = (k: TabKey) => { setTab(k); setForm({}); setMsg(null); };

  async function act() {
    let url = "", method = "POST", body: any = {}, missing = "", okText = "";
    if (tab === "create") {
      if (!String(form.description ?? "").trim()) missing = "description";
      url = "/api/operations/tasks";
      body = { description: form.description, task_type: form.task_type || "general", priority: form.priority || "normal", assigned_to: form.assigned_to || undefined, due_at: form.due_at ? new Date(form.due_at).toISOString() : undefined };
      okText = "Task created" + (form.assigned_to ? " and assigned" : "");
    } else {
      if (!form.task_id) missing = "task";
      else if (!form.status) missing = "status";
      url = `/api/operations/tasks?id=${encodeURIComponent(form.task_id)}`;
      method = "PATCH";
      body = { status: form.status };
      okText = `Task → ${STATUSES[form.status] ?? form.status}`;
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
        <h2 className="font-semibold text-gray-900 text-[15px] mr-auto">Task Console</h2>
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
            <div className="sm:col-span-2"><label className={label}>Description *</label><input value={form.description ?? ""} onChange={set("description")} className={input} placeholder="e.g. Vital signs — Bed 5" /></div>
            <div><label className={label}>Task type</label><input value={form.task_type ?? ""} onChange={set("task_type")} className={input} placeholder="e.g. medication_round" /></div>
            <div><label className={label}>Priority</label><select value={form.priority ?? "normal"} onChange={set("priority")} className={input}>{Object.entries(PRIORITIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
            <div><label className={label}>Assign to</label><select value={form.assigned_to ?? ""} onChange={set("assigned_to")} className={input}><option value="">— Unassigned (self) —</option>{staff.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}</select></div>
            <div><label className={label}>Due</label><input type="datetime-local" value={form.due_at ?? ""} onChange={set("due_at")} className={input} /></div>
          </div>
        )}

        {tab === "status" && (
          <div className="grid sm:grid-cols-2 gap-3">
            <div><label className={label}>Task *</label><select value={form.task_id ?? ""} onChange={set("task_id")} className={input}><option value="">— Select task —</option>{openTasks.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}</select></div>
            <div><label className={label}>New status *</label><select value={form.status ?? ""} onChange={set("status")} className={input}><option value="">— Select status —</option>{Object.entries(STATUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
            {openTasks.length === 0 && <p className="sm:col-span-2 text-[11px] text-amber-600">No open tasks.</p>}
            <p className="sm:col-span-2 text-[11px] text-gray-400">Only legal transitions are accepted (e.g. you can't skip straight to verified). Verifying requires a coordinator who did not perform the task.</p>
          </div>
        )}

        <div className="flex items-center gap-2 mt-4">
          <button onClick={act} disabled={busy} className="text-sm font-semibold bg-teal-600 hover:bg-teal-700 text-white rounded-lg px-4 py-2 disabled:opacity-60">{busy ? "Working…" : TABS.find(t => t.key === tab)!.label}</button>
          <button onClick={() => setForm({})} className="text-sm text-gray-500 hover:text-gray-700 px-2">Clear</button>
          <span className="text-[11px] text-gray-400 ml-auto">Real task coordination — audit-logged.</span>
        </div>
      </div>
    </div>
  );
}
