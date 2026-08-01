import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";
import MobileSidebar from "./MobileSidebar";
import NavLink from "@/components/NavLink";
import SidebarToggle from "@/components/SidebarToggle";
import { highestRole, ROLE_CONFIG, ROLE_PRIORITY, type AppRole } from "@/lib/roles";
import ActiveContextBanner from "./ActiveContextBanner";
import { workspaceLinksForUser } from "@/lib/workspace-links";
import GlobalHeader from "@/components/platform/GlobalHeader";
import { loadHeaderContext } from "@/lib/platform/header";

// Personal Workspace shell (PW-000/PW-001) — flat left nav + global top bar (search + profile) + Current Shift
// card, aligned to the high-fidelity mockup. Nav items map to the real worker surfaces that back them; the
// dedicated Task/Calendar/Messaging/Documents/Profile/Preferences centres (PW-002..012) are progressive — those
// items point at the nearest live surface until their own pages ship. Badges (tasks/notifications) are the user's real counts.
/* eslint-disable @typescript-eslint/no-explicit-any */
const dayAgoIso = () => new Date(Date.now() - 86400000).toISOString(); // module helper — Date.now() in render trips purity
const SHIFT_TIMES: Record<string, string> = { day: "07:00 – 19:00", evening: "14:00 – 22:00", night: "19:00 – 07:00", long_day: "07:00 – 19:30", on_call: "On call" };
const SHIFT_LABEL: Record<string, string> = { day: "Day Shift", evening: "Evening Shift", night: "Night Shift", long_day: "Long Day", on_call: "On Call" };

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;

  const { data: profile } = await admin.from("profiles").select("full_name, role, roles, avatar_url, hospital_id").eq("id", user.id).single();

  // One resolver for every workspace, so the header cannot drift between them (PUI-002).

  const header = await loadHeaderContext(admin, user.id, { currentHref: "/dashboard" });
  const userRoles: AppRole[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean) as AppRole[];
  const cookieStore = await cookies();
  const activeRole = (cookieStore.get("active_role")?.value ?? highestRole(userRoles)) as AppRole;

  // Universal-landing context (PW-014 PW-AC-01/05): everyone lands here, so surface the user's primary functional
  // workspace for a one-click jump. Prefer their highest non-nurse AppRole portal, else their first org workspace.
  const workspaces = await workspaceLinksForUser(admin, user.id, userRoles);
  const funcRole = ROLE_PRIORITY.find(r => r !== "nurse" && userRoles.includes(r));
  const primaryWorkspace = funcRole
    ? { label: ROLE_CONFIG[funcRole].label, href: ROLE_CONFIG[funcRole].portal }
    : workspaces[0] ? { label: workspaces[0].label, href: workspaces[0].href } : null;

  // Real badge counts + current shift (fail-soft).
  const q = async (p: Promise<any>) => { try { const r = await p; return r ?? {}; } catch { return {}; } };
  const [{ count: unreadCount }, { count: taskCount }, { count: msgCount }, shift] = await Promise.all([
    q(admin.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("read", false)),
    q(admin.from("op_tasks").select("id", { count: "exact", head: true }).eq("assigned_to", user.id).not("status", "in", "(completed,cancelled)")),
    q(profile?.hospital_id ? admin.from("op_messages").select("id", { count: "exact", head: true }).eq("hospital_id", profile.hospital_id).gte("created_at", dayAgoIso()) : Promise.resolve({})),
    (async () => {
      try {
        const { data: ss } = await admin.from("op_shift_staff").select("shift_id").eq("staff_id", user.id).limit(10);
        const ids = (ss ?? []).map((s: any) => s.shift_id).filter(Boolean);
        if (!ids.length) return null;
        const { data: sh } = await admin.from("op_shifts").select("shift_type, status, department_id").in("id", ids);
        const active = (sh ?? []).find((x: any) => x.status === "active") ?? (sh ?? [])[0];
        if (!active) return null;
        const dept = active.department_id ? (await admin.from("departments").select("name").eq("id", active.department_id).maybeSingle()).data?.name : null;
        return { type: active.shift_type, status: active.status, ward: dept ?? "Ward" };
      } catch { return null; }
    })(),
  ]);

  const NAV = [
    { label: "Dashboard", href: "/dashboard", icon: "🏠", exact: true },
    { label: "My Tasks", href: "/dashboard/tasks", icon: "☑️", badge: taskCount ?? 0 },
    { label: "Calendar", href: "/dashboard/calendar", icon: "📅" },
    { label: "Notifications", href: "/dashboard/notifications", icon: "🔔", badge: unreadCount ?? 0 },
    { label: "Messages", href: "/dashboard/messages", icon: "💬", badge: msgCount ?? 0 },
    { label: "My Learning", href: "/dashboard/learning", icon: "📚" },
    { label: "My Competencies", href: "/dashboard/passport", icon: "🎯" },
    { label: "Documents", href: "/dashboard/library", icon: "📄" },
    { label: "AI Assistant", href: "/dashboard/copilot", icon: "✨" },
    { label: "Workspaces", href: "/dashboard/launcher", icon: "🧭" },
    { label: "Profile", href: "/dashboard/profile", icon: "👤" },
    { label: "Activity", href: "/dashboard/activity", icon: "📈" },
    { label: "Preferences", href: "/dashboard/preferences", icon: "⚙️" },
  ];

  return (
    <div className="min-h-screen bg-gray-50 font-[family-name:var(--font-geist-sans)]">
      <MobileSidebar fullName={profile?.full_name ?? "Nurse"} role={profile?.role ?? "nurse"} isAdmin={profile?.role === "hospital_admin"} unread={unreadCount ?? 0} avatarUrl={profile?.avatar_url ?? null} />

      {/* ONE header, one skip link. The PUI-002 roll-out (f053146) left this layout with two GlobalHeaders
          stacked -- identical but for the title, one "Dashboard" and one "Personal Workspace" -- plus two
          skip links pointing at the same #main-content, which is an accessibility fault in its own right.
          "Personal Workspace" is the surviving title: it matches the banner directly beneath it and the
          PW-014 universal-landing model, where /dashboard IS the Personal Workspace rather than a generic
          dashboard. */}
      <a href="#main-content" className="cmp-skip-link">Skip to main content</a>
      <div className="hidden md:block md:ml-56">
        <GlobalHeader
          workspaceTitle="Personal Workspace"
          workspaceHref="/dashboard"
          user={header.user}
          workspaces={header.workspaces}
          units={header.units}
          activeUnitId={header.activeUnitId}
          notifications={header.notifications}
          messages={header.messages}
        />
      </div>

      <div className="flex">
        <aside data-sidebar className="hidden md:flex w-56 h-screen bg-[#0f1b3d] flex-col py-5 px-3 fixed top-0 left-0 z-20">
          <SidebarToggle />
          <Link href="/dashboard" className="flex items-center gap-2 mb-5 px-2" data-sb-item>
            <div className="w-7 h-7 rounded-lg bg-[var(--cmp-color-information)] flex items-center justify-center text-white font-bold text-sm shrink-0">C</div>
            <span className="text-white font-semibold text-sm tracking-wide" data-sb-label>COMPETEN</span>
          </Link>

          <nav className="flex flex-col gap-0.5 flex-1 overflow-y-auto">
            {NAV.map(({ label, href, icon, exact, badge }) => (
              <NavLink key={label} href={href} icon={icon} label={label} exact={exact} badge={badge || undefined}
                className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] text-blue-100/70 hover:bg-blue-900/50 hover:text-white transition-colors"
                activeClassName="flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] bg-[var(--cmp-color-information)] text-white font-medium" />
            ))}
          </nav>

          {/* Current Shift card */}
          <div className="bg-blue-950/50 border border-blue-900/50 rounded-xl p-3 my-3" data-sb-label>
            {shift ? <>
              <div className="flex items-center justify-between"><span className="text-[10px] font-semibold text-blue-200/70 uppercase tracking-wide">Current Shift</span><span className="flex items-center gap-1 text-[9px] text-emerald-400">● {shift.status === "active" ? "In Progress" : shift.status}</span></div>
              <p className="text-white text-xs font-semibold mt-1">{SHIFT_TIMES[shift.type] ?? ""}</p>
              <p className="text-blue-200/60 text-[10px]">{shift.ward}</p>
              <p className="text-blue-200/60 text-[10px]">{SHIFT_LABEL[shift.type] ?? ""}</p>
              <Link href="/healthcare-worker" className="block text-center text-[11px] font-medium text-white bg-[var(--cmp-color-information)] hover:bg-[var(--cmp-color-information)] rounded-lg py-1.5 mt-2">Open Shift Workspace</Link>
            </> : <>
              <span className="text-[10px] font-semibold text-blue-200/70 uppercase tracking-wide">Current Shift</span>
              <p className="text-blue-200/60 text-[11px] mt-1">No active shift.</p>
            </>}
          </div>

          <a href="mailto:gabriel@semacast.com?subject=Competen support request" className="bg-blue-950/30 rounded-xl p-3 flex items-center gap-2 hover:bg-blue-900/40 transition-colors" data-sb-label>
            <span className="text-lg">🎧</span>
            <span><span className="block text-white text-[11px] font-medium">Need Help?</span><span className="block text-blue-300/70 text-[10px]">Contact Support</span></span>
          </a>

          {/* PUI-002: user controls live in the global header; the sidebar is workflow navigation only. */}
        </aside>

        <div data-content className="flex-1 md:ml-56 min-h-screen flex flex-col">
          {/* PUI-002: the bespoke top bar is replaced by the shared GlobalHeader above. */}

          <ActiveContextBanner roleLabel={ROLE_CONFIG[activeRole]?.label ?? activeRole} primary={primaryWorkspace} />

          <main id="main-content" className="flex-1 px-4 md:px-6 pt-16 md:pt-6 pb-8">{children}</main>
        </div>
      </div>
    </div>
  );
}
