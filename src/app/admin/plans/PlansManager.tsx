"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { PROGRAMME_TYPE_LABELS, SCHEDULING_LABELS } from "@/lib/ckcm";

type Plan = {
  id: string; name: string; programme_type: string; scheduling_rule: string; status: string;
  is_template: boolean; due_date: string | null; nurse_id: string | null;
  profiles: { full_name: string } | null;
  plan_items: { id: string }[];
  plan_assessors: { id: string; profiles: { full_name: string } | null }[];
};
type Person = { id: string; full_name: string };
type Cpu = { id: string; name: string };

const STATUS_CLS: Record<string, string> = {
  draft: "bg-gray-100 text-gray-500", active: "bg-green-100 text-green-700",
  complete: "bg-teal-100 text-teal-700", cancelled: "bg-red-100 text-red-600",
};

export default function PlansManager({ plans, workers, assessors, cpus }: { plans: Plan[]; workers: Person[]; assessors: Person[]; cpus: Cpu[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", programme_type: "annual", scheduling_rule: "fixed", nurse_id: "", due_date: "" });
  const [pickedCpus, setPickedCpus] = useState<Set<string>>(new Set());
  const [pickedAssessors, setPickedAssessors] = useState<Set<string>>(new Set());

  async function api(method: string, body: object) {
    setBusy(true);
    const res = await fetch("/api/assessment-plans", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setBusy(false);
    if (res.ok) router.refresh(); else alert((await res.json().catch(() => ({}))).error ?? "Failed");
    return res.ok;
  }

  async function create() {
    if (!form.name.trim()) { alert("Name required"); return; }
    const ok = await api("POST", {
      ...form, name: form.name.trim(),
      nurse_id: form.nurse_id || null, due_date: form.due_date || null,
      is_template: !form.nurse_id,
      cpu_ids: [...pickedCpus], assessor_ids: [...pickedAssessors],
    });
    if (ok) { setCreating(false); setForm({ name: "", programme_type: "annual", scheduling_rule: "fixed", nurse_id: "", due_date: "" }); setPickedCpus(new Set()); setPickedAssessors(new Set()); }
  }
  async function del(p: Plan) {
    if (!confirm(`Delete plan "${p.name}"?`)) return;
    setBusy(true); await fetch(`/api/assessment-plans?id=${p.id}`, { method: "DELETE" }); setBusy(false); router.refresh();
  }

  function toggle(set: Set<string>, id: string, setter: (s: Set<string>) => void) {
    const s = new Set(set); if (s.has(id)) s.delete(id); else s.add(id); setter(s);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <button onClick={() => setCreating(c => !c)} className="px-4 py-2 bg-teal-600 text-white text-sm font-semibold rounded-lg hover:bg-teal-700">
          {creating ? "Cancel" : "+ New Plan"}
        </button>
      </div>

      {creating && (
        <div className="bg-white rounded-xl border border-gray-100 p-5 flex flex-col gap-3">
          <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="Plan name *"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" autoFocus />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-gray-500 mb-1 block">Programme</label>
              <select value={form.programme_type} onChange={e => setForm(p => ({ ...p, programme_type: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
                {Object.entries(PROGRAMME_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 mb-1 block">Scheduling</label>
              <select value={form.scheduling_rule} onChange={e => setForm(p => ({ ...p, scheduling_rule: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
                {Object.entries(SCHEDULING_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-gray-500 mb-1 block">Worker (blank = template)</label>
              <select value={form.nurse_id} onChange={e => setForm(p => ({ ...p, nurse_id: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
                <option value="">— Reusable template —</option>
                {workers.map(w => <option key={w.id} value={w.id}>{w.full_name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 mb-1 block">Due date</label>
              <input type="date" value={form.due_date} onChange={e => setForm(p => ({ ...p, due_date: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-500 mb-1.5 block">Target CPUs ({pickedCpus.size})</label>
            <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
              {cpus.map(c => {
                const on = pickedCpus.has(c.id);
                return <button key={c.id} onClick={() => toggle(pickedCpus, c.id, setPickedCpus)}
                  className={`text-[11px] px-2.5 py-1 rounded-full border ${on ? "bg-teal-600 text-white border-teal-600" : "bg-white text-gray-600 border-gray-200 hover:border-teal-300"}`}>{on ? "✓ " : "+ "}{c.name}</button>;
              })}
              {!cpus.length && <p className="text-[11px] text-gray-300 italic">No CPUs defined yet</p>}
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-500 mb-1.5 block">Assessors ({pickedAssessors.size}) — first = primary</label>
            <div className="flex flex-wrap gap-1.5">
              {assessors.map(a => {
                const on = pickedAssessors.has(a.id);
                return <button key={a.id} onClick={() => toggle(pickedAssessors, a.id, setPickedAssessors)}
                  className={`text-[11px] px-2.5 py-1 rounded-full border ${on ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-gray-600 border-gray-200 hover:border-indigo-300"}`}>{on ? "✓ " : "+ "}{a.full_name}</button>;
              })}
            </div>
          </div>
          <button onClick={create} disabled={busy} className="self-end px-4 py-2 bg-teal-600 text-white text-sm font-semibold rounded-lg hover:bg-teal-700 disabled:opacity-50">
            {busy ? "Creating…" : "Create Plan"}
          </button>
        </div>
      )}

      {plans.map(p => (
        <div key={p.id} className="bg-white rounded-xl border border-gray-100 px-5 py-4">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2">
                <p className="font-semibold text-gray-900 text-sm">{p.name}</p>
                {p.is_template && <span className="text-[10px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded">Template</span>}
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded capitalize ${STATUS_CLS[p.status] ?? "bg-gray-100 text-gray-500"}`}>{p.status}</span>
              </div>
              <p className="text-[11px] text-gray-500 mt-1">
                {PROGRAMME_TYPE_LABELS[p.programme_type] ?? p.programme_type} · {SCHEDULING_LABELS[p.scheduling_rule] ?? p.scheduling_rule}
                {p.profiles?.full_name && ` · ${p.profiles.full_name}`}
                {p.due_date && ` · due ${new Date(p.due_date).toLocaleDateString()}`}
              </p>
              <p className="text-[10px] text-gray-400 mt-0.5">
                {p.plan_items.length} CPU{p.plan_items.length !== 1 ? "s" : ""} · {p.plan_assessors.length} assessor{p.plan_assessors.length !== 1 ? "s" : ""}
                {p.plan_assessors.length > 0 && `: ${p.plan_assessors.map(a => a.profiles?.full_name).filter(Boolean).join(", ")}`}
              </p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {p.status === "draft" && <button onClick={() => api("PATCH", { id: p.id, status: "active" })} className="px-2.5 py-1 text-xs text-green-600 border border-green-200 rounded-lg hover:bg-green-50">Activate</button>}
              {p.status === "active" && <button onClick={() => api("PATCH", { id: p.id, status: "complete" })} className="px-2.5 py-1 text-xs text-teal-600 border border-teal-200 rounded-lg hover:bg-teal-50">Complete</button>}
              <button onClick={() => del(p)} className="px-2.5 py-1 text-xs text-red-500 border border-red-100 rounded-lg hover:bg-red-50">Delete</button>
            </div>
          </div>
        </div>
      ))}

      {!plans.length && !creating && (
        <div className="bg-white rounded-xl border border-gray-100 p-10 text-center">
          <p className="text-2xl mb-2">🗓️</p>
          <p className="text-gray-400 text-sm">No assessment plans yet — create one to schedule assessments for a worker or as a reusable template.</p>
        </div>
      )}
    </div>
  );
}
