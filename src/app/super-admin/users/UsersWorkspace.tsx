"use client";

import { useState, useCallback, useEffect, useRef, useTransition } from "react";
import { useDismiss } from "@/components/ui/use-dismiss";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import {
  ACCOUNT_TYPES, ACCOUNT_TYPE_LABEL, USER_VIEWS, USER_VIEW_LABEL, USER_VIEW_RULE,
  type AccountType, type UserView,
} from "@/lib/hq/account-classification";
import { parseUserParam, toQueryString, withUserParam, type DirectoryFilters, type DirectoryStats } from "@/lib/hq/user-directory-query";
import { usersCsv } from "@/lib/hq/users-csv";
import { ROLE_CONFIG } from "@/lib/roles";
import AddUserDialog from "./AddUserDialog";
import { Modal } from "@/components/ui/interactive";
import type { Access, Readable } from "@/lib/hq/user-directory";
import { PARTICIPATION_CATEGORIES, PARTICIPATION_LABEL } from "@/lib/hq/account-participation";
import UsersTable from "./UsersTable";
import UserDetailWorkspace from "./UserDetailWorkspace";

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
  /** HQ-USERS-C: what the person can reach, from the rows the gates read (src/lib/hq/user-directory.ts). */
  access: Access;
  products: string[];
  hqActive: boolean;
  /** HQ-USERS-CLASSIFY-01: an administrative label for filtering and reporting. It decides no access. */
  accountType: AccountType;
  /** Live Competen Individual entitlements with their end dates (individual_live_entitlement), not inferred from roles. */
  entitlements: { experience: string; endsAt: string | null }[];
  /** Live experiences while the Individual membership is active: what the Scholar / Professional filter matches. */
  experiences: string[];
  /** hq_account_participation.category and end (migration 850), or null: a label that decides no access. */
  participation: string | null;
  participationUntil: string | null;
};

