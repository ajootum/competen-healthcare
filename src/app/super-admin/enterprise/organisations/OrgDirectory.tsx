"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { COUNTRIES } from "@/lib/countries";

// Organisations directory (ENT-001 §1) — searchable/filterable table + create.
/* eslint-disable @typescript-eslint/no-explicit-any */

const ORG_TYPES = ["government", "private", "ngo", "faith_based", "academic"];
const STATUSES = ["draft", "onboarding", "active", "suspended", "restricted", "archived", "closed"];
export const STATUS_BADGE: Record<string, string> = {
  draft: "bg-gray-100 text-gray-600", onboarding: "bg-amber-50 text-amber-700", active: "bg-green-50 text-green-700",
  suspended: "bg-rose-50 text-rose-700", restricted: "bg-orange-50 text-orange-700", archived: "bg-gray-100 text-gray-500", closed: "bg-gray-100 text-gray-500",
};
const input = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/40";

export default function OrgDirectory({ rows, networks }: { rows: any[]; networks: any[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [form, setForm] = useState({ name: "", org_code: "", type: "private", hq_country: "Kenya", enterprise_id: "", status: "onboarding" });
  const set = (k: string) => (e: any) => setForm(f => ({ ...f, [k]: e.target.value }));

  const filtered = useMemo(() => rows.filter(r =>
    (status === "all" || r.status === status) &&
    (!q || r.name.toLowerCase().includes(q.toLowerCase()) || (r.code ?? "").toLowerCase().includes(q.toLowerCase()) || (r.country ?? "").toLowerCase().includes(q.toLowerCase()))
  ), [rows, q, status]);

  async function create() {
    if (!form.name.trim()) { setErr("Name is required"); return; }
    setSaving(true); setErr("");
    const r = await fetch("/api/enterprise/organisations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, enterprise_id: form.enterprise_id || null }) });
    setSaving(false);
    if (!r.ok) { setErr((await r.json().catch(() => ({}))).error ?? "Failed"); return; }
    const org = await r.json();
    setOpen(false);
    router.push(`/super-admin/enterprise/organisations/${org.id}`);
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200">
      <div className="flex flex-wrap items-center gap-2 p-3 border-b border-gray-100">
        <h2 className="font-semibold text-gray-900 mr-auto">Organisations <span className="text-gray-400 font-normal text-sm">({filtered.length})</span></h2>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search organisations…" className={`${input} w-56`} />
        <select value={status} onChange={e => setStatus(e.target.value)} className={`${input} w-40`}>
          <option value="all">All statuses</option>
          {STATUSES.map(s => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
        </select>
        <button onClick={() => { setOpen(true); setErr(""); }} className="text-sm font-semibold bg-teal-600 hover:bg-teal-700 text-white rounded-lg px-3.5 py-2">+ Add Organisation</button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400 border-b border-gray-100">
              <th className="px-4 py-2.5 font-semibold">Name</th>
              <th className="px-4 py-2.5 font-semibold">Type</th>
              <th className="px-4 py-2.5 font-semibold">Country</th>
              <th className="px-4 py-2.5 font-semibold">Network</th>
              <th className="px-4 py-2.5 font-semibold">Status</th>
              <th className="px-4 py-2.5 font-semibold text-right">Users</th>
              <th className="px-4 py-2.5 font-semibold text-right">Facilities</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">No organisations match.</td></tr>}
            {filtered.map(r => (
              <tr key={r.id} onClick={() => router.push(`/super-admin/enterprise/organisations/${r.id}`)} className="border-b border-gray-50 hover:bg-gray-50/60 cursor-pointer">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="w-7 h-7 rounded-lg bg-violet-50 flex items-center justify-center text-sm shrink-0">🏛️</span>
                    <div className="min-w-0">
                      <p className="font-medium text-gray-900 truncate">{r.name}</p>
                      {r.code && <p className="text-[10px] text-gray-400">{r.code}</p>}
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 text-gray-600 capitalize">{(r.type ?? "").replace(/_/g, " ")}</td>
                <td className="px-4 py-3 text-gray-600">{r.country}</td>
                <td className="px-4 py-3 text-gray-500">{r.network ?? <span className="text-gray-300">—</span>}</td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded ${STATUS_BADGE[r.status] ?? "bg-gray-100 text-gray-600"}`}>
                    {!r.hasAdmin && r.status !== "archived" && <span title="No administrator" className="text-red-500">●</span>}{r.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-700">{r.users}</td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-700">{r.facilities}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {open && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setOpen(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h3 className="font-bold text-gray-900">Add Organisation</h3>
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
            </div>
            <div className="p-6 flex flex-col gap-3">
              <div><label className="text-xs font-semibold text-gray-600 mb-1 block">Organisation name *</label><input value={form.name} onChange={set("name")} className={input} placeholder="e.g. CURE Uganda" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs font-semibold text-gray-600 mb-1 block">Code</label><input value={form.org_code} onChange={set("org_code")} className={input} placeholder="ORG-001" /></div>
                <div><label className="text-xs font-semibold text-gray-600 mb-1 block">Type</label><select value={form.type} onChange={set("type")} className={input}>{ORG_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}</select></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs font-semibold text-gray-600 mb-1 block">HQ Country</label><select value={form.hq_country} onChange={set("hq_country")} className={input}>{COUNTRIES.map(c => <option key={c}>{c}</option>)}</select></div>
                <div><label className="text-xs font-semibold text-gray-600 mb-1 block">Status</label><select value={form.status} onChange={set("status")} className={input}>{STATUSES.slice(0, 4).map(s => <option key={s} value={s}>{s}</option>)}</select></div>
              </div>
              <div><label className="text-xs font-semibold text-gray-600 mb-1 block">Network</label><select value={form.enterprise_id} onChange={set("enterprise_id")} className={input}><option value="">— None —</option>{networks.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}</select></div>
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
