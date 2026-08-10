import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";
import { ROLE_CONFIG, highestRole, type AppRole } from "@/lib/roles";
import { workspaceLinksForUser } from "@/lib/workspace-links";
import { cardClass } from "@/components/ui/primitives";

// PW-010 Workspace Launcher & Switcher — a role-aware entry point to every workspace the signed-in user is
// authorised for: their AppRole portals (ROLE_CONFIG) + org-role workspaces (workspaceLinksForUser), plus the
// Personal Workspace they're in. Renders REAL access — a single-role nurse sees 1-2 workspaces (honestly lighter
// than the multi-role mockup persona). Recent-workspace history + favourites/pinning are progressive.
export const dynamic = "force-dynamic";

const APP_DESC: Record<AppRole, string> = {
  nurse: "Patient care, tasks, clinical documentation and more.",
  assessor: "Assessments, validations and evidence review.",
  educator: "Teaching, curriculum, learners and education management.",
  hospital_admin: "Facility administration, oversight and reporting.",
  super_admin: "Platform configuration, governance and administration.",
};
const ORG_DESC: Record<string, string> = {
  "Shift Supervisor": "Shift operations, team management and coordination.",
  "Unit Manager": "Unit operations, workforce, quality and performance.",
  "Competency Office": "Competency management, assessments and analytics.",
  "Quality & Accreditation": "Quality management, audits and accreditation.",
  "Human Resources": "HR processes, staff records and workforce data.",
  "Hospital Executive": "Executive dashboards, reports and strategic oversight.",
  "Organisation Admin": "Organisation configuration and administration.",
  "Enterprise Governance": "Governance, policy and compliance oversight.",
};

