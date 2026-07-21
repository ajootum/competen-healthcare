"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";

// Enterprise Templates registry (ENT-001 §6) — filterable table + create.
/* eslint-disable @typescript-eslint/no-explicit-any */

const TYPES = ["organisation", "facility", "department", "unit", "role", "workspace", "structure"];
const STATUS_BADGE: Record<string, string> = { draft: "bg-gray-100 text-gray-600", review: "bg-amber-50 text-amber-700", approved: "bg-sky-50 text-sky-700", published: "bg-green-50 text-green-700", assigned: "bg-violet-50 text-violet-700", retired: "bg-gray-100 text-gray-400" };
const TYPE_ICON: Record<string, string> = { organisation: "🏛️", facility: "🏥", department: "🗂️", unit: "🔹", role: "🪪", workspace: "🖥️", structure: "🏗️" };
const input = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/40";

export default function TemplateDirectory({ rows }: { rows: any[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [type, setType] = useState("all");
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [form, setForm] = useState({ name: "", code: "", template_type: "organisation", description: "" });
  const set = (k: string) => (e: any) => setForm(f => ({ ...f, [k]: e.target.value }));

  const filtered = useMemo(() => rows.filter(r => (type === "all" || r.type === type) && (!q || r.name.toLowerCase().includes(q.toLowerCase()) || (r.code ?? "").toLowerCase().includes(q.toLowerCase()))), [rows, q, type]);

  async function create() {
    if (!form.name.trim()) { setErr("Name is required"); return; }
    setSaving(true); setErr("");
    const r = await fetch("/api/enterprise/templates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    setSaving(false);
    if (!r.ok) { setErr((await r.json().catch(() => ({}))).error ?? "Failed"); return; }
    const t = await r.json();
    setOpen(false);
    router.push(`/super-admin/enterprise/templates/${t.id}`);
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200">
      <div className="flex flex-wrap items-center gap-2 p-3 border-b border-gray-100">
        <h2 className="font-semibold text-gray-900 mr-auto">Templates library <span className="text-gray-400 font-normal text-sm">({filtered.length})</span></h2>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search templates…" className={`${input} w-52`} />
        <select value={type} onChange={e => setType(e.target.value)} className={`${input} w-40`}><option value="all">All types</option>{TYPES.map(t => <option key={t} value={t}>{t}</option>)}</select>
        <button onClick={() => { setOpen(true); setErr(""); }} className="text-sm font-semibold bg-teal-600 hover:bg-teal-700 text-white rounded-lg px-3.5 py-2">+ New Template</button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-[11px] uppercase tracking-wide text-gray-400 border-b border-gray-100">
            <th className="px-4 py-2.5 font-semibold">Template</th><th className="px-4 py-2.5 font-semibold">Type</th><th className="px-4 py-2.5 font-semibold">Version</th><th className="px-4 py-2.5 font-semibold">Status</th><th className="px-4 py-2.5 font-semibold">Source</th>
          </tr></thead>
          <tbody>
            {filtered.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">No templates match.</td></tr>}
            {filtered.map(r => {
              const clickable = r.source === "ent";
              return (
                <tr key={`${r.source}-${r.id}`} onClick={clickable ? () => router.push(`/super-admin/enterprise/templates/${r.id}`) : undefined} className={`border-b border-gray-50 ${clickable ? "hover:bg-gray-50/60 cursor-pointer" : ""}`}>
                  <td className="px-4 py-3"><div className="flex items-center gap-2"><span className="w-7 h-7 rounded-lg bg-gray-50 flex items-center justify-center text-sm shrink-0">{TYPE_ICON[r.type] ?? "📦"}</span><div><p className="font-medium text-gray-900">{r.name}</p>{r.code && <p className="text-[10px] text-gray-400">{r.code}</p>}</div></div></td>
                  <td className="px-4 py-3 text-gray-600 capitalize">{r.type}</td>
                  <td className="px-4 py-3 text-gray-600 tabular-nums">v{r.version}</td>
                  <td className="px-4 py-3"><span className={`text-[10px] font-medium px-2 py-0.5 rounded ${STATUS_BADGE[r.status] ?? "bg-gray-100 text-gray-600"}`}>{r.status}</span></td>
                  <td className="px-4 py-3 text-gray-400 text-[11px]">{r.source === "ent" ? "Enterprise" : "Control-plane"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {open && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setOpen(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100"><h3 className="font-bold text-gray-900">New Template</h3><button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600 text-xl">×</button></div>
            <div className="p-6 flex flex-col gap-3">
              <div><label className="text-xs font-semibold text-gray-600 mb-1 block">Template name *</label><input value={form.name} onChange={set("name")} className={input} placeholder="e.g. Tertiary Hospital Template" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs font-semibold text-gray-600 mb-1 block">Code</label><input value={form.code} onChange={set("code")} className={input} /></div>
                <div><label className="text-xs font-semibold text-gray-600 mb-1 block">Type</label><select value={form.template_type} onChange={set("template_type")} className={input}>{TYPES.map(t => <option key={t} value={t}>{t}</option>)}</select></div>
              </div>
              <div><label className="text-xs font-semibold text-gray-600 mb-1 block">Description</label><textarea value={form.description} onChange={set("description")} rows={2} className={`${input} resize-none`} /></div>
              {err && <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{err}</p>}
              <div className="flex gap-2 pt-1">
                <button onClick={() => setOpen(false)} className="flex-1 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
                <button onClick={create} disabled={saving} className="flex-1 py-2 bg-teal-600 text-white rounded-lg text-sm font-semibold hover:bg-teal-700 disabled:opacity-60">{saving ? "Creating…" : "Create draft"}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
