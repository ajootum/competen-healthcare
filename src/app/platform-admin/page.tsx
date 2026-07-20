import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadPlatformAdmin } from "@/lib/platform-admin-data";

export const dynamic = "force-dynamic";

// Platform Super Admin Dashboard (PSA-001).
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200 p-5";
const titleCase = (s: string) => s.split(/[_\s]+/).filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(" ");
const intDot: Record<string, string> = { live: "bg-green-500", native: "bg-teal-400", off: "bg-gray-300" };

function Kpi({ n, label, sub, href, tone }: { n: any; label: string; sub?: string; href?: string; tone?: string }) {
  const inner = (
    <div className={`${card} ${href ? "hover:border-rose-300 transition-colors" : ""}`}>
      <div className={`text-3xl font-bold tabular-nums ${tone ?? "text-gray-900"}`}>{n}</div>
      <div className="text-xs text-gray-500 mt-1">{label}</div>
      {sub && <div className="text-[11px] text-gray-400 mt-0.5">{sub}</div>}
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

export default async function PlatformAdminDashboard() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("full_name, role, roles").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.includes("super_admin")) redirect("/dashboard");

  const d = await loadPlatformAdmin(admin);
  const { summary, tenants, growth, audit, ai, integrations, integrationHealth, health } = d;
  const { data: notifs } = await admin.from("notifications").select("title, created_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(5);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Platform Super Admin</h1>
        <p className="text-sm text-gray-500 mt-1">Operational control centre for the Competen platform · {profile?.full_name}</p>
      </div>

      {/* Platform KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Kpi n={summary.tenants} label="Tenants" sub={`${summary.activeTenants} active`} href="/platform-admin/tenants" />
        <Kpi n={summary.facilities} label="Facilities" href="/platform-admin/tenants" />
        <Kpi n={summary.users} label="Users" sub={`+${summary.newUsers30d} (30d)`} href="/platform-admin/analytics" />
        <Kpi n={summary.newTenants30d} label="New tenants (30d)" tone={summary.newTenants30d ? "text-rose-600" : undefined} href="/platform-admin/analytics" />
        <Kpi n={audit.securityEvents} label="Security events" sub="recent window" tone={audit.securityEvents ? "text-amber-600" : undefined} href="/platform-admin/security" />
        <Kpi n={ai.live ? "Live" : "Off"} label="AI operations" sub={`${ai.events30d} events (30d)`} tone={ai.live ? "text-green-600" : "text-gray-400"} href="/platform-admin/ai" />
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        {/* Active tenant summary */}
        <div className={card}>
          <div className="flex items-baseline justify-between mb-3">
            <h3 className="font-semibold text-gray-900">Active tenants</h3>
            <Link href="/platform-admin/tenants" className="text-xs text-rose-600 hover:underline">All tenants →</Link>
          </div>
          <div className="flex gap-4 text-sm mb-3">
            <span className="text-gray-500">Active <b className="text-green-600 tabular-nums">{summary.activeTenants}</b></span>
            <span className="text-gray-500">Suspended <b className={`tabular-nums ${summary.inactiveTenants ? "text-amber-600" : "text-gray-800"}`}>{summary.inactiveTenants}</b></span>
          </div>
          <div className="divide-y divide-gray-100">
            {tenants.slice(0, 6).map((t) => (
              <div key={t.id} className="flex items-center gap-2 py-2 text-sm">
                <span className={`w-2 h-2 rounded-full ${t.active ? "bg-green-500" : "bg-amber-400"}`} />
                <span className="text-gray-800 truncate flex-1">{t.name ?? "Unnamed"}</span>
                <span className="text-xs text-gray-400 tabular-nums">{t.facilities} fac · {t.users} users</span>
              </div>
            ))}
          </div>
        </div>

        {/* Infrastructure & system health — HONEST: cloud-managed, no in-app telemetry */}
        <div className={card}>
          <div className="flex items-baseline justify-between mb-3">
            <h3 className="font-semibold text-gray-900">Infrastructure &amp; health</h3>
            <Link href="/platform-admin/health" className="text-xs text-rose-600 hover:underline">System health →</Link>
          </div>
          <div className="space-y-1.5 text-sm">
            <div className="flex items-center gap-2"><span className={`w-2 h-2 rounded-full ${health.dbReachable ? "bg-green-500" : "bg-red-500"}`} /><span className="text-gray-700 flex-1">Database (Supabase Postgres)</span><span className={`text-xs ${health.dbReachable ? "text-green-600" : "text-red-600"}`}>{health.dbReachable ? "Reachable" : "Unavailable"}</span></div>
            <div className="flex items-center gap-2"><span className={`w-2 h-2 rounded-full ${ai.live ? "bg-green-500" : "bg-gray-300"}`} /><span className="text-gray-700 flex-1">AI intelligence layer</span><span className="text-xs text-gray-500">{ai.live ? "Live" : "Off"}</span></div>
            <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-teal-400" /><span className="text-gray-700 flex-1">Application (Vercel)</span><span className="text-xs text-gray-500">Serving</span></div>
          </div>
          <p className="text-[11px] text-gray-400 mt-3">Compute, memory, queues and container metrics are managed by the cloud provider (Vercel &amp; Supabase) and are observed in their consoles — Competen holds no in-app infrastructure telemetry, so those gauges are not shown here rather than fabricated.</p>
        </div>

        {/* Integration status */}
        <div className={card}>
          <div className="flex items-baseline justify-between mb-3">
            <h3 className="font-semibold text-gray-900">Integration status</h3>
            <Link href="/platform-admin/integrations" className="text-xs text-rose-600 hover:underline">Integration centre →</Link>
          </div>
          <div className="flex gap-3 text-xs text-gray-500 mb-3"><span>🟢 {integrationHealth.live} live</span><span>🟦 {integrationHealth.native} native</span><span>⚪ {integrationHealth.off} off</span></div>
          <div className="space-y-1.5">
            {integrations.slice(0, 5).map((i) => (
              <div key={i.name} className="flex items-center gap-2 text-sm"><span className={`w-2 h-2 rounded-full ${intDot[i.status]}`} /><span className="text-gray-700 flex-1 truncate">{i.name}</span><span className="text-[10px] uppercase tracking-wide text-gray-400">{i.status}</span></div>
            ))}
          </div>
        </div>

        {/* Security alerts */}
        <div className={card}>
          <div className="flex items-baseline justify-between mb-3">
            <h3 className="font-semibold text-gray-900">Security &amp; audit events</h3>
            <Link href="/platform-admin/security" className="text-xs text-rose-600 hover:underline">Security centre →</Link>
          </div>
          {audit.securityRecent.length === 0 && <p className="text-sm text-gray-400">No recent security-relevant events.</p>}
          <div className="space-y-1.5 max-h-52 overflow-y-auto">
            {audit.securityRecent.slice(0, 7).map((a, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <span className="text-gray-800 truncate">{a.actor_name ?? "Someone"} · <span className="text-gray-500">{a.action ? titleCase(a.action) : "action"}</span></span>
                <span className="ml-auto text-xs text-gray-400 shrink-0">{a.created_at ? new Date(a.created_at).toLocaleDateString() : ""}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Platform growth */}
        <div className={card}>
          <h3 className="font-semibold text-gray-900 mb-3">Platform growth</h3>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="flex justify-between"><span className="text-gray-500">Tenants (30d)</span><b className="tabular-nums text-rose-700">+{growth.tenants30d}</b></div>
            <div className="flex justify-between"><span className="text-gray-500">Tenants (90d)</span><b className="tabular-nums">+{growth.tenants90d}</b></div>
            <div className="flex justify-between"><span className="text-gray-500">Users (30d)</span><b className="tabular-nums text-rose-700">+{growth.users30d}</b></div>
            <div className="flex justify-between"><span className="text-gray-500">Users (90d)</span><b className="tabular-nums">+{growth.users90d}</b></div>
            <div className="flex justify-between"><span className="text-gray-500">Facilities (30d)</span><b className="tabular-nums">+{growth.facilities30d}</b></div>
          </div>
          <Link href="/platform-admin/analytics" className="mt-3 inline-block text-xs text-rose-600 hover:underline">Platform analytics →</Link>
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
          {[["🏛️ Manage organisations", "/super-admin/organisations"], ["🏥 All facilities", "/super-admin/hospitals"], ["👥 All users", "/super-admin/users"], ["🛡️ Security centre", "/platform-admin/security"], ["📈 Platform analytics", "/platform-admin/analytics"], ["🗒️ Audit log", "/super-admin/audit"], ["🎛️ Studio", "/super-admin/studio"], ["⚙️ Platform settings", "/super-admin/settings"]].map(([label, href]) => (
            <Link key={href} href={href} className="border border-gray-200 rounded-lg px-3 py-2 text-gray-700 hover:border-rose-300 hover:text-rose-700 transition-colors">{label}</Link>
          ))}
        </div>
      </div>
    </div>
  );
}