export default async function LauncherPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any; // eslint-disable-line @typescript-eslint/no-explicit-any
  const { data: profile } = await admin.from("profiles").select("full_name, role, roles, hospital_id, avatar_url").eq("id", user.id).single();
  const userRoles: AppRole[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean) as AppRole[];
  const cookieStore = await cookies();
  // !! highestRole returns AppRole | null since CP-SPLIT-002, and `as AppRole` swallowed the null.
  // Carried, not replaced -- an identity with no estate role has no active portal, and the launcher
  // below already renders one card per role it actually holds, which for such a person is none.
  // The estate gate in /dashboard/layout.tsx redirects them before this page renders.
  const activeRole: AppRole | null =
    (cookieStore.get("active_role")?.value as AppRole | undefined) ?? highestRole(userRoles);

  // Base portals (one per AppRole) + org-role workspaces.
  const portals = userRoles.map(r => ({ label: ROLE_CONFIG[r]?.label ?? r, icon: ROLE_CONFIG[r]?.icon ?? "🏥", href: ROLE_CONFIG[r]?.portal ?? "/dashboard", color: ROLE_CONFIG[r]?.color ?? "bg-[var(--cmp-color-information)]", description: APP_DESC[r] ?? "", badge: `${r === activeRole ? "Active" : "Portal"}`, role: r }));
  const orgLinks = await workspaceLinksForUser(admin, user.id, userRoles);
  const orgWorkspaces = orgLinks.map(w => ({ ...w, color: "bg-slate-600", description: ORG_DESC[w.label] ?? "Dedicated operational workspace.", badge: "Role", role: null }));
  const workspaces = [...portals, ...orgWorkspaces];

  // Recent activity from the audit log (own actions).
  const { data: activity } = await admin.from("audit_log").select("action, entity_type, entity_name, created_at").eq("actor_id", user.id).order("created_at", { ascending: false }).limit(6);
  const acts = (activity ?? []) as any[]; // eslint-disable-line @typescript-eslint/no-explicit-any
  const fmtAgo = (t: string) => new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  return (
    <div className="max-w-[1500px] mx-auto space-y-5">
      {/* Header */}
      <div>
        <p className="text-[11px] font-semibold text-[var(--cmp-text-information)] uppercase tracking-wide">Personal Workspace</p>
        <h1 className="text-2xl font-bold text-gray-900">Workspace Launcher &amp; Switcher</h1>
        <p className="text-sm text-gray-500 mt-0.5">Access and switch between all your available workspaces. Your role determines what you can see and access.</p>
      </div>

      <div className="grid lg:grid-cols-[minmax(0,1fr)_300px] gap-5 items-start">
        <div className="space-y-5">
          {/* Current workspace */}
          <div className={cardClass}>
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-3">Current Workspace</p>
            <div className="flex flex-wrap items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-[var(--cmp-color-information)] flex items-center justify-center text-white text-xl shrink-0">🧑‍⚕️</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2"><h2 className="text-lg font-bold text-gray-900">Personal Workspace</h2><span className="text-[10px] font-semibold text-emerald-700 bg-[var(--cmp-surface-success)] rounded-full px-2 py-0.5">● Active</span></div>
                <p className="text-sm text-gray-500">Your home for personal productivity, learning and professional development.</p>
              </div>
              <div className="flex items-center gap-2">
                <Link href="/dashboard" className="text-sm font-medium text-white bg-[var(--cmp-color-information)] rounded-lg px-3 py-2 hover:bg-[var(--cmp-color-information)]">Open Workspace</Link>
              </div>
            </div>
            <div className="grid sm:grid-cols-3 gap-3 mt-4 pt-4 border-t border-gray-100 text-[12px]">
              <div><p className="text-gray-400">Signed in as</p><p className="font-medium text-gray-800">{profile?.full_name}</p></div>
              <div><p className="text-gray-400">Active portal</p><p className="font-medium text-gray-800">{activeRole ? (ROLE_CONFIG[activeRole]?.label ?? activeRole) : "None"}</p></div>
              <div><p className="text-gray-400">Status</p><p className="font-medium text-[var(--cmp-text-success)]">All systems operational</p></div>
            </div>
          </div>

          {/* My workspaces */}
          <div className={cardClass}>
            <div className="flex items-center justify-between mb-3"><h2 className="text-sm font-semibold text-gray-900">My Workspaces <span className="text-gray-400 font-normal">({workspaces.length})</span></h2></div>
            <p className="text-[12px] text-gray-500 mb-4">All workspaces you have access to based on your roles and permissions.</p>
            {workspaces.length > 0 ? (
              <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
                {workspaces.map((w, i) => (
                  <Link key={i} href={w.href} className="border border-gray-100 rounded-xl p-4 hover:border-[var(--cmp-color-information)] hover:shadow-sm transition-all">
                    <div className={`w-10 h-10 rounded-lg ${w.color} flex items-center justify-center text-white text-lg mb-2.5`}>{w.icon}</div>
                    <p className="text-[14px] font-semibold text-gray-900">{w.label}</p>
                    <p className="text-[11px] text-gray-500 leading-snug mt-0.5 line-clamp-2">{w.description}</p>
                    <span className={`inline-block mt-2 text-[10px] font-medium rounded-full px-2 py-0.5 ${w.badge === "Active" ? "bg-[var(--cmp-surface-success)] text-emerald-700" : "bg-gray-100 text-gray-500"}`}>{w.badge === "Active" ? "Active Role" : w.role ? "Portal Role" : "Role Access"}</span>
                  </Link>
                ))}
              </div>
            ) : <p className="text-sm text-gray-400 py-8 text-center">Your role grants access to the Personal Workspace only.</p>}
          </div>
        </div>

        {/* Right rail */}
        <div className="space-y-5">
          {/* Quick switcher */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Quick Switcher</h3>
            <div className="space-y-1">
              <div className="flex items-center gap-2.5 px-2 py-2 rounded-lg bg-[var(--cmp-surface-information)]">
                <span className="w-6 h-6 rounded bg-[var(--cmp-color-information)] text-white text-[11px] flex items-center justify-center">🧑‍⚕️</span>
                <span className="flex-1 text-[13px] font-medium text-blue-800">Personal Workspace</span>
                <span className="text-[10px] text-[var(--cmp-text-success)] font-semibold">Active now</span>
              </div>
              {workspaces.slice(0, 6).map((w, i) => (
                <Link key={i} href={w.href} className="flex items-center gap-2.5 px-2 py-2 rounded-lg hover:bg-gray-50">
                  <span className={`w-6 h-6 rounded ${w.color} text-white text-[11px] flex items-center justify-center`}>{w.icon}</span>
                  <span className="flex-1 text-[13px] text-gray-700 truncate">{w.label}</span>
                  <span className="text-gray-300">›</span>
                </Link>
              ))}
            </div>
          </div>

          {/* Quick actions */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Quick Actions</h3>
            <div className="grid grid-cols-2 gap-2">
              <Link href="/dashboard/preferences" className="text-[12px] font-medium text-gray-600 border border-gray-200 rounded-lg py-2 text-center hover:bg-gray-50">⚙ Settings</Link>
              <Link href="/dashboard/profile" className="text-[12px] font-medium text-gray-600 border border-gray-200 rounded-lg py-2 text-center hover:bg-gray-50">👤 Profile</Link>
              <Link href="/dashboard/career" className="text-[12px] font-medium text-gray-600 border border-gray-200 rounded-lg py-2 text-center hover:bg-gray-50">🧭 Roles</Link>
              <a href="mailto:gabriel@semacast.com" className="text-[12px] font-medium text-gray-600 border border-gray-200 rounded-lg py-2 text-center hover:bg-gray-50">🎧 Help</a>
            </div>
          </div>

          {/* Workspace activity */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Recent Activity</h3>
            {acts.length > 0 ? (
              <div className="space-y-2.5">
                {acts.map((a, i) => (
                  <div key={i} className="flex gap-2.5"><span className="w-1.5 h-1.5 rounded-full bg-[var(--cmp-color-information)] mt-1.5 shrink-0" /><div className="min-w-0"><p className="text-[12px] text-gray-700 leading-snug"><span className="font-medium capitalize">{String(a.action).replace(/_/g, " ")}</span>{a.entity_name ? ` · ${a.entity_name}` : ""}</p><p className="text-[10px] text-gray-400">{fmtAgo(a.created_at)}</p></div></div>
                ))}
              </div>
            ) : <p className="text-xs text-gray-400 py-4 text-center">No recent activity recorded.</p>}
          </div>

          {/* Tips */}
          <div className="bg-[var(--cmp-surface-information)]/60 rounded-xl border border-[var(--cmp-color-information)] p-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-2">Tips</h3>
            <ul className="text-[12px] text-gray-600 space-y-1.5 list-disc pl-4">
              <li>Your access is based on your roles and permissions.</li>
              <li>Switch portals anytime from the sidebar role switcher.</li>
              <li>Contact support to request new workspace access.</li>
            </ul>
          </div>
        </div>
      </div>
      <p className="text-[11px] text-gray-400">Workspaces reflect your real role-based access. Favourites/pinning and recent-workspace history are progressive.</p>
    </div>
  );
}
