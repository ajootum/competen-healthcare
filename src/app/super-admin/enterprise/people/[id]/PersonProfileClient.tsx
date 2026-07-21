"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

// Person profile (ENT-001 §5) — Person / Position / Roles / Workspace access,
// with live editing of position, roles, employment and account status.
/* eslint-disable @typescript-eslint/no-explicit-any */

const BADGE: Record<string, string> = { active: "bg-green-50 text-green-700", invited: "bg-blue-50 text-blue-700", suspended: "bg-rose-50 text-rose-700", deactivated: "bg-gray-100 text-gray-500", left: "bg-gray-100 text-gray-500" };
const TABS = ["Overview", "Position & Roles", "Workspace Access", "Audit"] as const;
const card = "bg-white rounded-xl border border-gray-200 p-5";
const relTime = (iso?: string | null) => { if (!iso) return ""; const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000); if (s < 3600) return `${Math.floor(s / 60)} min ago`; if (s < 86400) return `${Math.floor(s / 3600)} hr ago`; return `${Math.floor(s / 86400)} d ago`; };
const input = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/40";
function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="flex justify-between gap-4 py-1.5 border-b border-gray-50 last:border-0"><span className="text-gray-500">{label}</span><span className="text-gray-800 text-right">{value ?? <span className="text-gray-300">—</span>}</span></div>;
}

