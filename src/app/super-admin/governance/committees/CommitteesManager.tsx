"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

type Member = { id: string; role: string; profiles: { id: string; full_name: string } | null };
type Committee = { id: string; name: string; level: string; quorum: number; is_active: boolean; committee_members: Member[] };
type Staff = { id: string; full_name: string; role: string };

const LEVELS = ["enterprise", "country", "facility", "department", "specialty"] as const;
const LEVEL_CLS: Record<string, string> = {
  enterprise: "bg-violet-100 text-violet-700",
  country:    "bg-blue-100 text-blue-700",
  facility:   "bg-teal-100 text-teal-700",
  department: "bg-amber-100 text-amber-700",
  specialty:  "bg-rose-100 text-rose-700",
};

export default function CommitteesManager({ initialCommittees, staff }: { initialCommittees: Committee[]; staff: Staff[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [addMemberFor, setAddMemberFor] = useState<string | null>(null);

  async function api(method: string, body: object) {
    setBusy(true);
    const res = await fetch("/api/governance/committees", {
      method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    setBusy(false);
    if (res.ok) router.refresh();
    else alert((await res.json().catch(() => ({}))).error ?? "Failed");
  }

  async function create() {
    const name = prompt("Committee name (e.g. Nursing Competency Committee):");
    if (!name?.trim()) return;
    await api("POST", { name: name.trim(), level: "facility" });
  }
  async function del(c: Committee) {
    if (!confirm(`Delete committee "${c.name}"?`)) return;
    setBusy(true);
    await fetch(`/api/governance/committees?id=${c.id}`, { method: "DELETE" });
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <button onClick={create} disabled={busy}
          className="px-4 py-2 bg-rose-600 text-white text-sm font-semibold rounded-lg hover:bg-rose-700 disabled:opacity-50">
          + New Committee
        </button>
      </div>

      {initialCommittees.map(c => {
        const members = c.committee_members ?? [];
        const memberIds = new Set(members.map(m => m.profiles?.id));
        const available = staff.filter(s => !memberIds.has(s.id));
        return (
          <div key={c.id} className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3.5 bg-gray-50/60 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <p className="font-semibold text-gray-900 text-sm">{c.name}</p>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded capitalize ${LEVEL_CLS[c.level] ?? "bg-gray-100 text-gray-600"}`}>{c.level}</span>
                <span className="text-[10px] text-gray-400">quorum {c.quorum}</span>
              </div>
              <div className="flex items-center gap-2">
                <select defaultValue={c.level} disabled={busy}
                  onChange={e => api("PATCH", { id: c.id, level: e.target.value })}
                  className="text-[11px] border border-gray-200 rounded px-2 py-1">
                  {LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
                </select>
                <button onClick={() => del(c)} className="px-2.5 py-1 text-xs text-red-500 border border-red-100 rounded-lg hover:bg-red-50">Delete</button>
              </div>
            </div>
            <div className="px-5 py-3">
              <div className="flex flex-wrap gap-1.5 mb-2">
                {members.map(m => (
                  <span key={m.id} className="group inline-flex items-center gap-1 text-xs bg-rose-50 border border-rose-100 text-rose-700 pl-2.5 pr-1.5 py-0.5 rounded-full">
                    {m.profiles?.full_name ?? "—"}
                    {m.role === "chair" && <span className="text-[9px] font-bold">★</span>}
                    <button onClick={() => api("PATCH", { id: c.id, action: "remove_member", profile_id: m.profiles?.id })}
                      className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-600 transition-opacity leading-none px-0.5">×</button>
                  </span>
                ))}
                {!members.length && <p className="text-[11px] text-gray-300 italic">No members yet</p>}
              </div>
              {addMemberFor === c.id ? (
                <select autoFocus defaultValue="" disabled={busy}
                  onChange={e => { if (e.target.value) { api("PATCH", { id: c.id, action: "add_member", profile_id: e.target.value, role: "member" }); setAddMemberFor(null); } }}
                  className="text-[11px] border border-gray-200 rounded px-2 py-1">
                  <option value="" disabled>Select person…</option>
                  {available.map(s => <option key={s.id} value={s.id}>{s.full_name} ({s.role})</option>)}
                </select>
              ) : (
                <button onClick={() => setAddMemberFor(c.id)} className="text-[11px] text-rose-600 font-semibold hover:underline">+ Add member</button>
              )}
            </div>
          </div>
        );
      })}

      {!initialCommittees.length && (
        <div className="bg-white rounded-xl border border-gray-100 p-10 text-center">
          <p className="text-2xl mb-2">⚖️</p>
          <p className="text-gray-400 text-sm">No committees yet — create one to formalise content governance.</p>
        </div>
      )}
    </div>
  );
}
