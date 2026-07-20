"use client";

import { useState } from "react";
import type { UserRow } from "@/lib/workspace-settings";

// Live user & role directory for the Users, Roles & Permissions module. Read-only
// — invite / remove / role-assignment writes need a backing RBAC store, so they
// aren't shown as working controls.

const fmtDate = (iso: string | null) => iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", year: "numeric" }) : "—";

export default function UsersTable({ users }: { users: UserRow[] }) {
  const [q, setQ] = useState("");
  const shown = q ? users.filter(u => u.name.toLowerCase().includes(q.toLowerCase()) || u.email.toLowerCase().includes(q.toLowerCase()) || u.roles.join(" ").toLowerCase().includes(q.toLowerCase())) : users;

  return (
    <div className="rounded-2xl bg-white border border-gray-200 shadow-sm overflow-hidden">
      <div className="flex items-center gap-2 p-3 border-b border-gray-100">
        <div className="relative flex-1">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">🔍</span>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search users, emails or roles…"
            className="w-full bg-gray-50 border border-gray-200 rounded-lg pl-9 pr-3 py-2 text-[13px] focus:outline-none focus:border-violet-400" />
        </div>
        <span className="text-[11px] text-gray-400 pr-1 whitespace-nowrap">{shown.length} of {users.length}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="text-[10px] font-bold uppercase tracking-wider text-gray-400 border-b border-gray-100">
              <th className="px-4 py-2.5">User</th><th className="px-2 py-2.5">Roles</th><th className="px-2 py-2.5">Department</th><th className="px-2 py-2.5">Joined</th>
            </tr>
          </thead>
          <tbody>
            {shown.map(u => (
              <tr key={u.id} className="text-[12px] border-b border-gray-50 hover:bg-gray-50">
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2.5">
                    <span className="w-7 h-7 rounded-full bg-violet-100 text-violet-700 flex items-center justify-center text-[11px] font-bold shrink-0">{(u.name[0] ?? "?").toUpperCase()}</span>
                    <span className="min-w-0"><span className="block font-medium text-gray-800 truncate">{u.name}</span><span className="block text-[10px] text-gray-400 truncate">{u.email}</span></span>
                  </div>
                </td>
                <td className="px-2 py-2.5"><div className="flex flex-wrap gap-1">{u.roles.length ? u.roles.map(r => <span key={r} className="text-[10px] font-semibold text-violet-700 bg-violet-50 rounded px-1.5 py-0.5">{r}</span>) : <span className="text-gray-300">—</span>}</div></td>
                <td className="px-2 py-2.5 text-gray-600">{u.department}</td>
                <td className="px-2 py-2.5 text-gray-400 whitespace-nowrap">{fmtDate(u.joined)}</td>
              </tr>
            ))}
            {shown.length === 0 && <tr><td colSpan={4} className="px-4 py-8 text-center text-[12px] text-gray-400">No users match your search.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="text-[10px] text-gray-400 p-3 border-t border-gray-100">Live from your workspace directory · read-only. Invite, role-assignment and access-review actions activate once the RBAC store is connected.</p>
    </div>
  );
}