export default function PersonProfileClient({ data, assignableRoles, employmentTypes, accountStatuses }: { data: any; assignableRoles: string[]; employmentTypes: string[]; accountStatuses: string[] }) {
  const router = useRouter();
  const { person, positions, audit, auditReady } = data;
  const [tab, setTab] = useState<(typeof TABS)[number]>("Overview");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ k: "ok" | "err"; t: string } | null>(null);
  const [edit, setEdit] = useState(false);
  const [form, setForm] = useState({ position_id: person.position?.id ?? "", account_status: person.status, employment_type: person.employment ?? "", staff_number: person.staffNumber ?? "" });
  const set = (k: string) => (e: any) => setForm(f => ({ ...f, [k]: e.target.value }));
  const toast = (k: "ok" | "err", t: string) => { setMsg({ k, t }); setTimeout(() => setMsg(null), 4000); };

  async function patch(body: any, ok = "Updated") {
    setBusy(true);
    const r = await fetch(`/api/enterprise/people?id=${person.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setBusy(false);
    if (r.ok) { toast("ok", ok); router.refresh(); return true; } else { toast("err", (await r.json().catch(() => ({}))).error ?? "Failed"); return false; }
  }
  async function toggleRole(role: string, has: boolean) { await patch({ action: has ? "remove_role" : "add_role", role }, has ? "Role removed" : "Role added"); }
  async function saveEdit() { const ok = await patch({ position_id: form.position_id || null, account_status: form.account_status, employment_type: form.employment_type || null, staff_number: form.staff_number || null }, "Saved"); if (ok) setEdit(false); }

  const has = (r: string) => person.roles.includes(r);

  return (
    <div data-wide className="space-y-4">
      <div className="flex items-center gap-2 text-xs text-gray-400">
        <Link href="/super-admin/enterprise" className="hover:text-teal-700">Enterprise Administration</Link><span>/</span>
        <Link href="/super-admin/enterprise/people" className="hover:text-teal-700">People</Link><span>/</span><span className="text-gray-600 truncate">{person.name}</span>
      </div>

      <div className={`${card} flex flex-wrap items-start justify-between gap-3`}>
        <div className="flex items-start gap-3">
          <span className="w-11 h-11 rounded-full bg-blue-50 flex items-center justify-center text-lg shrink-0">{(person.name ?? "?")[0]}</span>
          <div>
            <div className="flex items-center gap-2 flex-wrap"><h1 className="text-xl font-bold text-gray-900">{person.name}</h1>
              <span className={`text-[10px] font-medium px-2 py-0.5 rounded ${BADGE[person.status] ?? "bg-gray-100 text-gray-600"}`}>{person.status}</span></div>
            <p className="text-xs text-gray-500 mt-0.5">{[person.position?.title, person.staffNumber, person.email].filter(Boolean).join(" · ")}</p>
          </div>
        </div>
        <button onClick={() => setEdit(true)} className="text-xs font-medium rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 px-3 py-1.5">Edit</button>
      </div>
      {msg && <div className={`text-sm rounded-lg px-3 py-1.5 ${msg.k === "ok" ? "bg-green-50 text-green-800" : "bg-amber-50 text-amber-800"}`}>{msg.t}</div>}

      <div className="flex gap-1 border-b border-gray-200 overflow-x-auto">
        {TABS.map(t => <button key={t} onClick={() => setTab(t)} className={`px-3.5 py-2 text-sm font-medium border-b-2 -mb-px whitespace-nowrap ${tab === t ? "border-teal-600 text-teal-700" : "border-transparent text-gray-500 hover:text-gray-800"}`}>{t}</button>)}
      </div>

      {tab === "Overview" && (
        <div className="grid lg:grid-cols-2 gap-4">
          <div className={card}><h3 className="font-semibold text-gray-900 mb-2">Person</h3>
            <Row label="Staff number" value={person.staffNumber} /><Row label="Email" value={person.email} /><Row label="Phone" value={person.phone} />
            <Row label="Profession" value={person.profession} /><Row label="Employment" value={person.employment ? <span className="capitalize">{person.employment}</span> : null} /><Row label="Account status" value={<span className="capitalize">{person.status}</span>} />
          </div>
          <div className={card}><h3 className="font-semibold text-gray-900 mb-2">Placement</h3>
            <Row label="Organisation" value={person.org?.name} /><Row label="Facility" value={person.facility?.name} /><Row label="Department" value={person.department?.name} />
            <Row label="Unit" value={person.unit?.name} /><Row label="Position" value={person.position?.title} /><Row label="Line manager" value={person.lineManager?.full_name} />
          </div>
        </div>
      )}

      {tab === "Position & Roles" && (
        <div className="grid lg:grid-cols-2 gap-4">
          <div className={card}><h3 className="font-semibold text-gray-900 mb-2">Position</h3>
            <Row label="Position" value={person.position?.title} /><Row label="Code" value={person.position?.code} /><Row label="Grade" value={person.position?.grade} /><Row label="Profession" value={person.position?.profession} />
            <p className="text-[11px] text-gray-400 mt-2">Change the assigned position via Edit.</p>
          </div>
          <div className={card}>
            <h3 className="font-semibold text-gray-900 mb-2">Roles</h3>
            <p className="text-[11px] text-gray-400 mb-2">Primary role: <span className="capitalize font-medium text-gray-600">{person.primaryRole?.replace(/_/g, " ") ?? "—"}</span>. Toggle assignable roles:</p>
            <div className="flex flex-wrap gap-2">
              {assignableRoles.map(r => (
                <button key={r} onClick={() => toggleRole(r, has(r))} disabled={busy}
                  className={`text-xs font-medium rounded-lg px-2.5 py-1 border capitalize disabled:opacity-40 ${has(r) ? "bg-teal-50 border-teal-200 text-teal-700" : "bg-white border-gray-200 text-gray-500 hover:bg-gray-50"}`}>
                  {has(r) ? "✓ " : "+ "}{r.replace(/_/g, " ")}
                </button>
              ))}
            </div>
            {person.roles.filter((r: string) => !assignableRoles.includes(r)).length > 0 &&
              <p className="text-[10px] text-gray-400 mt-3">Other roles (not editable here): {person.roles.filter((r: string) => !assignableRoles.includes(r)).map((r: string) => r.replace(/_/g, " ")).join(", ")}</p>}
          </div>
        </div>
      )}

      {tab === "Workspace Access" && (
        <div className={card}>
          <h3 className="font-semibold text-gray-900 mb-3">Workspace access</h3>
          <p className="text-[11px] text-gray-400 mb-3">Derived from the person&apos;s roles — each role grants access to its workspace.</p>
          {person.workspaces.length === 0 ? <p className="text-sm text-gray-400">No workspaces — assign a role to grant access.</p> : (
            <div className="flex flex-wrap gap-2">{person.workspaces.map((w: string) => <span key={w} className="text-sm bg-indigo-50 text-indigo-700 rounded-lg px-3 py-1.5">{w}</span>)}</div>
          )}
        </div>
      )}

      {tab === "Audit" && (
        <div className={card}><h3 className="font-semibold text-gray-900 mb-3">Audit history</h3>
          {!auditReady || audit.length === 0 ? <p className="text-sm text-gray-400">{auditReady ? "No audit entries for this person yet." : "Audit log not available."}</p> : (
            <div className="space-y-2">{audit.map((a: any, i: number) => (
              <div key={i} className="flex items-center gap-2.5 text-sm"><span className="w-1.5 h-1.5 rounded-full bg-teal-400 shrink-0" /><span className="text-gray-700 capitalize">{(a.action ?? "").replace(/_/g, " ")}</span><span className="text-gray-400 text-xs ml-auto">{relTime(a.created_at)}</span></div>
            ))}</div>
          )}
        </div>
      )}

      {edit && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setEdit(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100"><h3 className="font-bold text-gray-900">Edit {person.name}</h3><button onClick={() => setEdit(false)} className="text-gray-400 hover:text-gray-600 text-xl">×</button></div>
            <div className="p-6 flex flex-col gap-3">
              <div><label className="text-xs font-semibold text-gray-600 mb-1 block">Position</label><select value={form.position_id} onChange={set("position_id")} className={input}><option value="">— Unassigned —</option>{positions.map((p: any) => <option key={p.id} value={p.id}>{p.title}{p.code ? ` (${p.code})` : ""}</option>)}</select></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs font-semibold text-gray-600 mb-1 block">Account status</label><select value={form.account_status} onChange={set("account_status")} className={input}>{accountStatuses.map(s => <option key={s} value={s}>{s}</option>)}</select></div>
                <div><label className="text-xs font-semibold text-gray-600 mb-1 block">Employment</label><select value={form.employment_type} onChange={set("employment_type")} className={input}><option value="">—</option>{employmentTypes.map(t => <option key={t} value={t}>{t}</option>)}</select></div>
              </div>
              <div><label className="text-xs font-semibold text-gray-600 mb-1 block">Staff number</label><input value={form.staff_number} onChange={set("staff_number")} className={input} /></div>
              <div className="flex gap-2 pt-1">
                <button onClick={() => setEdit(false)} className="flex-1 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
                <button onClick={saveEdit} disabled={busy} className="flex-1 py-2 bg-teal-600 text-white rounded-lg text-sm font-semibold hover:bg-teal-700 disabled:opacity-60">{busy ? "Saving…" : "Save"}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
