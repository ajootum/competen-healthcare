import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";
import RoleSwitcher from "@/components/RoleSwitcher";
import NavLink from "@/components/NavLink";
import NavGroup from "@/components/NavGroup";
import SidebarToggle from "@/components/SidebarToggle";
import { highestRole, type AppRole } from "@/lib/roles";
import { workspaceLinksForUser } from "@/lib/workspace-links";

// Healthcare Worker Workspace (HWW-001 / HWW-WARD-001) — the bedside nurse's
// own operational workspace: my shift → my patients → assessments →
// observations → medications → tasks → safety → communication → handover.
// The frontline lens over the SAME op_* operational spine the Shift Supervisor
// (/supervisor) and Unit Manager (/unit-manager) workspaces govern — scoped to
// the caller's own assignment, never the whole ward's controls.
// Gate: nurses (primary), team leaders/charge nurses (assessor tier, per
// HWW-WARD-001 §2), and admins for support. Modules without a built surface
// yet are shown muted ("soon") rather than as dead links.
/* eslint-disable @typescript-eslint/no-explicit-any */
type NavItem = { label: string; href?: string; icon: string; exact?: boolean; soon?: boolean; badge?: string };

const DASHBOARD: NavItem = { label: "Ward Dashboard", href: "/healthcare-worker", icon: "🖥️", exact: true };

// HWW-WARD-001 §4 functional modules (+ ICU variant modules surface within
// Acuity/Workload when the unit is critical care, + Nurse Concerns HWW-ADD-001).
const NAV_GROUPS: { group: string; items: NavItem[] }[] = [
  { group: "My Shift", items: [
    { label: "My Patients",      href: "/healthcare-worker/patients",      icon: "🧑‍⚕️" },
    { label: "Task Centre",      href: "/healthcare-worker/tasks",         icon: "✅", badge: "myTasks" },
    { label: "Shift Summary",    href: "/healthcare-worker/shift-summary", icon: "📋" },
  ]},
  { group: "Clinical Assessment", items: [
    { label: "Observations & PEWS", href: "/healthcare-worker/observations", icon: "📈", badge: "obsDue" },
    { label: "Acuity Assessment",   href: "/healthcare-worker/acuity",       icon: "🌡️" },
    { label: "Workload Assessment", href: "/healthcare-worker/workload",     icon: "⚖️" },
  ]},
  { group: "Care Coordination", items: [
    { label: "Medication Summary",   href: "/healthcare-worker/medications",   icon: "💊" },
    { label: "Nurse Concerns",       href: "/healthcare-worker/concerns",      icon: "🚩", badge: "concerns" },
    { label: "Safety & Escalation",  href: "/healthcare-worker/safety",        icon: "🛡️", badge: "alerts" },
    { label: "Communication",        href: "/healthcare-worker/communication", icon: "💬", badge: "unread" },
    { label: "Handover (SBAR)",      href: "/healthcare-worker/handover",      icon: "🔄" },
  ]},
  { group: "Intelligence", items: [
    { label: "AI Copilot", href: "/healthcare-worker/copilot", icon: "✨", soon: true },
  ]},
];

// HWW-WARD-001 §2 — Staff Nurse / Team Leader primary (nurse + assessor tiers);
// admins for support. Educators are not a listed HWW audience.
const ALLOWED = ["nurse", "assessor", "hospital_admin", "super_admin"];
const linkCls = "flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-[13px] text-emerald-100/70 hover:bg-emerald-800/50 hover:text-white transition-colors";
const activeCls = "flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-[13px] bg-emerald-700/60 text-white font-medium";

