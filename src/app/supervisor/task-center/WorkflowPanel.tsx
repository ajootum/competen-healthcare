"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RECURRENCES, RECURRENCE_LABEL, TRIGGERS, TRIGGER_LABEL, PRIORITIES } from "@/lib/operations/task-templates";

// Workflow & Automation (SSW-TSK-001) — reusable task templates. Create a template
// with recurrence/trigger config, then generate a real task from it on demand
// (which posts through the audited tasks API). Recurrence auto-firing and
// event-driven auto-generation are configured here; scheduled execution is a
// later phase. Writes through the audited templates API.
/* eslint-disable @typescript-eslint/no-explicit-any */

const PRIO_TONE: Record<string, string> = { urgent: "bg-rose-50 text-rose-700", high: "bg-orange-50 text-orange-700", normal: "bg-amber-50 text-amber-700", low: "bg-blue-50 text-blue-600" };

export default function WorkflowPanel({ provisioned, templates, editable }: { provisioned: boolean; templates: any[]; editable: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<Record<string, string>>({ name: "", task_type: "", priority: "normal", recurrence: "none", trigger_event: "manual", due_offset_min: "60", description: "" });

  if (!provisioned) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-5" id="workflow">
        <h2 className="text-sm font-bold text-gray-900">Workflow &amp; Automation</h2>
        <div className="mt-3 rounded-lg border border-dashed border-gray-200 bg-gray-50/60 p-4 text-center">
          <p className="text-sm text-gray-500">Task templates not provisioned</p>
          <p className="text-[11px] text-gray-400 mt-1">Run migration <span className="font-mono">070-task-templates</span> to enable workflow templates &amp; automation.</p>
        </div>
      </div>
    );
  }

  const sel = "text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white";
  async function create() {
    if (!f.name.trim()) return;
    setBusy("create"); setErr(null);
    try {
      const res = await fetch(`/api/operations/task-templates`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...f, due_offset_min: Number(f.due_offset_min) || 60 }) });
      if (!res.ok) { const j = await res.json().catch(() => ({})); setErr(j.error ?? "Create failed"); return; }
      setF({ name: "", task_type: "", priority: "normal", recurrence: "none", trigger_event: "manual", due_offset_min: "60", description: "" }); setOpen(false); router.refresh();
    } catch { setErr("Network error"); } finally { setBusy(null); }
  }
  async function generate(t: any) {
    setBusy(t.id); setErr(null);
    try {
      const due = new Date(Date.now() + (t.due_offset_min ?? 60) * 60000).toISOString();
      const res = await fetch(`/api/operations/tasks`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ description: t.description || t.name, task_type: t.task_type || t.name, priority: t.priority, due_at: due }) });
      if (!res.ok) { const j = await res.json().catch(() => ({})); setErr(j.error ?? "Generate failed"); return; }
      router.refresh();
    } catch { setErr("Network error"); } finally { setBusy(null); }
  }
  async function remove(id: string) {
    setBusy(id); setErr(null);
    try {
      const res = await fetch(`/api/operations/task-templates?id=${id}`, { method: "DELETE" });
      if (!res.ok) { const j = await res.json().catch(() => ({})); setErr(j.error ?? "Remove failed"); return; }
      router.refresh();
    } catch { setErr("Network error"); } finally { setBusy(null); }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5" id="workflow">
      <div className="flex items-center justify-between mb-3">
        <div><h2 className="text-sm font-bold text-gray-900">Workflow &amp; Automation</h2><p className="text-[10px] text-gray-500">Reusable task templates · recurrence &amp; event triggers</p></div>
        {editable && <button onClick={() => setOpen(o => !o)} className="text-xs font-semibold text-teal-700 hover:underline shrink-0">{open ? "Cancel" : "+ New template"}</button>}
      </div>

      {open && editable && (
        <div className="mb-3 rounded-lg border border-gray-100 bg-gray-50/50 p-3 space-y-2">
          <div className="flex flex-wrap gap-2">
            <input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} placeholder="Template name *" className={`${sel} flex-1 min-w-[160px]`} />
            <input value={f.task_type} onChange={e => setF({ ...f, task_type: e.target.value })} placeholder="Task type" className={`${sel} w-32`} />
          </div>
          <div className="flex flex-wrap gap-2">
            <select value={f.priority} onChange={e => setF({ ...f, priority: e.target.value })} className={sel}>{PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}</select>
            <select value={f.recurrence} onChange={e => setF({ ...f, recurrence: e.target.value })} className={sel}>{RECURRENCES.map(r => <option key={r} value={r}>{RECURRENCE_LABEL[r]}</option>)}</select>
            <select value={f.trigger_event} onChange={e => setF({ ...f, trigger_event: e.target.value })} className={sel}>{TRIGGERS.map(t => <option key={t} value={t}>{TRIGGER_LABEL[t]}</option>)}</select>
            <input type="number" min={0} value={f.due_offset_min} onChange={e => setF({ ...f, due_offset_min: e.target.value })} className={`${sel} w-20`} title="due offset (min)" />
          </div>
          <input value={f.description} onChange={e => setF({ ...f, description: e.target.value })} placeholder="Description (optional)" className={`${sel} w-full`} />
          <button onClick={create} disabled={!f.name.trim() || busy === "create"} className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50">{busy === "create" ? "…" : "Create template"}</button>
        </div>
      )}

      <div className="space-y-1.5">
        {templates.length === 0 ? <p className="text-xs text-gray-400 py-3 text-center">No templates yet — create one to standardise recurring shift tasks.</p> : templates.map((t: any) => (
          <div key={t.id} className="flex items-center gap-2 rounded-lg border border-gray-100 px-2.5 py-1.5">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-medium text-gray-800 truncate">{t.name}</span>
                <span className={`text-[8px] font-semibold px-1 py-0.5 rounded ${PRIO_TONE[t.priority] ?? "bg-gray-100 text-gray-600"}`}>{t.priority}</span>
              </div>
              <p className="text-[10px] text-gray-400 truncate">{RECURRENCE_LABEL[t.recurrence]}{t.trigger_event !== "manual" ? ` · ${TRIGGER_LABEL[t.trigger_event]}` : ""} · due +{t.due_offset_min}m</p>
            </div>
            {editable && <button onClick={() => generate(t)} disabled={busy === t.id} className="text-[10px] font-semibold text-teal-700 hover:underline shrink-0">{busy === t.id ? "…" : "Generate task"}</button>}
            {editable && <button onClick={() => remove(t.id)} disabled={busy === t.id} className="text-[10px] text-gray-400 hover:text-rose-600 shrink-0">✕</button>}
          </div>
        ))}
      </div>
      <p className="text-[10px] text-gray-400 mt-2">Templates instantiate real tasks now. Recurrence auto-firing &amp; event-driven auto-generation are configured here; scheduled execution is a later phase.</p>
      {err && <p className="text-[11px] text-rose-600 mt-2">{err}</p>}
    </div>
  );
}
