"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";

// People + Positions directory (ENT-001 §5). People tab links to person detail;
// Positions tab is the catalogue with create.
/* eslint-disable @typescript-eslint/no-explicit-any */

const STATUS_BADGE: Record<string, string> = { active: "bg-green-50 text-green-700", invited: "bg-blue-50 text-blue-700", suspended: "bg-rose-50 text-rose-700", deactivated: "bg-gray-100 text-gray-500", left: "bg-gray-100 text-gray-500" };
const input = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/40";

export default function PeopleDirectory({ rows, positions }: { rows: any[]; positions: any[] }) {
  const router = useRouter();
  const [tab, setTab] = useState<"people" | "positions">("people");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const roleList = useMemo(() => [...new Set(rows.map(r => r.primaryRole).filter(Boolean))], [rows]);
  const [role, setRole] = useState("all");

  const people = useMemo(() => rows.filter(r =>
    (status === "all" || r.status === status) && (role === "all" || r.primaryRole === role) &&
    (!q || r.name?.toLowerCase().includes(q.toLowerCase()) || (r.email ?? "").toLowerCase().includes(q.toLowerCase()) || (r.staffNumber ?? "").toLowerCase().includes(q.toLowerCase()))
  ), [rows, q, status, role]);
  const posFiltered = useMemo(() => positions.filter(p => !q || p.title.toLowerCase().includes(q.toLowerCase()) || (p.code ?? "").toLowerCase().includes(q.toLowerCase())), [positions, q]);

  return (
    <div className="bg-white rounded-xl border border-gray-200">
      <div className="flex flex-wrap items-center gap-2 p-3 border-b border-gray-100">
        <div className="flex gap-1 mr-auto">
          {(["people", "positions"] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} className={`px-3 py-1.5 rounded-lg text-sm font-medium capitalize ${tab === t ? "bg-teal-50 text-teal-700" : "text-gray-500 hover:bg-gray-100"}`}>{t} ({t === "people" ? people.length : posFiltered.length})</button>
          ))}
        </div>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder={`Search ${tab}…`} className={`${input} w-52`} />
        {tab === "people" && <>
          <select value={role} onChange={e => setRole(e.target.value)} className={`${input} w-40`}><option value="all">All roles</option>{roleList.map(r => <option key={r} value={r}>{r.replace(/_/g, " ")}</option>)}</select>
          <select value={status} onChange={e => setStatus(e.target.value)} className={`${input} w-36`}><option value="all">All statuses</option>{["active", "invited", "suspended", "deactivated", "left"].map(s => <option key={s} value={s}>{s}</option>)}</select>
        </>}
        {tab === "positions" && <span className="text-[11px] text-gray-400">Read-only · positions are provisioned from the Workforce engine</span>}
      </div>

      {tab === "people" ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[11px] uppercase tracking-wide text-gray-400 border-b border-gray-100">
              <th className="px-4 py-2.5 font-semibold">Name</th><th className="px-4 py-2.5 font-semibold">Position</th><th className="px-4 py-2.5 font-semibold">Primary role</th><th className="px-4 py-2.5 font-semibold">Facility</th><th className="px-4 py-2.5 font-semibold">Status</th>
            </tr></thead>
            <tbody>
              {people.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">No people match.</td></tr>}
              {people.slice(0, 500).map(r => (
                <tr key={r.id} onClick={() => router.push(`/super-admin/enterprise/people/${r.id}`)} className="border-b border-gray-50 hover:bg-gray-50/60 cursor-pointer">
                  <td className="px-4 py-3"><div className="flex items-center gap-2"><span className="w-7 h-7 rounded-full bg-blue-50 flex items-center justify-center text-xs shrink-0">{(r.name ?? "?")[0]}</span><div className="min-w-0"><p className="font-medium text-gray-900 truncate">{r.name}</p><p className="text-[10px] text-gray-400 truncate">{r.staffNumber ? `${r.staffNumber} · ` : ""}{r.email}</p></div></div></td>
                  <td className="px-4 py-3 text-gray-600">{r.position ?? <span className="text-gray-300">Unassigned</span>}</td>
                  <td className="px-4 py-3 text-gray-600 capitalize">{r.primaryRole ? r.primaryRole.replace(/_/g, " ") : "—"}{r.roleCount > 1 && <span className="text-[10px] text-gray-400"> +{r.roleCount - 1}</span>}</td>
                  <td className="px-4 py-3 text-gray-500">{r.facility ?? <span className="text-gray-300">—</span>}</td>
                  <td className="px-4 py-3"><span className={`text-[10px] font-medium px-2 py-0.5 rounded ${STATUS_BADGE[r.status] ?? "bg-gray-100 text-gray-600"}`}>{r.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          {people.length > 500 && <p className="px-4 py-2 text-[10px] text-gray-400">Showing first 500 of {people.length}.</p>}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[11px] uppercase tracking-wide text-gray-400 border-b border-gray-100">
              <th className="px-4 py-2.5 font-semibold">Position</th><th className="px-4 py-2.5 font-semibold">Grade</th><th className="px-4 py-2.5 font-semibold">Profession</th><th className="px-4 py-2.5 font-semibold">Facility</th><th className="px-4 py-2.5 font-semibold text-center">Supervises</th><th className="px-4 py-2.5 font-semibold text-right">Holders</th>
            </tr></thead>
            <tbody>
              {posFiltered.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">No positions yet.</td></tr>}
              {posFiltered.map(p => (
                <tr key={p.id} className="border-b border-gray-50">
                  <td className="px-4 py-3"><div className="flex items-center gap-2"><span className="w-7 h-7 rounded-lg bg-emerald-50 flex items-center justify-center text-sm shrink-0">🪪</span><div><p className="font-medium text-gray-900">{p.title}</p>{p.code && <p className="text-[10px] text-gray-400">{p.code}</p>}</div></div></td>
                  <td className="px-4 py-3 text-gray-600">{p.grade ?? "—"}</td>
                  <td className="px-4 py-3 text-gray-600">{p.profession ?? "—"}</td>
                  <td className="px-4 py-3 text-gray-500">{p.facility ?? <span className="text-gray-300">—</span>}</td>
                  <td className="px-4 py-3 text-center">{p.canSupervise ? "✓" : <span className="text-gray-300">—</span>}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-gray-700">{p.holders}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