export default async function HealthcareWorkerLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("full_name, role, roles, hospital_id").eq("id", user.id).single();
  const userRoles: AppRole[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean) as AppRole[];
  const cookieStore = await cookies();
  const activeRole = (cookieStore.get("active_role")?.value ?? highestRole(userRoles)) as AppRole;
  const workspaces = await workspaceLinksForUser(admin, user.id, userRoles);

  if (!userRoles.some(r => ALLOWED.includes(r))) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-4xl mb-3">🔒</p>
          <h1 className="text-lg font-bold text-gray-900">Access restricted</h1>
          <p className="text-gray-400 text-sm mt-1">The Healthcare Worker Workspace is for bedside clinicians and their team leaders.</p>
          <Link href="/dashboard" className="mt-4 inline-block text-sm text-emerald-600 hover:underline">← Back to dashboard</Link>
        </div>
      </div>
    );
  }

  // Live nav badges — the nurse's OWN counts (self-scoped, unlike the
  // supervisor's hospital-wide counts). Fail-soft: errors resolve to 0.
  const bNum = (r: any) => (r?.error ? 0 : r?.count ?? 0);
  const { data: myAsg } = await admin.from("op_patient_assignments").select("patient_id").eq("staff_id", user.id).eq("status", "active").limit(100);
  const myPatientIds = ((myAsg ?? []) as any[]).map(r => r.patient_id).filter(Boolean);
  const [unreadRes, taskRes, concernRes, actionRes, obsRes, alertRes] = await Promise.all([
    admin.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("read", false),
    admin.from("op_tasks").select("id", { count: "exact", head: true }).eq("assigned_to", user.id).not("status", "in", "(completed,verified,cancelled)"),
    admin.from("op_concerns").select("id", { count: "exact", head: true }).eq("raised_by", user.id).in("status", ["open", "in_progress", "carried_forward"]),
    admin.from("op_concern_actions").select("id", { count: "exact", head: true }).eq("owner_id", user.id).in("status", ["open", "in_progress"]),
    myPatientIds.length
      ? admin.from("op_observations").select("id", { count: "exact", head: true }).in("patient_id", myPatientIds).in("status", ["due", "overdue"])
      : Promise.resolve({ count: 0, error: null }),
    myPatientIds.length
      ? admin.from("op_safety_alerts").select("id", { count: "exact", head: true }).in("patient_id", myPatientIds).eq("active", true)
      : Promise.resolve({ count: 0, error: null }),
  ]);
  const badges: Record<string, number> = { unread: bNum(unreadRes), myTasks: bNum(taskRes), obsDue: bNum(obsRes), alerts: bNum(alertRes), concerns: bNum(concernRes) + bNum(actionRes) };
  const groupBadge = (items: NavItem[]) =>
    [...new Set(items.filter(i => i.href && !i.soon && i.badge).map(i => i.badge!))].reduce((n, k) => n + (badges[k] ?? 0), 0);

  const mobileItems = [...new Map([DASHBOARD, ...NAV_GROUPS.flatMap(g => g.items)].filter(i => i.href && !i.soon).map(i => [i.href, i] as const)).values()];

  return (
    <div className="min-h-screen bg-gray-50 font-[family-name:var(--font-geist-sans)]">
      <header className="md:hidden fixed top-0 left-0 right-0 z-40 bg-[#0a2f23] shadow-lg">
        <div className="h-12 flex items-center gap-2 px-3">
          <span className="w-7 h-7 rounded bg-emerald-500 flex items-center justify-center text-white font-bold text-sm shrink-0">C</span>
          <span className="min-w-0">
            <span className="block text-white font-semibold text-sm leading-tight">Competen</span>
            <span className="block text-emerald-300/60 text-[10px] leading-tight">Healthcare Worker Workspace</span>
          </span>
          <span className="flex-1" />
          <Link href="/dashboard" className="text-[11px] text-emerald-100/70 border border-emerald-800 rounded-lg px-2.5 py-1">⊞ My Dashboard</Link>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-2">
          {mobileItems.map(({ label, href }) => (
            <Link key={href} href={href!} className="shrink-0 text-[11px] text-emerald-100/80 bg-emerald-800/50 hover:bg-emerald-700/60 rounded-full px-3 py-1 transition-colors">{label}</Link>
          ))}
        </nav>
      </header>

      <div className="flex">
        <aside data-sidebar className="hidden md:flex w-56 h-screen bg-[#0a2f23] flex-col py-6 px-4 fixed top-0 left-0 z-20">
          <SidebarToggle />
          <Link href="/healthcare-worker" className="flex items-center gap-2 mb-4 px-2" data-sb-item>
            <div className="w-7 h-7 rounded bg-emerald-500 flex items-center justify-center text-white font-bold text-sm">C</div>
            <span className="min-w-0" data-sb-label>
              <span className="block text-white font-semibold text-sm leading-tight">Competen</span>
              <span className="block text-emerald-300/60 text-[9px] leading-tight">Healthcare Worker Workspace</span>
            </span>
          </Link>

          <nav className="flex flex-col gap-0.5 flex-1 overflow-y-auto">
            <NavLink href={DASHBOARD.href!} icon={DASHBOARD.icon} label={DASHBOARD.label} exact={DASHBOARD.exact}
              className={linkCls} activeClassName={activeCls} />
            <div className="my-1.5 border-t border-emerald-800/30" />
            {NAV_GROUPS.map(({ group, items }) => {
              const nodes = items.map(({ label, href, icon, exact, soon, badge }) => soon || !href ? (
                <span key={label} title={`${label} — coming soon`} data-sb-item
                  className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-[13px] text-emerald-100/25 cursor-default select-none">
                  <span className="w-5 text-center text-sm leading-none opacity-60">{icon}</span>
                  <span className="flex-1" data-sb-label>{label}</span>
                  <span className="text-[8px] font-bold uppercase tracking-wider bg-emerald-950 text-emerald-400/40 rounded px-1 py-0.5" data-sb-label>soon</span>
                </span>
              ) : (
                <NavLink key={label} href={href} icon={icon} label={label} exact={exact}
                  badge={badge ? badges[badge] : undefined}
                  className={linkCls} activeClassName={activeCls} />
              ));
              return (
                <NavGroup key={group} title={group} hrefs={items.filter(i => i.href).map(i => i.href!.split(/[?#]/)[0])}
                  badge={groupBadge(items)}
                  headerClass="text-[9px] font-bold uppercase tracking-widest text-emerald-400/50">{nodes}</NavGroup>
              );
            })}
            <div className="my-2 border-t border-emerald-800/30" />
            <Link href="/dashboard" data-sb-item title="My Dashboard" className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-[13px] text-emerald-100/40 hover:bg-emerald-800/50 hover:text-white transition-colors">
              <span className="w-5 text-center text-sm">⊞</span>
              <span data-sb-label>My Dashboard</span>
            </Link>
          </nav>

          <div className="pt-4 border-t border-emerald-800/60">
            <div className="flex items-center gap-2 px-3 py-2">
              <div className="w-7 h-7 rounded-full bg-emerald-400 flex items-center justify-center text-emerald-950 text-xs font-bold">{profile?.full_name?.[0] ?? "N"}</div>
              <div className="flex-1 min-w-0" data-sb-label>
                <p className="text-white text-xs font-medium truncate">{profile?.full_name}</p>
                <p className="text-emerald-300/60 text-[10px]">Healthcare Worker</p>
              </div>
            </div>
            {(userRoles.length > 1 || workspaces.length > 0) && <div className="mb-2" data-sb-label><RoleSwitcher roles={userRoles} activeRole={activeRole} workspaces={workspaces} /></div>}
            <form action="/api/auth/logout" method="POST">
              <button type="submit" data-sb-item className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-emerald-100/50 hover:bg-emerald-800/30 hover:text-white transition-colors">
                <span className="w-5 text-center">↩</span><span data-sb-label>Sign out</span>
              </button>
            </form>
          </div>
        </aside>

        <main data-content className="flex-1 md:ml-56 px-4 md:px-6 pt-24 md:pt-8 pb-8 max-w-7xl">{children}</main>
      </div>
    </div>
  );
}
