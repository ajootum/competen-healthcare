import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadOrgAdminDashboard } from "@/lib/org-admin-data";

export const dynamic = "force-dynamic";

// Organisation Administration Dashboard (ADM-001).
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200 p-5";
const titleCase = (s: string) => s.split(/[_\s]+/).filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(" ");
const intDot: Record<string, string> = { live: "bg-green-500", native: "bg-teal-400", off: "bg-gray-300" };

function Kpi({ n, label, sub, href, tone }: { n: any; label: string; sub?: string; href?: string; tone?: string }) {
  const inner = (
    <div className={`${card} ${href ? "hover:border-teal-300 transition-colors" : ""}`}>
      <div className={`text-3xl font-bold tabular-nums ${tone ?? "text-gray-900"}`}>{n}</div>
      <div className="text-xs text-gray-500 mt-1">{label}</div>
      {sub && <div className="text-[11px] text-gray-400 mt-0.5">{sub}</div>}
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

export default async function OrgAdminDashboard() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("full_name, role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some(r => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");

  const d = await loadOrgAdminDashboard(admin, profile?.hospital_id ?? null, roles.includes("super_admin"));
  const { summary, facilities, roleBars, templates, audit, integrations, integrationHealth, users } = d;
  const { data: notifs } = await admin.from("notifications").select("title, created_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(5);
  const maxRole = Math.max(1, ...roleBars.map(r => r.count));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Organisation Administration</h1>
        <p className="text-sm text-gray-500 mt-1">{summary.orgName} · structure, users, roles, templates &amp; system configuration · {profile?.full_name}</p>
      </div>

      {/* Org summary KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {d.isSuper && <Kpi n={summary.orgCount} label="Organisations" href="/super-admin" />}
        <Kpi n={summary.facilities} label="Facilities" sub="hospitals / sites" href="/organisation-admin/facilities" />
        <Kpi n={summary.departments} label="Departments" href="/organisation-admin/departments" />
        <Kpi n={summary.users} label="Users" sub={`${summary.newUsers30d} new (30d)`} href="/organisation-admin/users" />
        <Kpi n={templates.total} label="Position templates" sub={`${templates.active} active`} href="/organisation-admin/templates" />
        <Kpi n={audit.total} label="Audit events (recent)" sub={`${audit.distinctActions} action types`} href="/organisation-admin/audit" />
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        {/* Facility overview */}
        <div className={card}>
          <div className="flex items-baseline justify-between mb-3">
            <h3 className="font-semibold text-gray-900">Facility overview</h3>
            <Link href="/organisation-admin/facilities" className="text-xs text-teal-600 hover:underline">All facilities →</Link>
          </div>
          {facilities.length === 0 && <p className="text-sm text-gray-400">No facilities found for this organisation.</p>}
          <div className="divide-y divide-gray-100">
            {facilities.slice(0, 6).map((f) => (
              <div key={f.id} className="flex items-center gap-3 py-2.5">
                <span className="text-sm font-medium text-gray-800 flex-1 truncate">{f.name ?? "Unnamed facility"}</span>
                <span className="text-xs text-gray-400 hidden md:inline">{[f.city, f.country].filter(Boolean).join(", ") || "—"}</span>
                <span className="text-xs text-gray-500 tabular-nums w-16 text-right">{f.depts} dept{f.depts !== 1 ? "s" : ""}</span>
                <span className="text-xs text-gray-500 tabular-nums w-14 text-right">{f.users} user{f.users !== 1 ? "s" : ""}</span>
              </div>
            ))}
          </div>
          {summary.usersUnattached > 0 && <p className="text-[11px] text-amber-600 mt-2">+ {summary.usersUnattached} not mapped to a listed facility</p>}
        </div>

        {/* Role assignment metrics */}
        <div className={card}>
          <div className="flex items-baseline justify-between mb-3">
            <h3 className="font-semibold text-gray-900">Role assignment</h3>
            <Link href="/organisation-admin/roles" className="text-xs text-teal-600 hover:underline">Roles &amp; permissions →</Link>
          </div>
          <div className="flex gap-3 text-sm mb-3">
            <span className="text-gray-500">Assigned <b className="text-gray-800 tabular-nums">{users.assignedOrgRoles}</b></span>
            <span className="text-gray-500">Unassigned <b className={`tabular-nums ${users.unassignedRoles ? "text-amber-600" : "text-gray-800"}`}>{users.unassignedRoles}</b></span>
          </div>
          <div className="space-y-1.5">
            {roleBars.slice(0, 6).map((r) => (
              <div key={r.label} className="flex items-center gap-2 text-xs">
                <span className="w-32 shrink-0 text-gray-600 truncate">{r.label === "unassigned" ? "Unassigned" : titleCase(r.label)}</span>
                <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden"><div className="h-full bg-teal-500" style={{ width: `${(r.count / maxRole) * 100}%` }} /></div>
                <span className="w-8 text-right tabular-nums text-gray-500">{r.count}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Position template status */}
        <div className={card}>
          <h3 className="font-semibold text-gray-900 mb-3">Position template status</h3>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div><div className="text-2xl font-bold tabular-nums text-green-600">{templates.active}</div><div className="text-[11px] text-gray-500 mt-0.5">Active</div></div>
            <div><div className="text-2xl font-bold tabular-nums text-amber-600">{templates.draft}</div><div className="text-[11px] text-gray-500 mt-0.5">Draft</div></div>
            <div><div className="text-2xl font-bold tabular-nums text-gray-400">{templates.retired}</div><div className="text-[11px] text-gray-500 mt-0.5">Retired</div></div>
          </div>
          <p className="text-[11px] text-gray-400 mt-3">Templates provision workspaces, competencies, learning &amp; assessments on assignment. <Link href="/admin/positions" className="text-teal-600 hover:underline">Manage in the Workforce Engine →</Link></p>
        </div>

        {/* Integration health */}
        <div className={card}>
          <div className="flex items-baseline justify-between mb-3">
            <h3 className="font-semibold text-gray-900">Integration health</h3>
            <Link href="/organisation-admin/integrations" className="text-xs text-teal-600 hover:underline">Details →</Link>
          </div>
          <div className="flex gap-3 text-xs text-gray-500 mb-3">
            <span>🟢 {integrationHealth.live} live</span><span>🟦 {integrationHealth.native} native</span><span>⚪ {integrationHealth.off} off</span>
          </div>
          <div className="space-y-1.5">
            {integrations.slice(0, 5).map((i) => (
              <div key={i.name} className="flex items-center gap-2 text-sm">
                <span className={`w-2 h-2 rounded-full ${intDot[i.status]}`} />
                <span className="text-gray-700 flex-1 truncate">{i.name}</span>
                <span className="text-[10px] uppercase tracking-wide text-gray-400">{i.status}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Recent administrative activity */}
        <div className={card}>
          <div className="flex items-baseline justify-between mb-3">
            <h3 className="font-semibold text-gray-900">Recent administrative activity</h3>
            <Link href="/organisation-admin/audit" className="text-xs text-teal-600 hover:underline">Audit logs →</Link>
          </div>
          {audit.recent.length === 0 && <p className="text-sm text-gray-400">No recent administrative activity.</p>}
          <div className="space-y-1.5">
            {audit.recent.slice(0, 6).map((a, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <span className="text-gray-800 truncate">{a.actor_name ?? "Someone"} · <span className="text-gray-500">{a.action ? titleCase(a.action) : "updated"}</span></span>
                <span className="ml-auto text-xs text-gray-400 shrink-0">{a.created_at ? new Date(a.created_at).toLocaleDateString() : ""}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Notifications */}
        <div className={card}>
          <h3 className="font-semibold text-gray-900 mb-3">Notifications</h3>
          {(notifs ?? []).length === 0 && <p className="text-sm text-gray-400">Nothing new.</p>}
          <div className="space-y-1.5">
            {(notifs ?? []).map((n: any, i: number) => (
              <div key={i} className="flex items-center gap-2 text-sm"><span className="text-gray-800 truncate">{n.title}</span><span className="ml-auto text-xs text-gray-400">{new Date(n.created_at).toLocaleDateString()}</span></div>
            ))}
          </div>
        </div>
      </div>

      {/* Quick actions */}
      <div className={card}>
        <h3 className="font-semibold text-gray-900 mb-3">Quick actions</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
          {[["🏛️ Organisation structure", "/organisation-admin/structure"], ["👤 User directory", "/organisation-admin/users"], ["➕ Invite users", "/admin/invite"], ["🏢 Departments", "/admin/departments"], ["🧩 Position templates", "/admin/positions"], ["🎛️ Studio", "/admin/studio"], ["📜 Audit logs", "/organisation-admin/audit"], ["⚙️ Settings", "/admin/settings"]].map(([label, href]) => (
            <Link key={href} href={href} className="border border-gray-200 rounded-lg px-3 py-2 text-gray-700 hover:border-teal-300 hover:text-teal-700 transition-colors">{label}</Link>
          ))}
        </div>
      </div>
    </div>
  );
}
