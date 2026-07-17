"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ROLE_CONFIG, ORG_ROLE_CONFIG, PLATFORM_ROLE_CONFIG, type AppRole, type OrgRole, type PlatformRole } from "@/lib/roles";
import UserRoleEditor from "./UserRoleEditor";

export type UserRow = {
  id: string; name: string; email: string; phone: string | null;
  role: string; roles: string[];
  orgRole: string | null; orgRoles: string[] | null; platformRole: string | null;
  organisationId: string | null; organisation: string | null;
  hospitalId: string | null; facility: string | null;
  departmentId: string | null; department: string | null;
  specialization: string | null;
  status: "active" | "pending" | "suspended";
  statusDetail: string;
  lastSignIn: string | null; joinedAt: string;
  competencyPct: number | null; passportPct: number | null;
  decisionsTotal: number; decisionsOk: number; decisionsCurrent: number;
  activeAuthorizations: number;
};
export type AuditEntry = { id: string; action: string; entityType: string | null; entityName: string | null; at: string };

const ROLE_BADGE: Record<string, string> = {
  nurse:          "bg-teal-100 text-teal-700",
  assessor:       "bg-indigo-100 text-indigo-700",
  educator:       "bg-purple-100 text-purple-700",
  hospital_admin: "bg-amber-100 text-amber-700",
  super_admin:    "bg-rose-100 text-rose-700",
};
const STATUS_UI = {
  active:    { label: "Active",    pill: "bg-green-100 text-green-700",  dot: "bg-green-500" },
  pending:   { label: "Pending",   pill: "bg-amber-100 text-amber-700",  dot: "bg-amber-400" },
  suspended: { label: "Suspended", pill: "bg-red-100 text-red-700",      dot: "bg-red-500" },
} as const;

const AVATAR_TINTS = ["bg-teal-600", "bg-indigo-600", "bg-rose-600", "bg-amber-600", "bg-violet-600", "bg-sky-600"];
const tint = (id: string) => AVATAR_TINTS[[...id].reduce((s, ch) => s + ch.charCodeAt(0), 0) % AVATAR_TINTS.length];

