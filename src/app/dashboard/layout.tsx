import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";
import MobileSidebar from "./MobileSidebar";
import RoleSwitcher from "@/components/RoleSwitcher";
import NavLink from "@/components/NavLink";
import SidebarToggle from "@/components/SidebarToggle";
import { highestRole, ROLE_CONFIG, ROLE_PRIORITY, type AppRole } from "@/lib/roles";
import { workspaceLinksForUser } from "@/lib/workspace-links";
import ActiveContextBanner from "./ActiveContextBanner";

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
  const firstName = profile?.full_name?.split(" ")[0] ?? "Nurse";
  const userRoles: AppRole[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean) as AppRole[];
  const cookieStore = await cookies();
  const activeRole = (cookieStore.get("active_role")?.value ?? highestRole(userRoles)) as AppRole;
  const workspaces = await workspaceLinksForUser(admin, user.id, userRoles);

  // Universal-landing context (PW-014 PW-AC-01/05): everyone lands here, so surface the user's primary functional
  // workspace for a one-click jump. Prefer their highest non-nurse AppRole portal, else their first org workspace.
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

      <div className="flex">
        <aside data-sidebar className="hidden md:flex w-56 h-screen bg-[#0f1b3d] flex-col py-5 px-3 fixed top-0 left-0 z-20">
          <SidebarToggle />
          <Link href="/dashboard" className="flex items-center gap-2 mb-5 px-2" data-sb-item>
            <div className="w-7 h-7 rounded-lg bg-blue-500 flex items-center justify-center text-white font-bold text-sm shrink-0">C</div>
            <span className="text-white font-semibold text-sm tracking-wide" data-sb-label>COMPETEN</span>
          </Link>

          <nav className="flex flex-col gap-0.5 flex-1 overflow-y-auto">
            {NAV.map(({ label, href, icon, exact, badge }) => (
              <NavLink key={label} href={href} icon={icon} label={label} exact={exact} badge={badge || undefined}
                className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] text-blue-100/70 hover:bg-blue-900/50 hover:text-white transition-colors"
                activeClassName="flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] bg-blue-600 text-white font-medium" />
            ))}
          </nav>

          {/* Current Shift card */}
          <div className="bg-blue-950/50 border border-blue-900/50 rounded-xl p-3 my-3" data-sb-label>
            {shift ? <>
              <div className="flex items-center justify-between"><span className="text-[10px] font-semibold text-blue-200/70 uppercase tracking-wide">Current Shift</span><span className="flex items-center gap-1 text-[9px] text-emerald-400">● {shift.status === "active" ? "In Progress" : shift.status}</span></div>
              <p className="text-white text-xs font-semibold mt-1">{SHIFT_TIMES[shift.type] ?? ""}</p>
              <p className="text-blue-200/60 text-[10px]">{shift.ward}</p>
              <p className="text-blue-200/60 text-[10px]">{SHIFT_LABEL[shift.type] ?? ""}</p>
              <Link href="/healthcare-worker" className="block text-center text-[11px] font-medium text-white bg-blue-600 hover:bg-blue-500 rounded-lg py-1.5 mt-2">Open Shift Workspace</Link>
            </> : <>
              <span className="text-[10px] font-semibold text-blue-200/70 uppercase tracking-wide">Current Shift</span>
              <p className="text-blue-200/60 text-[11px] mt-1">No active shift.</p>
            </>}
          </div>

          <a href="mailto:gabriel@semacast.com?subject=Competen support request" className="bg-blue-950/30 rounded-xl p-3 flex items-center gap-2 hover:bg-blue-900/40 transition-colors" data-sb-label>
            <span className="text-lg">🎧</span>
            <span><span className="block text-white text-[11px] font-medium">Need Help?</span><span className="block text-blue-300/70 text-[10px]">Contact Support</span></span>
          </a>

          <div className="pt-3 mt-2 border-t border-blue-900/60">
            <div className="flex items-center gap-2 px-2 py-1.5">
              {profile?.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element -- avatar from Supabase storage
                <img src={profile.avatar_url} alt="" className="w-7 h-7 rounded-full object-cover border border-blue-800" />
              ) : (
                <div className="w-7 h-7 rounded-full bg-blue-500 flex items-center justify-center text-white text-xs font-bold">{firstName[0]}</div>
              )}
              <div className="flex-1 min-w-0" data-sb-label><p className="text-white text-xs font-medium truncate">{profile?.full_name}</p><p className="text-blue-300/60 text-[10px] capitalize">{profile?.role?.replace(/_/g, " ")}</p></div>
            </div>
            {(userRoles.length > 1 || workspaces.length > 0) && <div className="mb-1" data-sb-label><RoleSwitcher roles={userRoles} activeRole={activeRole} workspaces={workspaces} /></div>}
            <form action="/api/auth/logout" method="POST"><button type="submit" data-sb-item className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-blue-200/50 hover:bg-blue-900/30 hover:text-white transition-colors"><span className="w-5 text-center">↩</span><span data-sb-label>Sign out</span></button></form>
          </div>
        </aside>

        <div data-content className="flex-1 md:ml-56 min-h-screen flex flex-col">
          {/* Global top bar — search + profile (PW-001 §Layout) */}
          <header className="hidden md:flex items-center gap-3 px-6 h-14 border-b border-gray-200 bg-white sticky top-0 z-10">
            <div className="flex-1 max-w-md relative">
              <input placeholder="Search anything…" className="w-full border border-gray-200 rounded-lg pl-9 pr-3 py-2 text-sm bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
              <span className="absolute left-3 top-2.5 text-gray-400 text-sm">🔍</span>
            </div>
            <span className="flex-1" />
            <Link href="/dashboard/copilot" className="text-gray-400 hover:text-blue-600" title="AI Assistant">✨</Link>
            <a href="mailto:gabriel@semacast.com" className="text-gray-400 hover:text-gray-600" title="Help">❓</a>
            <Link href="/dashboard/messages" className="text-gray-400 hover:text-gray-600" title="Messages">💬</Link>
            <Link href="/dashboard/notifications" className="relative text-gray-400 hover:text-gray-600" title="Notifications">🔔{(unreadCount ?? 0) > 0 && <span className="absolute -top-1.5 -right-1.5 bg-rose-500 text-white text-[8px] font-bold rounded-full w-3.5 h-3.5 flex items-center justify-center">{unreadCount}</span>}</Link>
            <div className="flex items-center gap-2 border-l border-gray-200 pl-3">
              {profile?.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element -- avatar from Supabase storage
                <img src={profile.avatar_url} alt="" className="w-8 h-8 rounded-full object-cover" />
              ) : (
                <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center text-white text-xs font-bold">{firstName[0]}</div>
              )}
              <div className="leading-tight"><p className="text-xs font-semibold text-gray-800">{profile?.full_name}</p><p className="text-[10px] text-gray-400">{shift?.ward ?? profile?.role?.replace(/_/g, " ")}</p></div>
            </div>
          </header>

          <ActiveContextBanner roleLabel={ROLE_CONFIG[activeRole]?.label ?? activeRole} primary={primaryWorkspace} />

          <main className="flex-1 px-4 md:px-6 pt-16 md:pt-6 pb-8">{children}</main>
        </div>
      </div>
    </div>
  );
}
