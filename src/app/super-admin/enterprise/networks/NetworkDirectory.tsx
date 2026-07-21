"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { COUNTRIES } from "@/lib/countries";

// Networks directory (ENT-001 §2) — table of enterprise groups + create.
/* eslint-disable @typescript-eslint/no-explicit-any */

const NET_TYPES = ["network", "enterprise_group", "health_system", "holding", "academic_network"];
const input = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/40";

export default function NetworkDirectory({ rows }: { rows: any[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [form, setForm] = useState({ name: "", type: "network", hq_country: "Kenya" });
  const set = (k: string) => (e: any) => setForm(f => ({ ...f, [k]: e.target.value }));

  const filtered = useMemo(() => rows.filter(r => !q || r.name.toLowerCase().includes(q.toLowerCase()) || (r.hq ?? "").toLowerCase().includes(q.toLowerCase())), [rows, q]);

  async function create() {
    if (!form.name.trim()) { setErr("Name is required"); return; }
    setSaving(true); setErr("");
    const r = await fetch("/api/enterprise/networks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    setSaving(false);
    if (!r.ok) { setErr((await r.json().catch(() => ({}))).error ?? "Failed"); return; }
    const net = await r.json();
    setOpen(false);
    router.push(`/super-admin/enterprise/networks/${net.id}`);
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200">
      <div className="flex flex-wrap items-center gap-2 p-3 border-b border-gray-100">
        <h2 className="font-semibold text-gray-900 mr-auto">Enterprise networks <span className="text-gray-400 font-normal text-sm">({filtered.length})</span></h2>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search networks…" className={`${input} w-56`} />
        <button onClick={() => { setOpen(true); setErr(""); }} className="text-sm font-semibold bg-teal-600 hover:bg-teal-700 text-white rounded-lg px-3.5 py-2">+ Add Network</button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-[11px] uppercase tracking-wide text-gray-400 border-b border-gray-100">
            <th className="px-4 py-2.5 font-semibold">Network</th><th className="px-4 py-2.5 font-semibold">Type</th><th className="px-4 py-2.5 font-semibold">HQ</th>
            <th className="px-4 py-2.5 font-semibold text-right">Members</th><th className="px-4 py-2.5 font-semibold text-right">Facilities</th><th className="px-4 py-2.5 font-semibold text-right">Countries</th><th className="px-4 py-2.5 font-semibold text-right">Users</th>
          </tr></thead>
          <tbody>
            {filtered.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">No networks yet.</td></tr>}
            {filtered.map(r => (
              <tr key={r.id} onClick={() => router.push(`/super-admin/enterprise/networks/${r.id}`)} className="border-b border-gray-50 hover:bg-gray-50/60 cursor-pointer">
                <td className="px-4 py-3"><div className="flex items-center gap-2"><span className="w-7 h-7 rounded-lg bg-indigo-50 flex items-center justify-center text-sm shrink-0">🌐</span><span className="font-medium text-gray-900 truncate">{r.name}</span></div></td>
                <td className="px-4 py-3 text-gray-600 capitalize">{(r.type ?? "").replace(/_/g, " ")}</td>
                <td className="px-4 py-3 text-gray-600">{r.hq}</td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-700">{r.members}</td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-700">{r.facilities}</td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-700">{r.countries}</td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-700">{r.users}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {open && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setOpen(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100"><h3 className="font-bold text-gray-900">Add Network</h3><button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600 text-xl">×</button></div>
            <div className="p-6 flex flex-col gap-3">
              <div><label className="text-xs font-semibold text-gray-600 mb-1 block">Network name *</label><input value={form.name} onChange={set("name")} className={input} placeholder="e.g. CURE International" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs font-semibold text-gray-600 mb-1 block">Type</label><select value={form.type} onChange={set("type")} className={input}>{NET_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}</select></div>
                <div><label className="text-xs font-semibold text-gray-600 mb-1 block">HQ Country</label><select value={form.hq_country} onChange={set("hq_country")} className={input}>{COUNTRIES.map(c => <option key={c}>{c}</option>)}</select></div>
              </div>
              {err && <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{err}</p>}
              <div className="flex gap-2 pt-1">
                <button onClick={() => setOpen(false)} className="flex-1 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
                <button onClick={create} disabled={saving} className="flex-1 py-2 bg-teal-600 text-white rounded-lg text-sm font-semibold hover:bg-teal-700 disabled:opacity-60">{saving ? "Creating…" : "Create"}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
