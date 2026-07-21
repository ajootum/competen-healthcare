import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadEnterpriseAdmin } from "@/lib/enterprise/enterprise-admin";
import StructureExplorer from "./_ea/StructureExplorer";

export const dynamic = "force-dynamic";

// Enterprise Administration — section overview (ENT-001). The authoritative
// organisational model: KPI ribbon, structure explorer, onboarding pipeline,
// setup issues, recent activity, quick actions and top organisations. All live
// data; unbacked signals show an honest state rather than a fabricated number.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const fmt = (n: number) => n.toLocaleString();
const relTime = (iso?: string | null) => {
  if (!iso) return "";
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} hr ago`;
  return `${Math.floor(s / 86400)} d ago`;
};
const TONE: Record<string, string> = { rose: "text-rose-600", orange: "text-orange-600", amber: "text-amber-600", red: "text-red-600", violet: "text-violet-600", indigo: "text-indigo-600" };

function Panel({ title, href, linkLabel, children, className = "", info }: { title: string; href?: string; linkLabel?: string; children: React.ReactNode; className?: string; info?: string }) {
  return (
    <div className={`${card} p-5 ${className}`}>
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold text-gray-900 text-[15px]">{title}{info && <span className="ml-1.5 text-gray-300" title={info}>ⓘ</span>}</h2>
        {href && <Link href={href} className="text-xs text-teal-700 hover:underline shrink-0">{linkLabel ?? "View all"} →</Link>}
      </div>
      {children}
    </div>
  );
}

export default async function EnterpriseAdministration() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.includes("super_admin")) redirect("/dashboard");

  const ea = await loadEnterpriseAdmin(admin);
  const { kpis, explorer, standaloneOrgs, pipeline, setupIssues, activity, activityReady, topOrgs, countries, migrationApplied } = ea;

  const kpiCards: { label: string; n: number | null; icon: string; iconBg: string; sub?: string; tone?: string }[] = [
    { label: "Organisations", n: kpis.organisations, icon: "🏛️", iconBg: "bg-violet-50", sub: `${countries} countr${countries === 1 ? "y" : "ies"}` },
    { label: "Networks", n: kpis.networks, icon: "🌐", iconBg: "bg-indigo-50", sub: "enterprise groups" },
    { label: "Facilities", n: kpis.facilities, icon: "🏥", iconBg: "bg-sky-50", sub: "operational sites" },
    { label: "Users", n: kpis.users, icon: "👥", iconBg: "bg-blue-50", sub: "across all tenants" },
    { label: "Departments", n: kpis.departments, icon: "🗂️", iconBg: "bg-teal-50", sub: `${fmt(kpis.units)} units` },
    { label: "Positions", n: kpis.positions, icon: "🪪", iconBg: "bg-emerald-50", sub: "job posts" },
    { label: "Pending Setups", n: kpis.pendingSetups, icon: "📋", iconBg: "bg-rose-50", sub: kpis.pendingSetups ? "requires action" : "all clear", tone: kpis.pendingSetups ? "text-rose-600" : undefined },
  ];

  const quickActions = [
    { label: "Create Organisation", desc: "Register a new organisation", icon: "🏛️", href: "/super-admin/enterprise/organisations" },
    { label: "Create Network", desc: "Group organisations", icon: "🌐", href: "/super-admin/enterprise/networks" },
    { label: "Add Facility", desc: "Add a new facility", icon: "🏥", href: "/super-admin/enterprise/facilities" },
    { label: "Build Structure", desc: "Departments & units", icon: "🗂️", href: "/super-admin/enterprise/structure" },
    { label: "Import People", desc: "Bulk-import users", icon: "📥", href: "/super-admin/import" },
    { label: "Deploy Template", desc: "Use a prebuilt structure", icon: "📦", href: "/super-admin/enterprise" },
  ];

  const modules = [
    { n: 1, label: "Organisations", desc: "Registry, tenant profile & onboarding", icon: "🏛️", href: "/super-admin/enterprise/organisations", live: true },
    { n: 2, label: "Networks & Enterprise Groups", desc: "Multi-organisation & multinational structures", icon: "🌐", href: "/super-admin/enterprise/networks", live: true },
    { n: 3, label: "Facilities", desc: "Hospitals, campuses, clinics & sites", icon: "🏥", href: "/super-admin/enterprise/facilities", live: true },
    { n: 4, label: "Departments, Units & Services", desc: "Internal structure builder", icon: "🗂️", href: "/super-admin/enterprise/structure", live: true },
    { n: 5, label: "People, Positions & Roles", desc: "Staff, positions & workspace access", icon: "👥", href: "/super-admin/users", live: true },
    { n: 6, label: "Enterprise Templates", desc: "Reusable structures & configurations", icon: "📦", href: "/super-admin/enterprise", live: false },
  ];

  return (
    <div data-wide className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Enterprise Administration</h1>
          <p className="text-sm text-gray-500 mt-1">Manage the complete organisational structure across all tenants.</p>
        </div>
      </div>

      {!migrationApplied && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-3">
          <p className="text-sm text-amber-900"><span className="font-semibold">Migration 052 not applied yet.</span> Core counts are live; the richer structure metadata (divisions, services, teams, templates, lifecycle status) activates once <span className="font-mono text-xs">052-enterprise-administration.sql</span> is run.</p>
        </div>
      )}

      {/* KPI ribbon */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
        {kpiCards.map(k => (
          <div key={k.label} className={`${card} p-4`}>
            <div className="flex items-start justify-between">
              <span className="text-[11px] font-semibold text-gray-500 leading-tight">{k.label}</span>
              <span className={`w-7 h-7 rounded-lg ${k.iconBg} flex items-center justify-center text-sm shrink-0`}>{k.icon}</span>
            </div>
            <p className={`text-2xl font-bold mt-1.5 tabular-nums ${k.tone ?? "text-gray-900"}`}>{k.n == null ? "—" : fmt(k.n)}</p>
            {k.sub && <p className="text-[10px] text-gray-400 mt-0.5">{k.sub}</p>}
          </div>
        ))}
      </div>

      {/* Explorer · Pipeline · Issues */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Panel title="Enterprise Structure Explorer" href="/super-admin/enterprise/organisations" linkLabel="Full map" info="Network → Organisation → Facility → Department → Unit">
          <div className="max-h-96 overflow-y-auto -mx-1 px-1">
            <StructureExplorer networks={explorer} standalone={standaloneOrgs} />
          </div>
        </Panel>

        <Panel title="Onboarding Pipeline" href="/super-admin/enterprise/organisations" linkLabel="View all">
          <div className="space-y-1">
            {pipeline.map(p => (
              <div key={p.stage} className="flex items-center justify-between px-2 py-2 rounded-lg hover:bg-gray-50">
                <span className="flex items-center gap-2.5 text-sm text-gray-600"><span className="text-base">{p.icon}</span>{p.stage}</span>
                <span className="text-sm font-bold tabular-nums text-gray-900">{p.n} <span className="text-[10px] font-normal text-gray-400">org{p.n === 1 ? "" : "s"}</span></span>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Setup Issues" href="/super-admin/enterprise" linkLabel="Issues centre" info="Configuration gaps to resolve">
          <div className="space-y-1">
            {setupIssues.map(s => (
              <Link key={s.key} href={s.href} className="flex items-center justify-between gap-2 px-2 py-2 rounded-lg hover:bg-gray-50 group">
                <span className="text-sm text-gray-600 group-hover:text-gray-900">{s.label}</span>
                {s.n == null
                  ? <span className="text-[10px] text-gray-300 shrink-0">n/a</span>
                  : <span className={`text-sm font-bold tabular-nums shrink-0 ${s.n ? TONE[s.tone] ?? "text-gray-900" : "text-gray-300"}`}>{s.n}</span>}
              </Link>
            ))}
          </div>
        </Panel>
      </div>

      {/* Activity · Quick actions · Top orgs */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Panel title="Recent Activity" href="/super-admin/audit" linkLabel="View all">
          {!activityReady || activity.length === 0 ? (
            <p className="text-sm text-gray-400 py-6 text-center">{activityReady ? "No recorded activity yet." : "Activity feed activates with the audit log."}</p>
          ) : (
            <div className="space-y-2.5 max-h-80 overflow-y-auto">
              {activity.slice(0, 8).map((a, i) => (
                <div key={i} className="flex items-start gap-2.5">
                  <span className="text-sm mt-0.5">{a.icon}</span>
                  <div className="flex-1 min-w-0"><p className="text-sm text-gray-800 truncate">{a.title}</p>{a.detail && <p className="text-[10px] text-gray-400 truncate capitalize">{a.detail}</p>}</div>
                  <span className="text-[10px] text-gray-400 shrink-0 tabular-nums">{relTime(a.at)}</span>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Quick Actions">
          <div className="grid grid-cols-2 gap-2">
            {quickActions.map(a => (
              <Link key={a.label} href={a.href} className="flex flex-col gap-1 rounded-lg border border-gray-100 p-3 hover:border-teal-300 hover:bg-teal-50/40 transition-colors">
                <span className="text-lg">{a.icon}</span>
                <span className="text-xs font-semibold text-gray-700 leading-tight">{a.label}</span>
                <span className="text-[10px] text-gray-400 leading-tight">{a.desc}</span>
              </Link>
            ))}
          </div>
        </Panel>

        <Panel title="Top Organisations by Activity" href="/super-admin/enterprise/organisations" linkLabel="View all">
          {topOrgs.length === 0 ? <p className="text-sm text-gray-400 py-6 text-center">No organisations yet.</p> : (
            <div className="space-y-2.5">
              {topOrgs.map(o => (
                <div key={o.id} className="flex items-center gap-2.5">
                  <span className="text-sm">🏛️</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-800 truncate">{o.name}</p>
                    <p className="text-[10px] text-gray-400 truncate">{o.country} · {fmt(o.users)} users · {o.facilities} facilit{o.facilities === 1 ? "y" : "ies"}</p>
                  </div>
                  <div className="w-16 shrink-0">
                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden"><div className="h-full bg-teal-500 rounded-full" style={{ width: `${Math.max(o.score, 3)}%` }} /></div>
                    <p className="text-[9px] text-gray-400 text-right mt-0.5 tabular-nums">{o.score}%</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      {/* Module directory */}
      <Panel title="Select a module to manage">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {modules.map(m => (
            <Link key={m.n} href={m.href} className="flex items-start gap-3 rounded-lg border border-gray-100 p-4 hover:border-teal-300 hover:bg-teal-50/30 transition-colors">
              <span className="w-9 h-9 rounded-lg bg-gray-50 border border-gray-200 flex items-center justify-center text-base shrink-0">{m.icon}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold text-gray-400">{m.n}</span>
                  <span className="text-sm font-semibold text-gray-900">{m.label}</span>
                  {!m.live && <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-600 font-medium">Next phase</span>}
                </div>
                <p className="text-[11px] text-gray-500 mt-0.5">{m.desc}</p>
              </div>
            </Link>
          ))}
        </div>
      </Panel>

      {/* About / setup flow */}
      <div className={`${card} p-5`}>
        <div className="flex flex-col lg:flex-row gap-5 lg:items-center">
          <div className="lg:w-72 shrink-0">
            <h3 className="font-semibold text-gray-900">About Enterprise Administration</h3>
            <p className="text-[11px] text-gray-500 mt-1 leading-relaxed">Build and manage the complete organisational structure across the platform. Every other Competen module inherits its organisational context from here.</p>
          </div>
          <div className="flex-1 flex items-center justify-between gap-1 overflow-x-auto">
            {[
              { n: 1, l: "Organisations", s: "Create & manage", icon: "🏛️" },
              { n: 2, l: "Networks", s: "Group orgs", icon: "🌐" },
              { n: 3, l: "Facilities", s: "Register sites", icon: "🏥" },
              { n: 4, l: "Structure", s: "Depts & units", icon: "🗂️" },
              { n: 5, l: "People & Roles", s: "Assign staff", icon: "👥" },
              { n: 6, l: "Templates", s: "Standardise", icon: "📦" },
            ].map((st, i, arr) => (
              <div key={st.n} className="flex items-center gap-1 shrink-0">
                <div className="text-center w-24">
                  <div className="w-10 h-10 mx-auto rounded-full bg-gray-50 border border-gray-200 flex items-center justify-center text-base">{st.icon}</div>
                  <p className="text-[10px] font-semibold text-gray-700 mt-1">{st.n} {st.l}</p>
                  <p className="text-[9px] text-gray-400">{st.s}</p>
                </div>
                {i < arr.length - 1 && <span className="text-gray-200">→</span>}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