const relTime = (iso: string | null) => {
  if (!iso) return "Never";
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} min${mins === 1 ? "" : "s"} ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? "" : "s"} ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days} days ago`;
  return new Date(iso).toLocaleDateString();
};

function Ring({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-[10px] text-gray-300" title="No assessment decisions yet">—</span>;
  const r = 15, c = 2 * Math.PI * r;
  const color = pct >= 80 ? "#22c55e" : pct >= 50 ? "#f59e0b" : "#ef4444";
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" role="img" aria-label={`${pct}%`}>
      <circle cx="20" cy="20" r={r} fill="none" stroke="#f3f4f6" strokeWidth="4" />
      <circle cx="20" cy="20" r={r} fill="none" stroke={color} strokeWidth="4"
        strokeDasharray={`${Math.max((pct / 100) * c, 0.5)} ${c}`} strokeLinecap="round" transform="rotate(-90 20 20)" />
      <text x="20" y="23.5" textAnchor="middle" fontSize="9" fontWeight="700" fill="#374151">{pct}%</text>
    </svg>
  );
}

const PAGE_SIZE = 25;

export default function UsersWorkspace({
  users, auditByActor, hospitals, organisations, departments, currentUserId,
}: {
  users: UserRow[];
  auditByActor: Record<string, AuditEntry[]>;
  hospitals: { id: string; name: string; country: string }[];
  organisations: { id: string; name: string }[];
  departments: { id: string; name: string; hospital_id: string }[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [fRole, setFRole] = useState("all");
  const [fOrg, setFOrg] = useState("all");
  const [fFacility, setFFacility] = useState("all");
  const [fStatus, setFStatus] = useState("all");
  const [fLogin, setFLogin] = useState("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [drawer, setDrawer] = useState<UserRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [page, setPage] = useState(0);
  // Captured once per mount so the memoized filter below stays pure.
  const [now] = useState(() => Date.now());
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState({ full_name: "", email: "", role: "nurse", mode: "invite", organisation_id: "", hospital_id: "" });
  const [createdCreds, setCreatedCreds] = useState<{ email: string; password: string } | null>(null);

  const anyFilter = search || fRole !== "all" || fOrg !== "all" || fFacility !== "all" || fStatus !== "all" || fLogin !== "all";

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter(u => {
      if (q && !u.name.toLowerCase().includes(q) && !u.email.toLowerCase().includes(q) && !(u.phone ?? "").toLowerCase().includes(q)) return false;
      if (fRole !== "all" && !u.roles.includes(fRole)) return false;
      if (fOrg !== "all" && u.organisationId !== fOrg) return false;
      if (fFacility !== "all" && u.hospitalId !== fFacility) return false;
      if (fStatus !== "all" && u.status !== fStatus) return false;
      if (fLogin !== "all") {
        const age = u.lastSignIn ? (now - new Date(u.lastSignIn).getTime()) / 86400000 : Infinity;
        if (fLogin === "today" && age > 1) return false;
        if (fLogin === "7d" && age > 7) return false;
        if (fLogin === "30d" && age > 30) return false;
        if (fLogin === "never" && u.lastSignIn) return false;
      }
      return true;
    });
  }, [users, search, fRole, fOrg, fFacility, fStatus, fLogin, now]);

  const pages = Math.ceil(filtered.length / PAGE_SIZE);
  const shown = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const isActive = (u: UserRow) => u.status === "active";
  const cardFor = (portal: string) => {
    const members = users.filter(u => u.roles.includes(portal));
    const active = members.filter(isActive).length;
    return { count: members.length, sub: members.length ? `${Math.round((active / members.length) * 100)}% active` : "none yet" };
  };
  const STAT_CARDS = [
    { label: "Total Users", icon: "👥", tintBg: "bg-sky-50", count: users.length, sub: `${users.filter(isActive).length} active` },
    { label: "Super Admins", icon: "🛡️", tintBg: "bg-rose-50", ...cardFor("super_admin") },
    { label: "Admins", icon: "🏛️", tintBg: "bg-amber-50", ...cardFor("hospital_admin") },
    { label: "Educators", icon: "🎓", tintBg: "bg-purple-50", ...cardFor("educator") },
    { label: "Assessors", icon: "🩺", tintBg: "bg-indigo-50", ...cardFor("assessor") },
    { label: "Healthcare Workers", icon: "🧑‍⚕️", tintBg: "bg-teal-50", ...cardFor("nurse") },
  ];

  async function act(userId: string, action: "suspend" | "unsuspend" | "send_reset" | "resend_invite", label: string) {
    setBusy(true); setNotice(null);
    const res = await fetch("/api/super-admin/users/actions", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, action }),
    });
    setBusy(false);
    if (res.ok) { setNotice({ kind: "ok", text: `${label} — done.` }); router.refresh(); }
    else {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setNotice({ kind: "err", text: j.error ?? `${label} failed.` });
    }
  }

  function exportCsv(rows: UserRow[]) {
    const esc = (v: string | number | null) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const head = ["Name", "Email", "Phone", "Roles", "Organisation", "Facility", "Status", "Last login", "Competency %", "Passport %"];
    const csv = [head.join(","), ...rows.map(u => [
      esc(u.name), esc(u.email), esc(u.phone), esc(u.roles.map(r => ROLE_CONFIG[r as AppRole]?.label ?? r).join("; ")),
      esc(u.organisation), esc(u.facility), esc(u.status), esc(u.lastSignIn ? new Date(u.lastSignIn).toISOString() : "never"),
      esc(u.competencyPct ?? ""), esc(u.passportPct ?? ""),
    ].join(","))].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url; a.download = `competen-users-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  }

  async function bulkAct(action: "send_reset" | "suspend" | "unsuspend", label: string) {
    const targets = users.filter(u => selected.has(u.id));
    setBusy(true); setNotice(null);
    let ok = 0;
    for (const t of targets) {
      const res = await fetch("/api/super-admin/users/actions", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: t.id, action }),
      });
      if (res.ok) ok++;
    }
    setBusy(false);
    setNotice({ kind: ok === targets.length ? "ok" : "err", text: `${label}: ${ok}/${targets.length} users.` });
    router.refresh();
  }

  async function removeUser(u: UserRow) {
    if (!window.confirm(`Permanently delete ${u.name} (${u.email})?\n\nTheir login and assessment records will be removed. This cannot be undone.`)) return;
    setBusy(true); setNotice(null);
    const res = await fetch(`/api/super-admin/users?id=${u.id}`, { method: "DELETE" });
    setBusy(false);
    if (res.ok) { setNotice({ kind: "ok", text: `Deleted ${u.name}.` }); setDrawer(null); router.refresh(); }
    else {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setNotice({ kind: "err", text: j.error ?? "Delete failed." });
    }
  }

  async function createUser() {
    setBusy(true); setNotice(null);
    const res = await fetch("/api/super-admin/users", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...addForm,
        organisation_id: addForm.organisation_id || null,
        hospital_id: addForm.hospital_id || null,
      }),
    });
    setBusy(false);
    const j = (await res.json().catch(() => ({}))) as { error?: string; tempPassword?: string | null };
    if (!res.ok) { setNotice({ kind: "err", text: j.error ?? "Failed to create user." }); return; }
    if (j.tempPassword) {
      setCreatedCreds({ email: addForm.email, password: j.tempPassword });
    } else {
      setAddOpen(false);
      setNotice({ kind: "ok", text: `Invitation sent to ${addForm.email}.` });
    }
    setAddForm({ full_name: "", email: "", role: "nurse", mode: "invite", organisation_id: "", hospital_id: "" });
    router.refresh();
  }

  const toggleSel = (id: string) => setSelected(p => {
    const n = new Set(p);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  const allShownSelected = shown.length > 0 && shown.every(u => selected.has(u.id));

  const input = "border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-500/30";
  const editorUser = drawer ? {
    id: drawer.id, full_name: drawer.name, email: drawer.email, role: drawer.role,
    roles: drawer.roles, org_role: drawer.orgRole, org_roles: drawer.orgRoles,
    hospital_id: drawer.hospitalId, organisation_id: drawer.organisationId,
    platform_role: drawer.platformRole, department_id: drawer.departmentId,
  } : null;

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">User Management</h1>
          <p className="text-gray-400 text-sm mt-0.5">Manage your platform users and workforce</p>
        </div>
        <button onClick={() => { setAddOpen(true); setCreatedCreds(null); }}
          className="text-sm font-semibold bg-teal-600 hover:bg-teal-700 text-white px-4 py-2 rounded-lg">
          + Add User
        </button>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-6">
        {STAT_CARDS.map(c => (
          <div key={c.label} className="bg-white rounded-xl border border-gray-100 p-4">
            <div className={`w-8 h-8 rounded-lg ${c.tintBg} flex items-center justify-center text-sm mb-2`}>{c.icon}</div>
            <p className="text-2xl font-bold text-gray-900">{c.count}</p>
            <p className="text-[11px] text-gray-500 font-medium">{c.label}</p>
            <p className="text-[9px] text-green-600 mt-0.5">{c.sub}</p>
          </div>
        ))}
      </div>

      {/* Search + filters */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input value={search} onChange={e => { setSearch(e.target.value); setPage(0); }}
          placeholder="Search by name, email or phone…" className={`${input} flex-1 min-w-[220px]`} />
        <select value={fRole} onChange={e => { setFRole(e.target.value); setPage(0); }} className={input}>
          <option value="all">Role: All</option>
          {Object.entries(ROLE_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        {organisations.length > 0 && (
          <select value={fOrg} onChange={e => { setFOrg(e.target.value); setPage(0); }} className={input}>
            <option value="all">Organisation: All</option>
            {organisations.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        )}
        {hospitals.length > 0 && (
          <select value={fFacility} onChange={e => { setFFacility(e.target.value); setPage(0); }} className={input}>
            <option value="all">Facility: All</option>
            {hospitals.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
          </select>
        )}
        <select value={fStatus} onChange={e => { setFStatus(e.target.value); setPage(0); }} className={input}>
          <option value="all">Status: All</option>
          <option value="active">Active</option>
          <option value="pending">Pending</option>
          <option value="suspended">Suspended</option>
        </select>
        <select value={fLogin} onChange={e => { setFLogin(e.target.value); setPage(0); }} className={input}>
          <option value="all">Last login: Any</option>
          <option value="today">Last 24 hours</option>
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
          <option value="never">Never</option>
        </select>
        {anyFilter && (
          <button onClick={() => { setSearch(""); setFRole("all"); setFOrg("all"); setFFacility("all"); setFStatus("all"); setFLogin("all"); setPage(0); }}
            className="text-xs font-semibold text-teal-600 hover:text-teal-800 px-2">Clear</button>
        )}
      </div>

      {/* Bulk bar */}
      <div className="flex flex-wrap items-center gap-3 mb-2">
        <label className="flex items-center gap-2 text-xs text-gray-500">
          <input type="checkbox" checked={allShownSelected}
            onChange={() => setSelected(allShownSelected ? new Set() : new Set(shown.map(u => u.id)))}
            className="accent-teal-600" />
          {selected.size} selected
        </label>
        <div className="relative">
          <button onClick={() => setBulkOpen(o => !o)} disabled={selected.size === 0}
            className="text-xs font-semibold text-gray-600 border border-gray-200 hover:bg-gray-50 px-3 py-1.5 rounded-lg disabled:opacity-40">
            Bulk Actions ▾
          </button>
          {bulkOpen && selected.size > 0 && (
            <>
              <div className="fixed inset-0 z-20" onClick={() => setBulkOpen(false)} />
              <div className="absolute left-0 top-8 z-30 w-52 bg-white border border-gray-100 rounded-lg shadow-lg py-1">
                <button onClick={() => { setBulkOpen(false); exportCsv(users.filter(u => selected.has(u.id))); }}
                  className="w-full text-left px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50">📥 Export selected as CSV</button>
                <button onClick={() => { setBulkOpen(false); bulkAct("send_reset", "Password reset sent"); }} disabled={busy}
                  className="w-full text-left px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50">🔑 Send password reset</button>
                <button onClick={() => {
                  setBulkOpen(false);
                  if (window.confirm(`Suspend ${selected.size} selected user(s)? They will be unable to sign in until reactivated.`)) bulkAct("suspend", "Suspended");
                }} disabled={busy}
                  className="w-full text-left px-3 py-1.5 text-xs text-red-600 hover:bg-gray-50">⛔ Suspend selected</button>
                <button onClick={() => { setBulkOpen(false); bulkAct("unsuspend", "Reactivated"); }} disabled={busy}
                  className="w-full text-left px-3 py-1.5 text-xs text-green-700 hover:bg-gray-50">✓ Reactivate selected</button>
              </div>
            </>
          )}
        </div>
        <div className="ml-auto flex items-center gap-3">
          <span className="text-xs text-gray-400">{filtered.length} user{filtered.length === 1 ? "" : "s"} found</span>
          <button onClick={() => router.refresh()} title="Refresh"
            className="text-gray-400 hover:text-gray-600 text-sm">⟳</button>
          <button onClick={() => exportCsv(filtered)} title="Export all filtered users"
            className="text-xs font-semibold text-gray-600 border border-gray-200 hover:bg-gray-50 px-3 py-1.5 rounded-lg">Export</button>
        </div>
      </div>

      {notice && (
        <p className={`text-xs rounded-lg px-3 py-2 mb-2 border ${notice.kind === "ok" ? "text-green-700 bg-green-50 border-green-100" : "text-red-600 bg-red-50 border-red-100"}`}>
          {notice.text} <button onClick={() => setNotice(null)} className="underline ml-1">dismiss</button>
        </p>
      )}

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-100 overflow-x-auto">
        <table className="w-full text-sm min-w-[900px]">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/50 text-[10px] font-bold text-gray-400 uppercase tracking-wider">
              <th className="px-4 py-3 w-8" />
              <th className="text-left px-2 py-3">User</th>
              <th className="text-left px-3 py-3">Roles</th>
              <th className="text-left px-3 py-3">Organisation / Facility</th>
              <th className="text-left px-3 py-3">Status</th>
              <th className="text-left px-3 py-3">Last Login</th>
              <th className="text-center px-3 py-3">Competency</th>
              <th className="text-center px-3 py-3">Passport</th>
              <th className="text-right px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {shown.length === 0 && (
              <tr><td colSpan={9} className="px-4 py-12 text-center text-sm text-gray-400">No users match the current filters.</td></tr>
            )}
            {shown.map(u => {
              const st = STATUS_UI[u.status];
              return (
                <tr key={u.id} className="hover:bg-gray-50/40 cursor-pointer" onClick={() => setDrawer(u)}>
                  <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                    <input type="checkbox" checked={selected.has(u.id)} onChange={() => toggleSel(u.id)} className="accent-teal-600" />
                  </td>
                  <td className="px-2 py-3">
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-full ${tint(u.id)} text-white flex items-center justify-center text-xs font-bold shrink-0`}>
                        {u.name[0]?.toUpperCase() ?? "?"}
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium text-gray-900 truncate">{u.name}</p>
                        <p className="text-[10px] text-gray-400 truncate">{u.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex flex-wrap gap-1 max-w-[180px]">
                      {u.platformRole && PLATFORM_ROLE_CONFIG[u.platformRole as PlatformRole] && (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-violet-100 text-violet-700">
                          {PLATFORM_ROLE_CONFIG[u.platformRole as PlatformRole].label}
                        </span>
                      )}
                      {u.roles.map(r => (
                        <span key={r} className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${ROLE_BADGE[r] ?? "bg-gray-100 text-gray-600"}`}>
                          {ROLE_CONFIG[r as AppRole]?.label ?? r}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-3 text-xs text-gray-500">
                    <p>{u.organisation ?? <span className="text-gray-300">—</span>}</p>
                    <p className="text-[10px] text-gray-400">{u.facility ?? "—"}</p>
                  </td>
                  <td className="px-3 py-3">
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${st.pill}`}>{st.label}</span>
                    <p className="text-[9px] text-gray-400 mt-1">{u.statusDetail}</p>
                  </td>
                  {/* Relative times drift between server render and hydration */}
                  <td className="px-3 py-3 text-xs text-gray-500" suppressHydrationWarning>{relTime(u.lastSignIn)}</td>
                  <td className="px-3 py-3 text-center"><Ring pct={u.competencyPct} /></td>
                  <td className="px-3 py-3 text-center"><Ring pct={u.passportPct} /></td>
                  <td className="px-4 py-3 text-right" onClick={e => e.stopPropagation()}>
                    <div className="relative inline-block">
                      <button onClick={() => setMenuFor(menuFor === u.id ? null : u.id)}
                        className="text-gray-300 hover:text-gray-600 px-1.5 text-sm" title="Actions">⋮</button>
                      {menuFor === u.id && (
                        <>
                          <div className="fixed inset-0 z-20" onClick={() => setMenuFor(null)} />
                          <div className="absolute right-0 top-6 z-30 w-48 bg-white border border-gray-100 rounded-lg shadow-lg py-1 text-left">
                            <button onClick={() => { setMenuFor(null); setDrawer(u); }}
                              className="w-full text-left px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50">👤 View details</button>
                            <button onClick={() => { setMenuFor(null); navigator.clipboard.writeText(u.email); setNotice({ kind: "ok", text: `Copied ${u.email}` }); }}
                              className="w-full text-left px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50">⧉ Copy email</button>
                            <button onClick={() => { setMenuFor(null); act(u.id, "send_reset", `Password reset for ${u.name}`); }}
                              className="w-full text-left px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50">🔑 Send password reset</button>
                            {u.status === "pending" && (
                              <button onClick={() => { setMenuFor(null); act(u.id, "resend_invite", `Invitation re-sent to ${u.name}`); }}
                                className="w-full text-left px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50">✉️ Resend invitation</button>
                            )}
                            {u.status === "suspended" ? (
                              <button onClick={() => { setMenuFor(null); act(u.id, "unsuspend", `Reactivated ${u.name}`); }}
                                className="w-full text-left px-3 py-1.5 text-xs text-green-700 hover:bg-gray-50">✓ Reactivate account</button>
                            ) : u.id !== currentUserId && (
                              <button onClick={() => {
                                setMenuFor(null);
                                if (window.confirm(`Suspend ${u.name}? They will be unable to sign in until reactivated.`)) act(u.id, "suspend", `Suspended ${u.name}`);
                              }}
                                className="w-full text-left px-3 py-1.5 text-xs text-red-600 hover:bg-gray-50">⛔ Suspend account</button>
                            )}
                            {u.id !== currentUserId && (
                              <button onClick={() => { setMenuFor(null); removeUser(u); }}
                                className="w-full text-left px-3 py-1.5 text-xs text-red-600 hover:bg-gray-50 border-t border-gray-50">🗑 Delete account…</button>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="flex items-center justify-end gap-2 mt-3 text-xs">
          <button disabled={page === 0} onClick={() => setPage(p => p - 1)} className="px-2 py-1 border border-gray-200 rounded disabled:opacity-40">‹ Prev</button>
          <span className="text-gray-400">Page {page + 1} of {pages}</span>
          <button disabled={page >= pages - 1} onClick={() => setPage(p => p + 1)} className="px-2 py-1 border border-gray-200 rounded disabled:opacity-40">Next ›</button>
        </div>
      )}

      {/* Legend + progress explainer */}
      <div className="grid md:grid-cols-2 gap-4 mt-6">
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest mb-3">Status legend</p>
          <div className="flex flex-col gap-2 text-xs text-gray-600">
            <p><span className="inline-block w-2 h-2 rounded-full bg-green-500 mr-2" /><b>Active</b> — user can sign in; email verified</p>
            <p><span className="inline-block w-2 h-2 rounded-full bg-amber-400 mr-2" /><b>Pending</b> — invitation sent or email not yet verified</p>
            <p><span className="inline-block w-2 h-2 rounded-full bg-red-500 mr-2" /><b>Suspended</b> — sign-in blocked until reactivated</p>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest mb-3">Progress indicators</p>
          <div className="flex flex-col gap-1.5 text-xs text-gray-600">
            <p><b>Competency</b> — share of assessed competencies decided competent or better</p>
            <p><b>Passport</b> — share of assessed competencies currently valid (not expired)</p>
            <div className="flex items-center gap-4 mt-1.5">
              <span className="flex items-center gap-1.5"><Ring pct={92} /><span className="text-[10px] text-gray-400">High (80%+)</span></span>
              <span className="flex items-center gap-1.5"><Ring pct={58} /><span className="text-[10px] text-gray-400">Medium (50–79%)</span></span>
              <span className="flex items-center gap-1.5"><Ring pct={26} /><span className="text-[10px] text-gray-400">Low (&lt;50%)</span></span>
            </div>
            <p className="text-[10px] text-gray-400 mt-1">“—” means the user has no assessment decisions yet — not 0%.</p>
          </div>
        </div>
      </div>

      {/* Add User modal */}
      {addOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setAddOpen(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            {createdCreds ? (
              <>
                <h2 className="font-bold text-gray-900 mb-1">Account created</h2>
                <p className="text-xs text-gray-500 mb-4">Share these credentials securely — the password is shown only once.</p>
                <div className="bg-gray-50 rounded-lg p-4 text-sm font-mono flex flex-col gap-1.5">
                  <p><span className="text-gray-400 text-xs">Email:</span> {createdCreds.email}</p>
                  <p><span className="text-gray-400 text-xs">Password:</span> {createdCreds.password}</p>
                </div>
                <div className="flex gap-2 mt-5">
                  <button onClick={() => navigator.clipboard.writeText(`Email: ${createdCreds.email}\nPassword: ${createdCreds.password}`)}
                    className="flex-1 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">⧉ Copy both</button>
                  <button onClick={() => { setCreatedCreds(null); setAddOpen(false); }}
                    className="flex-1 py-2 bg-teal-600 text-white rounded-lg text-sm font-semibold hover:bg-teal-700">Done</button>
                </div>
              </>
            ) : (
              <>
                <h2 className="font-bold text-gray-900 mb-4">Add User</h2>
                <div className="flex flex-col gap-3">
                  <div>
                    <label className="text-xs font-semibold text-gray-500 mb-1 block">Full name *</label>
                    <input value={addForm.full_name} onChange={e => setAddForm(p => ({ ...p, full_name: e.target.value }))}
                      placeholder="e.g. Jane Achieng" className={`${input} w-full`} />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-gray-500 mb-1 block">Email *</label>
                    <input value={addForm.email} onChange={e => setAddForm(p => ({ ...p, email: e.target.value }))}
                      placeholder="name@hospital.org" type="email" className={`${input} w-full`} />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-gray-500 mb-1 block">Portal role *</label>
                    <select value={addForm.role} onChange={e => setAddForm(p => ({ ...p, role: e.target.value }))} className={`${input} w-full`}>
                      {Object.entries(ROLE_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
                    </select>
                    <p className="text-[10px] text-gray-400 mt-1">Fine-grained org roles can be set afterwards via Edit in the user drawer.</p>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-xs font-semibold text-gray-500 mb-1 block">Organisation</label>
                      <select value={addForm.organisation_id} onChange={e => setAddForm(p => ({ ...p, organisation_id: e.target.value }))} className={`${input} w-full`}>
                        <option value="">—</option>
                        {organisations.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-gray-500 mb-1 block">Facility</label>
                      <select value={addForm.hospital_id} onChange={e => setAddForm(p => ({ ...p, hospital_id: e.target.value }))} className={`${input} w-full`}>
                        <option value="">—</option>
                        {hospitals.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-gray-500 mb-1 block">Access</label>
                    <div className="flex flex-col gap-1.5 text-xs text-gray-600">
                      <label className="flex items-center gap-2">
                        <input type="radio" checked={addForm.mode === "invite"} onChange={() => setAddForm(p => ({ ...p, mode: "invite" }))} className="accent-teal-600" />
                        Send invitation email — they set their own password
                      </label>
                      <label className="flex items-center gap-2">
                        <input type="radio" checked={addForm.mode === "password"} onChange={() => setAddForm(p => ({ ...p, mode: "password" }))} className="accent-teal-600" />
                        Create with a temporary password — shown to you once
                      </label>
                    </div>
                  </div>
                </div>
                <div className="flex gap-2 mt-5">
                  <button onClick={() => setAddOpen(false)}
                    className="flex-1 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
                  <button onClick={createUser} disabled={busy || !addForm.full_name.trim() || !/.+@.+\..+/.test(addForm.email)}
                    className="flex-1 py-2 bg-teal-600 text-white rounded-lg text-sm font-semibold hover:bg-teal-700 disabled:opacity-50">
                    {busy ? "Creating…" : addForm.mode === "invite" ? "Send Invitation" : "Create Account"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Quick-view drawer */}
      {drawer && editorUser && (
        <div className="fixed inset-0 z-40">
          <div className="absolute inset-0 bg-black/30" onClick={() => setDrawer(null)} />
          <div className="absolute right-0 top-0 h-full w-full max-w-md bg-white shadow-2xl overflow-y-auto">
            <div className="p-5 border-b border-gray-100 flex items-start gap-3">
              <div className={`w-11 h-11 rounded-full ${tint(drawer.id)} text-white flex items-center justify-center text-base font-bold shrink-0`}>
                {drawer.name[0]?.toUpperCase() ?? "?"}
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-bold text-gray-900">{drawer.name}</p>
                <p className="text-xs text-gray-400 truncate">{drawer.email}</p>
                <span className={`inline-block mt-1.5 text-[9px] font-bold px-1.5 py-0.5 rounded ${STATUS_UI[drawer.status].pill}`}>
                  {STATUS_UI[drawer.status].label} · {drawer.statusDetail}
                </span>
              </div>
              <button onClick={() => setDrawer(null)} className="text-gray-300 hover:text-gray-500">✕</button>
            </div>

            <div className="p-5 grid grid-cols-2 gap-3 text-xs border-b border-gray-50">
              {[
                ["Phone", drawer.phone ?? "—"],
                ["Last login", relTime(drawer.lastSignIn)],
                ["Organisation", drawer.organisation ?? "—"],
                ["Facility", drawer.facility ?? "—"],
                ["Department", drawer.department ?? "—"],
                ["Specialization", drawer.specialization ?? "—"],
                ["Joined", new Date(drawer.joinedAt).toLocaleDateString()],
                ["Active authorizations", String(drawer.activeAuthorizations)],
              ].map(([k, v]) => (
                <div key={k}>
                  <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">{k}</p>
                  <p className="text-gray-700 mt-0.5" suppressHydrationWarning>{v}</p>
                </div>
              ))}
            </div>

            <div className="p-5 border-b border-gray-50">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">Roles & access</p>
                <UserRoleEditor
                  user={editorUser}
                  hospitals={hospitals} organisations={organisations} departments={departments}
                  onSaved={() => { setDrawer(null); router.refresh(); }}
                />
              </div>
              <div className="flex flex-wrap gap-1">
                {drawer.platformRole && PLATFORM_ROLE_CONFIG[drawer.platformRole as PlatformRole] && (
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-violet-100 text-violet-700">
                    {PLATFORM_ROLE_CONFIG[drawer.platformRole as PlatformRole].icon} {PLATFORM_ROLE_CONFIG[drawer.platformRole as PlatformRole].label}
                  </span>
                )}
                {(drawer.orgRoles ?? []).filter(r => ORG_ROLE_CONFIG[r as OrgRole]).map(r => (
                  <span key={r} className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">
                    {ORG_ROLE_CONFIG[r as OrgRole].icon} {ORG_ROLE_CONFIG[r as OrgRole].label}
                  </span>
                ))}
                {drawer.roles.map(r => (
                  <span key={r} className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${ROLE_BADGE[r] ?? "bg-gray-100 text-gray-600"}`}>
                    {ROLE_CONFIG[r as AppRole]?.icon} {ROLE_CONFIG[r as AppRole]?.label ?? r}
                  </span>
                ))}
              </div>
            </div>

            <div className="p-5 border-b border-gray-50">
              <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest mb-3">Competency readiness</p>
              <div className="flex items-center gap-6">
                <div className="text-center">
                  <Ring pct={drawer.competencyPct} />
                  <p className="text-[9px] text-gray-400 mt-1">Competency</p>
                </div>
                <div className="text-center">
                  <Ring pct={drawer.passportPct} />
                  <p className="text-[9px] text-gray-400 mt-1">Passport</p>
                </div>
                <div className="text-xs text-gray-500 flex-1">
                  {drawer.decisionsTotal > 0
                    ? <>{drawer.decisionsOk}/{drawer.decisionsTotal} competencies decided competent; {drawer.decisionsCurrent} currently valid.</>
                    : <>No assessment decisions recorded yet.</>}
                </div>
              </div>
            </div>

            <div className="p-5">
              <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest mb-3">Audit history (their actions)</p>
              {(auditByActor[drawer.id] ?? []).length === 0
                ? <p className="text-xs text-gray-400">No audited actions by this user yet.</p>
                : (
                  <div className="flex flex-col gap-2">
                    {(auditByActor[drawer.id] ?? []).map(e => (
                      <div key={e.id} className="text-xs border-l-2 border-gray-100 pl-3">
                        <p className="text-gray-700">
                          <span className="font-medium">{e.action.replace(/_/g, " ")}</span>
                          {e.entityName ? <> — {e.entityName}</> : null}
                        </p>
                        <p className="text-[9px] text-gray-400" suppressHydrationWarning>{new Date(e.at).toLocaleString()}{e.entityType ? ` · ${e.entityType}` : ""}</p>
                      </div>
                    ))}
                  </div>
                )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