export default function UsersWorkspace({
  users, total, page, pages, viewCounts, filters, defaultView, classificationAvailable, participationAvailable, focusUser, stats,
  hospitals, organisations, departments, currentUserId, canManage, canReset, readable, authComplete,
}: {
  /** HQ-USERS-CLASSIFY-01: ONE page, filtered and paginated on the server. */
  users: UserRow[];
  total: number;
  page: number;
  pages: number;
  viewCounts: Record<UserView, number>;
  filters: DirectoryFilters;
  defaultView: UserView;
  /** False while migration 650 is absent: every account reads Unclassified and nothing can be classified. */
  classificationAvailable: boolean;
  /** False while migration 850 is absent: the access-category filter is hidden and the profile says so. */
  participationAvailable: boolean;
  /** The person ?user= names, when the current page does not list them (a shared link). */
  focusUser: UserRow | null;
  /** The stat cards, counted over the selected account view (named on screen). */
  stats: DirectoryStats;
  hospitals: { id: string; name: string; country: string }[];
  organisations: { id: string; name: string }[];
  departments: { id: string; name: string; hospital_id: string }[];
  currentUserId: string;
  /** HQ-USERS-A: the caller is a platform owner. Account writes are owner-only on the server; a viewer
   *  holding hq.platform.users.view sees the directory without controls that would only be refused. */
  canManage: boolean;
  /** HQ-USERS-B: the caller may send password-reset emails (an owner, or hq.platform.users.reset). */
  canReset: boolean;
  /** HQ-USERS-C: which access sources answered. A false one is shown as "not readable", never as "none". */
  readable: Readable;
  /** HQ-USERS-C: every Auth page was read. False means last sign-in and status may be missing for some. */
  authComplete: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [navigating, startNav] = useTransition();
  // HQ-USERS-CLASSIFY-01: the URL is the query. A filter change navigates, and the server answers one page.
  const queryKey = toQueryString(filters, defaultView);
  // The open profile is ?user=<id>. Opening and closing it changes the URL only (history.pushState, which the Next
  // router follows), so this list stays mounted: search, filters, selection and scroll position are exactly where the
  // person left them, and a direct link opens the person.
  const searchParams = useSearchParams();
  const openId = parseUserParam({ user: searchParams.get("user") ?? undefined });
  const pushedByUs = useRef(false);
  useEffect(() => { if (!openId) pushedByUs.current = false; }, [openId]);
  const hrefFor = useCallback((id: string | null) => withUserParam(pathname, queryKey, id), [pathname, queryKey]);
  const openProfile = useCallback((id: string) => { window.history.pushState(null, "", hrefFor(id)); pushedByUs.current = true; }, [hrefFor]);
  const closeProfile = useCallback(() => {
    // Back to the entry we came from when we made it, so the Back button and the close button agree.
    if (pushedByUs.current) { pushedByUs.current = false; window.history.back(); }
    else window.history.replaceState(null, "", hrefFor(null));
  }, [hrefFor]);
  const go = useCallback((patch: Partial<DirectoryFilters>) => {
    const qs = toQueryString({ ...filters, page: 0, ...patch }, defaultView);
    startNav(() => router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  }, [filters, defaultView, pathname, router]);
  // Search is typed, so it waits for a pause before asking the server.
  const [search, setSearch] = useState(filters.q);
  useEffect(() => {
    if (search.trim() === filters.q.trim()) return;
    const t = setTimeout(() => go({ q: search }), 350);
    return () => clearTimeout(t);
  }, [search, filters.q, go]);
  // A selection belongs to the page it was made on: a new query starts with nothing selected, so a bulk action
  // only ever touches rows the person can see.
  const [sel, setSel] = useState<{ key: string; ids: Set<string> }>({ key: queryKey, ids: new Set() });
  const selected = sel.key === queryKey ? sel.ids : new Set<string>();
  const setSelected = (ids: Set<string> | ((p: Set<string>) => Set<string>)) =>
    setSel(prev => ({ key: queryKey, ids: typeof ids === "function" ? ids(prev.key === queryKey ? prev.ids : new Set()) : ids }));
  const [classifyOpen, setClassifyOpen] = useState(false);
  const [classifyForm, setClassifyForm] = useState<{ type: AccountType; reason: string }>({ type: "human", reason: "" });
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);

  // Escape closes these menus and returns focus. No trigger ref for the row menu: it is one per row, and
  // the hook's fallback -- whatever had focus when the menu opened -- IS the row's own ... button.
  // useCallback matters here: a fresh closure each render would re-run the effect and pull focus back
  // mid-interaction.
  const closeRowMenu = useCallback(() => setMenuFor(null), []);
  const closeBulkMenu = useCallback(() => setBulkOpen(false), []);
  useDismiss(menuFor !== null, closeRowMenu);
  useDismiss(bulkOpen, closeBulkMenu);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const anyFilter = !!filters.q || (["role", "org", "facility", "status", "login", "product", "hq", "access"] as const).some(k => filters[k] !== "all");
  const shown = users;
  const openRow = openId ? users.find(u => u.id === openId) ?? (focusUser?.id === openId ? focusUser : null) : null;
  const viewName = USER_VIEW_LABEL[filters.view];

  // The stat cards count the SELECTED VIEW, and the first card says which view, with every account beside it, so
  // a figure reported before classification is still on the screen rather than silently replaced.
  const cardFor = (portal: string) => {
    const s = stats.byRole[portal] ?? { count: 0, active: 0 };
    return { count: s.count, sub: s.count ? `${Math.round((s.active / s.count) * 100)}% active` : "none yet" };
  };
  const STAT_CARDS = [
    { label: `Users · ${viewName}`, icon: "👥", tintBg: "bg-[var(--cmp-surface-information)]", count: stats.total, sub: `${stats.active} active · ${viewCounts.all} accounts in all` },
    { label: "Super Admins", icon: "🛡️", tintBg: "bg-[var(--cmp-surface-error)]", ...cardFor("super_admin") },
    { label: "Admins", icon: "🏛️", tintBg: "bg-[var(--cmp-surface-warning)]", ...cardFor("hospital_admin") },
    { label: "Educators", icon: "🎓", tintBg: "bg-purple-50", ...cardFor("educator") },
    { label: "Assessors", icon: "🩺", tintBg: "bg-indigo-50", ...cardFor("assessor") },
    { label: "Healthcare Workers", icon: "🧑‍⚕️", tintBg: "bg-teal-50", ...cardFor("nurse") },
  ];

  // HQ-USERS-B: a reset goes to its own governed route; the other account actions stay owner-only.
  const request = (userId: string, action: "suspend" | "unsuspend" | "send_reset" | "resend_invite") =>
    action === "send_reset"
      ? fetch("/api/super-admin/users/reset", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId }) })
      : fetch("/api/super-admin/users/actions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId, action }) });

  async function act(userId: string, action: "suspend" | "unsuspend" | "send_reset" | "resend_invite", label: string) {
    setBusy(true); setNotice(null);
    const res = await request(userId, action);
    setBusy(false);
    // A reset answers with the same sentence whatever the account's state (no enumeration), so say exactly that.
    if (res.ok && action === "send_reset") { const j = (await res.json().catch(() => ({}))) as { message?: string }; setNotice({ kind: "ok", text: j.message ?? "Reset requested." }); }
    else if (res.ok) { setNotice({ kind: "ok", text: `${label} — done.` }); router.refresh(); }
    else {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setNotice({ kind: "err", text: j.error ?? `${label} failed.` });
    }
  }

  function exportCsv(rows: UserRow[]) {
    const url = URL.createObjectURL(new Blob([usersCsv(rows)], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url; a.download = `competen-users-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  }

  // HQ-USERS-CLASSIFY-01: one request for the whole selection. The server re-checks the owner gate, and every
  // change writes its own audit row (before, after, who, when, reason) in the same transaction.
  async function classifySelected() {
    setBusy(true); setNotice(null);
    const res = await fetch("/api/super-admin/users/classification", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "classify", userIds: [...selected], accountType: classifyForm.type, reason: classifyForm.reason }),
    });
    setBusy(false);
    const j = (await res.json().catch(() => ({}))) as { error?: string; changed?: number; unchanged?: number };
    if (!res.ok) { setNotice({ kind: "err", text: j.error ?? "Classification failed." }); return; }
    setClassifyOpen(false); setClassifyForm(f => ({ ...f, reason: "" })); setSelected(new Set());
    setNotice({ kind: "ok", text: `Classified ${j.changed ?? 0} account(s) as ${ACCOUNT_TYPE_LABEL[classifyForm.type]}${j.unchanged ? ` · ${j.unchanged} already were` : ""}.` });
    router.refresh();
  }

  async function makeDefaultView() {
    setBusy(true); setNotice(null);
    const res = await fetch("/api/super-admin/users/classification", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "set_default_view", view: filters.view }),
    });
    setBusy(false);
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) { setNotice({ kind: "err", text: j.error ?? "Could not change the default view." }); return; }
    setNotice({ kind: "ok", text: `${viewName} is now the default view for everyone opening User Management.` });
    startNav(() => router.push(pathname, { scroll: false }));
  }

  async function bulkAct(action: "send_reset" | "suspend" | "unsuspend", label: string) {
    const targets = users.filter(u => selected.has(u.id));
    setBusy(true); setNotice(null);
    let ok = 0;
    for (const t of targets) {
      const res = await request(t.id, action);
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
    if (res.ok) { setNotice({ kind: "ok", text: `Deleted ${u.name}.` }); closeProfile(); router.refresh(); }
    else {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setNotice({ kind: "err", text: j.error ?? "Delete failed." });
    }
  }

  const toggleSel = (id: string) => setSelected(p => {
    const n = new Set(p);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  const allShownSelected = shown.length > 0 && shown.every(u => selected.has(u.id));

  const input = "border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-500/30";
  // The row actions menu (copy, reset, resend, suspend, delete). View details moved to the table's own link.
  const renderRowMenu = (u: UserRow) => (
    <div className="relative inline-block">
      <button onClick={() => setMenuFor(menuFor === u.id ? null : u.id)} aria-label={`More actions for ${u.name}`} aria-expanded={menuFor === u.id}
        className="text-gray-500 hover:text-gray-600 px-1.5 text-sm pointer-coarse:min-h-[var(--cmp-touch-min)] pointer-coarse:min-w-[var(--cmp-touch-min)]" title="Actions">⋮</button>
      {menuFor === u.id && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setMenuFor(null)} />
          <div className="absolute right-0 top-6 z-30 w-48 bg-white border border-gray-100 rounded-lg shadow-lg py-1 text-left">
            <button onClick={() => { setMenuFor(null); openProfile(u.id); }}
              className="w-full text-left px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50">👤 View details</button>
            <button onClick={() => { setMenuFor(null); navigator.clipboard.writeText(u.email); setNotice({ kind: "ok", text: `Copied ${u.email}` }); }}
              className="w-full text-left px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50">⧉ Copy email</button>
            {canReset && u.id !== currentUserId && (
            <button onClick={() => { setMenuFor(null); act(u.id, "send_reset", `Password reset for ${u.name}`); }}
              className="w-full text-left px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50">🔑 Send password reset</button>
            )}
            {canManage && <>
            {u.status === "pending" && (
              <button onClick={() => { setMenuFor(null); act(u.id, "resend_invite", `Invitation re-sent to ${u.name}`); }}
                className="w-full text-left px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50">✉️ Resend invitation</button>
            )}
            {u.status === "suspended" ? (
              <button onClick={() => { setMenuFor(null); act(u.id, "unsuspend", `Reactivated ${u.name}`); }}
                className="w-full text-left px-3 py-1.5 text-xs text-[var(--cmp-text-success)] hover:bg-gray-50">✓ Reactivate account</button>
            ) : u.id !== currentUserId && (
              <button onClick={() => {
                setMenuFor(null);
                if (window.confirm(`Suspend ${u.name}? They will be unable to sign in until reactivated.`)) act(u.id, "suspend", `Suspended ${u.name}`);
              }}
                className="w-full text-left px-3 py-1.5 text-xs text-[var(--cmp-text-critical)] hover:bg-gray-50">⛔ Suspend account</button>
            )}
            {u.id !== currentUserId && (
              <button onClick={() => { setMenuFor(null); removeUser(u); }}
                className="w-full text-left px-3 py-1.5 text-xs text-[var(--cmp-text-critical)] hover:bg-gray-50 border-t border-gray-50">🗑 Delete account…</button>
            )}
            </>}
          </div>
        </>
      )}
    </div>
  );

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">User Management</h1>
          <p className="text-gray-500 text-sm mt-0.5">Manage your platform users and workforce</p>
        </div>
        {canManage && (
          <button onClick={() => { setAddOpen(true); }}
            className="text-sm font-semibold bg-teal-700 hover:bg-teal-800 text-white px-4 py-2 rounded-lg">
            + Add User
          </button>
        )}
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-6">
        {STAT_CARDS.map(c => (
          <div key={c.label} className="bg-white rounded-xl border border-gray-100 p-4">
            <div className={`w-8 h-8 rounded-lg ${c.tintBg} flex items-center justify-center text-sm mb-2`}>{c.icon}</div>
            <p className="text-2xl font-bold text-gray-900">{c.count}</p>
            <p className="text-[11px] text-gray-500 font-medium">{c.label}</p>
            <p className="text-[9px] text-[var(--cmp-text-success)] mt-0.5">{c.sub}</p>
          </div>
        ))}
      </div>

      {/* HQ-USERS-CLASSIFY-01: account views. Each count is the number of accounts that view would show under the
          other filters below; the rule each view applies is stated, not implied. */}
      <nav aria-label="Account views" className="mb-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {USER_VIEWS.map(v => {
            const on = filters.view === v;
            return (
              <button key={v} onClick={() => go({ view: v })} aria-pressed={on} title={USER_VIEW_RULE[v]}
                className={`text-xs font-semibold px-3 py-1.5 rounded-full border ${on ? "bg-teal-700 border-teal-700 text-white" : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"}`}>
                {USER_VIEW_LABEL[v]}{v === defaultView ? " (default)" : ""}
                <span className={`ml-1.5 tabular-nums ${on ? "text-teal-100" : "text-gray-500"}`}>{viewCounts[v]}</span>
              </button>
            );
          })}
        </div>
        <p className="text-[11px] text-gray-500 mt-1.5">
          Showing <b>{viewName}</b>: {USER_VIEW_RULE[filters.view]}.
          {canManage && classificationAvailable && filters.view !== defaultView && (
            <button onClick={makeDefaultView} disabled={busy} className="ml-2 font-semibold text-teal-700 hover:text-teal-900 underline disabled:opacity-50">
              Make {viewName} the default view
            </button>
          )}
        </p>
        {!classificationAvailable && (
          <p role="status" className="text-xs rounded-lg px-3 py-2 mt-2 border text-[var(--cmp-text-warning)] bg-[var(--cmp-surface-warning)] border-[var(--cmp-color-warning)]">
            Account classification is not available yet (migration 650 is not applied), so every account reads Unclassified and the screen opens on All Accounts.
          </p>
        )}
      </nav>

      {/* Search + filters */}
      <div className="flex flex-wrap items-center gap-2 mb-4" aria-busy={navigating}>
        <input value={search} onChange={e => setSearch(e.target.value)} aria-label="Search users"
          placeholder="Search by name, email or phone…" className={`${input} flex-1 min-w-[220px]`} />
        <select value={filters.role} onChange={e => go({ role: e.target.value })} className={input} aria-label="Filter by role">
          <option value="all">Role: All</option>
          {Object.entries(ROLE_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        {organisations.length > 0 && (
          <select value={filters.org} onChange={e => go({ org: e.target.value })} className={input} aria-label="Filter by organisation">
            <option value="all">Organisation: All</option>
            {organisations.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        )}
        {hospitals.length > 0 && (
          <select value={filters.facility} onChange={e => go({ facility: e.target.value })} className={input} aria-label="Filter by facility">
            <option value="all">Facility: All</option>
            {hospitals.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
          </select>
        )}
        <select value={filters.status} onChange={e => go({ status: e.target.value })} className={input} aria-label="Filter by status">
          <option value="all">Status: All</option>
          <option value="active">Active</option>
          <option value="pending">Invited</option>
          <option value="suspended">Suspended</option>
        </select>
        <select value={filters.login} onChange={e => go({ login: e.target.value })} className={input} aria-label="Filter by last login">
          <option value="all">Last login: Any</option>
          <option value="today">Last 24 hours</option>
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
          <option value="never">Never</option>
        </select>
        <select value={filters.product} onChange={e => go({ product: e.target.value })} className={input} aria-label="Filter by product access">
          <option value="all">Product: Any</option>
          <option value="platform">Platform</option>
          <option value="enterprise">Enterprise</option>
          <option value="practice">Practice</option>
          <option value="individual">Individual</option>
          <option value="scholar">Scholar (live)</option>
          <option value="professional">Professional (live)</option>
          <option value="none">No active product</option>
        </select>
        {/* hq_account_participation (migration 850). Hidden while the table is absent. */}
        {participationAvailable && (
          <select value={filters.access} onChange={e => go({ access: e.target.value })} className={input} aria-label="Filter by access category">
            <option value="all">Access category: Any</option>
            {PARTICIPATION_CATEGORIES.map(c => <option key={c} value={c}>{PARTICIPATION_LABEL[c]}</option>)}
            <option value="unset">No category set</option>
          </select>
        )}
        <select value={filters.hq} onChange={e => go({ hq: e.target.value })} className={input} aria-label="Filter by HQ position">
          <option value="all">HQ position: Any</option>
          <option value="yes">Holds an HQ position</option>
          <option value="no">No HQ position</option>
        </select>
        {anyFilter && (
          <button onClick={() => { setSearch(""); go({ q: "", role: "all", org: "all", facility: "all", status: "all", login: "all", product: "all", hq: "all", access: "all" }); }}
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
                {canReset && (
                <button onClick={() => { setBulkOpen(false); bulkAct("send_reset", "Password reset requested (each account that can receive one is emailed)"); }} disabled={busy}
                  className="w-full text-left px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50">🔑 Send password reset</button>
                )}
                {canManage && classificationAvailable && (
                <button onClick={() => { setBulkOpen(false); setClassifyOpen(true); }} disabled={busy}
                  className="w-full text-left px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50">🏷 Classify selected…</button>
                )}
                {canManage && <>
                <button onClick={() => {
                  setBulkOpen(false);
                  if (window.confirm(`Suspend ${selected.size} selected user(s)? They will be unable to sign in until reactivated.`)) bulkAct("suspend", "Suspended");
                }} disabled={busy}
                  className="w-full text-left px-3 py-1.5 text-xs text-[var(--cmp-text-critical)] hover:bg-gray-50">⛔ Suspend selected</button>
                <button onClick={() => { setBulkOpen(false); bulkAct("unsuspend", "Reactivated"); }} disabled={busy}
                  className="w-full text-left px-3 py-1.5 text-xs text-[var(--cmp-text-success)] hover:bg-gray-50">✓ Reactivate selected</button>
                </>}
              </div>
            </>
          )}
        </div>
        <div className="ml-auto flex items-center gap-3">
          <span className="text-xs text-gray-500" role="status">{navigating ? "Loading…" : `${total} user${total === 1 ? "" : "s"} found`}</span>
          <button onClick={() => router.refresh()} title="Refresh"
            className="text-gray-500 hover:text-gray-600 text-sm">⟳</button>
          {/* The export runs the same query on the server, so it carries every matching row, not this page. */}
          <a href={`/api/super-admin/users/export${queryKey ? `?${queryKey}` : ""}`} title="Export all filtered users"
            className="text-xs font-semibold text-gray-600 border border-gray-200 hover:bg-gray-50 px-3 py-1.5 rounded-lg">Export</a>
        </div>
      </div>

      {(!authComplete || Object.values(readable).some(v => !v)) && (
        <p role="status" className="text-xs rounded-lg px-3 py-2 mb-2 border text-[var(--cmp-text-warning)] bg-[var(--cmp-surface-warning)] border-[var(--cmp-color-warning)]">
          Part of this directory could not be read just now:{" "}
          {[!authComplete && "sign-in records", ...Object.entries(readable).filter(([, v]) => !v).map(([k]) => `${k} access`)].filter(Boolean).join(", ")}.
          Those columns say &ldquo;Not readable&rdquo; rather than showing nothing.
        </p>
      )}

      {notice && (
        <p className={`text-xs rounded-lg px-3 py-2 mb-2 border ${notice.kind === "ok" ? "text-[var(--cmp-text-success)] bg-[var(--cmp-surface-success)] border-[var(--cmp-color-success)]" : "text-[var(--cmp-text-critical)] bg-[var(--cmp-surface-critical)] border-[var(--cmp-color-critical)]"}`}>
          {notice.text} <button onClick={() => setNotice(null)} className="underline ml-1">dismiss</button>
        </p>
      )}

      {/* The list: a table from md up, compact cards below. The name and View details open the profile in place. */}
      <UsersTable
        rows={shown}
        selected={selected}
        onToggle={toggleSel}
        hrefFor={hrefFor}
        onOpen={openProfile}
        readable={readable}
        renderMenu={renderRowMenu}
        empty={(filters.view === "active_humans" || filters.view === "all_humans") && viewCounts.all_humans === 0 && classificationAvailable ? (
          <>No account has been classified Human yet. Accounts stay Unclassified until someone reviews them.{" "}
            <button onClick={() => go({ view: "unclassified" })} className="font-semibold text-teal-700 underline">Review Unclassified ({viewCounts.unclassified})</button></>
        ) : "No users match the current filters."}
      />

      {pages > 1 && (
        <div className="flex items-center justify-end gap-2 mt-3 text-xs">
          <button disabled={page === 0 || navigating} onClick={() => go({ ...filters, page: page - 1 })} className="px-2 py-1 border border-gray-200 rounded disabled:opacity-40">‹ Prev</button>
          <span className="text-gray-500">Page {page + 1} of {pages}</span>
          <button disabled={page >= pages - 1 || navigating} onClick={() => go({ ...filters, page: page + 1 })} className="px-2 py-1 border border-gray-200 rounded disabled:opacity-40">Next ›</button>
        </div>
      )}

      {/* Legend + progress explainer */}
      <div className="grid md:grid-cols-2 gap-4 mt-6">
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <p className="text-[9px] font-bold text-gray-500 uppercase tracking-widest mb-3">Status legend</p>
          <div className="flex flex-col gap-2 text-xs text-gray-600">
            <p><span className="inline-block w-2 h-2 rounded-full bg-[var(--cmp-color-success)] mr-2" /><b>Active</b> — user can sign in; email verified</p>
            <p><span className="inline-block w-2 h-2 rounded-full bg-[var(--cmp-color-warning)] mr-2" /><b>Invited</b> — invitation sent or email not yet verified</p>
            <p><span className="inline-block w-2 h-2 rounded-full bg-[var(--cmp-color-critical)] mr-2" /><b>Suspended</b> — sign-in blocked until reactivated</p>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <p className="text-[9px] font-bold text-gray-500 uppercase tracking-widest mb-3">Reading the columns</p>
          <div className="flex flex-col gap-1.5 text-xs text-gray-600">
            <p><b>Products</b> — what the person can actually use now: live Scholar and Professional periods with their end dates, and active Platform, Enterprise and Practice seats. A role never appears here as access.</p>
            <p><b>Roles &amp; appointments</b> — the roles on the account and any active HQ position.</p>
            <p><b>Account type</b> — an administrative label. It grants no access.</p>
            <p className="text-[10px] text-gray-500 mt-1">Competency, Passport, account history and the audit trail are in the profile. Open it from the name or View details.</p>
          </div>
        </div>
      </div>

      {/* HQ-USERS-CLASSIFY-01: bulk classification. An administrative label only: it changes no sign-in, entitlement,
          appointment, seat, record or relationship, and the dialog says so before anything is sent. */}
      {classifyOpen && (
        <Modal open title={`Classify ${selected.size} account${selected.size === 1 ? "" : "s"}`} onClose={() => setClassifyOpen(false)} initialIndex={1}>
          <div className="space-y-3 text-sm">
            <div>
              <label htmlFor="classify-type" className="text-xs font-semibold text-gray-500 mb-1 block">Account type</label>
              <select id="classify-type" value={classifyForm.type} onChange={e => setClassifyForm(f => ({ ...f, type: e.target.value as AccountType }))} className={`${input} w-full`}>
                {ACCOUNT_TYPES.map(t => <option key={t} value={t}>{ACCOUNT_TYPE_LABEL[t]}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="classify-reason" className="text-xs font-semibold text-gray-500 mb-1 block">Reason (recorded in the audit trail)</label>
              <textarea id="classify-reason" value={classifyForm.reason} maxLength={500} rows={3}
                onChange={e => setClassifyForm(f => ({ ...f, reason: e.target.value }))}
                placeholder="What you checked, e.g. confirmed with the facility that these are staff"
                className={`${input} w-full`} />
            </div>
            <p className="text-xs text-gray-500">
              Classification is used for filtering and reporting only. It does not change sign-in, product access, HQ positions,
              governance seats, competency records, Passport, learning or relationships.
            </p>
            <ul className="max-h-32 overflow-y-auto text-xs text-gray-600 border border-gray-100 rounded-lg p-2">
              {users.filter(u => selected.has(u.id)).map(u => (
                <li key={u.id}>{u.name} · {u.email} · now {ACCOUNT_TYPE_LABEL[u.accountType]}</li>
              ))}
            </ul>
          </div>
          <div className="flex gap-2 mt-5">
            <button onClick={() => setClassifyOpen(false)} className="flex-1 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
            <button onClick={classifySelected} disabled={busy || !classifyForm.reason.trim() || selected.size === 0}
              className="flex-1 py-2 bg-teal-700 text-white rounded-lg text-sm font-semibold hover:bg-teal-800 disabled:opacity-50">
              {busy ? "Saving…" : `Classify as ${ACCOUNT_TYPE_LABEL[classifyForm.type]}`}
            </button>
          </div>
        </Modal>
      )}

      {/* Add User: its own component (AddUserDialog.tsx), so the directory and the dialog change independently. */}
      <AddUserDialog open={addOpen} onClose={() => setAddOpen(false)} organisations={organisations} hospitals={hospitals}
        onNotice={setNotice} onCreated={() => router.refresh()} />

      {/* The profile. Its own loader reads the person's detail when it opens; the list behind it is untouched. */}
      {openRow && (
        <UserDetailWorkspace
          key={openRow.id}
          user={openRow}
          canManage={canManage}
          canReset={canReset}
          currentUserId={currentUserId}
          hospitals={hospitals}
          organisations={organisations}
          departments={departments}
          classificationAvailable={classificationAvailable}
          readable={readable}
          participationAvailable={participationAvailable}
          onClose={closeProfile}
          onChanged={() => router.refresh()}
          onDelete={removeUser}
        />
      )}
      {openId && !openRow && (
        <p role="status" className="fixed bottom-4 left-1/2 z-[70] -translate-x-1/2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-xs text-gray-700 shadow-lg">
          That person was not found. <button onClick={closeProfile} className="ml-1 font-semibold text-teal-700 underline">Close</button>
        </p>
      )}
    </div>
  );
}
