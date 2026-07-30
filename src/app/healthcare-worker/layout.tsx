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
import { buildShiftCard, loadShiftWidget } from "@/lib/hww/my-shift";

// Healthcare Worker Workspace shell (HWW-001 / ARCH-002 / UI-001) — the
// bedside nurse's patient-centred workspace. UI-001 is the authoritative
// sidebar: WORKFLOW-FIRST sections (Home / Shift / Clinical / Communication /
// Quality Events / Intelligence / Tools), My Patients ahead of the Assignment
// Inbox, live badges (tasks, medications, messages, escalations, inbox,
// concerns), a rich CURRENT SHIFT widget (patients, tasks, medications due,
// break status, progress), a user PROFILE menu replacing the bare Personal
// Workspace link, and the Clinical AI Copilot as a persistent floating action.
// Config-driven role-adaptive navigation (Doctor/Therapist/Pharmacist
// variants) is the platform's next step — this ships the nurse workspace per
// the spec's structure. Gate: nurse (primary), assessor tier, admins.
/* eslint-disable @typescript-eslint/no-explicit-any */
type NavItem = { label: string; href?: string; icon: string; exact?: boolean; soon?: boolean; badge?: string };
type NavEntry = { item: NavItem } | { group: string; icon?: string; items: NavItem[] };
type NavSection = { section: string | null; entries: NavEntry[] };

// HWW-UI-001 sidebar — sections in workflow order; collapsible groups only
// where the spec shows them (Clinical Assessment).
const NAV: NavSection[] = [
  { section: null, entries: [
    { item: { label: "Home", href: "/healthcare-worker", icon: "🏠", exact: true } },
  ]},
  { section: "Shift", entries: [
    { item: { label: "My Patients", href: "/healthcare-worker/patients", icon: "🧑‍⚕️" } },
    { item: { label: "My Tasks", href: "/healthcare-worker/tasks", icon: "✅", badge: "myTasks" } },
    { item: { label: "Medication Schedule", href: "/healthcare-worker/medications", icon: "💊", badge: "medsDue" } },
    { item: { label: "Assignment Inbox", href: "/healthcare-worker/inbox", icon: "📥", badge: "inbox" } },
    { item: { label: "Handover", href: "/healthcare-worker/handover", icon: "🔄" } },
  ]},
  { section: "Clinical", entries: [
    { group: "Clinical Assessment", items: [
      { label: "Observations & PEWS", href: "/healthcare-worker/observations", icon: "📈", badge: "obsDue" },
      { label: "Acuity Assessment", href: "/healthcare-worker/acuity", icon: "🌡️" },
      { label: "Workload Assessment", href: "/healthcare-worker/workload", icon: "⚖️" },
    ]},
    { item: { label: "Escalations", href: "/healthcare-worker/safety", icon: "🚨", badge: "alerts" } },
    { item: { label: "Procedures", icon: "🩹", soon: true } },
  ]},
  { section: "Communication", entries: [
    { item: { label: "Messages", href: "/healthcare-worker/communication", icon: "💬", badge: "unread" } },
    { item: { label: "Unit Announcements", href: "/healthcare-worker/communication#announcements", icon: "📣" } },
  ]},
  { section: "Quality Events", entries: [
    { item: { label: "Incidents", href: "/healthcare-worker/safety#incidents", icon: "🚩" } },
    { item: { label: "Nurse Concerns", href: "/healthcare-worker/concerns", icon: "⚠️", badge: "concerns" } },
  ]},
  { section: "Intelligence", entries: [
    { item: { label: "AI Copilot", href: "/healthcare-worker/copilot", icon: "✨" } },
  ]},
  { section: "Tools", entries: [
    { item: { label: "Reports", href: "/healthcare-worker/shift-summary", icon: "📋" } },
    { item: { label: "Settings", href: "/dashboard/preferences", icon: "⚙️" } },
  ]},
];

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

  // Live badges — the nurse's OWN counts. Fail-soft: errors resolve to 0.
  const bNum = (r: any) => (r?.error ? 0 : r?.count ?? 0);
  const { data: myAsg } = await admin.from("op_patient_assignments").select("patient_id").eq("staff_id", user.id).eq("status", "active").limit(100);
  const myPatientIds = ((myAsg ?? []) as any[]).map(r => r.patient_id).filter(Boolean);
  const [unreadRes, taskRes, concernRes, actionRes, obsRes, alertRes, shiftRes, pendAsgRes, pendXferRes] = await Promise.all([
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
    admin.from("op_shift_staff")
      .select("status, op_shifts!shift_id(id, shift_date, shift_type, status, starts_at, ends_at, units!unit_id(name), departments!department_id(name))")
      .eq("staff_id", user.id).limit(20),
    admin.from("op_patient_assignments").select("id", { count: "exact", head: true }).eq("staff_id", user.id).eq("status", "pending_acceptance"),
    admin.from("op_patient_transfers").select("id", { count: "exact", head: true }).eq("receiving_staff_id", user.id).eq("status", "awaiting_acceptance"),
  ]);

  const activeShift = ((shiftRes.data ?? []) as any[]).map(d => d.op_shifts).find((s: any) => s?.status === "active") ?? null;
  const shiftCard = buildShiftCard(activeShift);
  const widget = await loadShiftWidget(admin, user.id, myPatientIds, activeShift?.id ?? null);

  const badges: Record<string, number> = {
    unread: bNum(unreadRes), myTasks: bNum(taskRes), obsDue: bNum(obsRes), alerts: bNum(alertRes),
    concerns: bNum(concernRes) + bNum(actionRes), inbox: bNum(pendAsgRes) + bNum(pendXferRes),
    medsDue: widget.medsDue,
  };
  const groupBadge = (items: NavItem[]) =>
    [...new Set(items.filter(i => i.href && !i.soon && i.badge).map(i => i.badge!))].reduce((n, k) => n + (badges[k] ?? 0), 0);

  const allItems: NavItem[] = NAV.flatMap(s => s.entries.flatMap(e => ("item" in e ? [e.item] : e.items)));
  const mobileItems = [...new Map(allItems.filter(i => i.href && !i.soon).map(i => [i.href!.split(/[?#]/)[0], i] as const)).values()];

  const renderItem = ({ label, href, icon, exact, soon, badge }: NavItem) => soon || !href ? (
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
  );

  const PROFILE_LINKS = [
    { label: "My Profile", href: "/dashboard/profile", icon: "🙍" },
    { label: "Competency Passport", href: "/dashboard/passport", icon: "🎖️" },
    { label: "My Learning", href: "/dashboard/learning", icon: "📚" },
    { label: "Documents", href: "/dashboard/documents", icon: "📄" },
    { label: "Preferences", href: "/dashboard/preferences", icon: "⚙️" },
    { label: "Personal Workspace", href: "/dashboard", icon: "⊞" },
  ];

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
          <Link href="/dashboard" className="text-[11px] text-emerald-100/70 border border-emerald-800 rounded-lg px-2.5 py-1">⊞ Personal</Link>
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
            {NAV.map((s, i) => (
              <div key={s.section ?? `s${i}`} className="flex flex-col gap-0.5">
                {s.section && <p className="px-3 pt-2.5 pb-0.5 text-[9px] font-bold uppercase tracking-widest text-emerald-400/50" data-sb-label>{s.section}</p>}
                {s.entries.map(e => "item" in e ? renderItem(e.item) : (
                  <NavGroup key={e.group} title={e.group} hrefs={e.items.filter(i2 => i2.href).map(i2 => i2.href!.split(/[?#]/)[0])}
                    badge={groupBadge(e.items)}
                    headerClass="text-[11px] font-semibold text-emerald-100/60">
                    {e.items.map(renderItem)}
                  </NavGroup>
                ))}
              </div>
            ))}
          </nav>

          {/* CURRENT SHIFT widget (UI-001): counts + break status + progress */}
          {shiftCard && (
            <div className="mx-1 mb-2 rounded-xl bg-emerald-900/60 border border-emerald-800/60 p-3" data-sb-label>
              <div className="flex items-center justify-between">
                <span className="text-[9px] font-bold uppercase tracking-widest text-emerald-400/70">Current Shift</span>
                <span className="flex items-center gap-1 text-[9px] text-emerald-400">● In Progress</span>
              </div>
              <p className="text-white text-xs font-semibold mt-1">{shiftCard.window}{shiftCard.ward ? ` · ${shiftCard.ward}` : ""}</p>
              <div className="grid grid-cols-3 gap-1 mt-1.5 text-center">
                <div><p className="text-white text-sm font-bold tabular-nums">{myPatientIds.length}</p><p className="text-emerald-200/50 text-[8px] uppercase">Patients</p></div>
                <div><p className="text-white text-sm font-bold tabular-nums">{badges.myTasks}</p><p className="text-emerald-200/50 text-[8px] uppercase">Tasks</p></div>
                <div><p className="text-white text-sm font-bold tabular-nums">{badges.medsDue}</p><p className="text-emerald-200/50 text-[8px] uppercase">Meds Due</p></div>
              </div>
              <div className="h-1.5 rounded-full bg-emerald-950 overflow-hidden mt-2">
                <div className="h-full rounded-full bg-emerald-400" style={{ width: `${shiftCard.pct}%` }} />
              </div>
              <p className="text-emerald-200/60 text-[10px] mt-1">{shiftCard.remaining} remaining{widget.breakLabel ? ` · ☕ ${widget.breakLabel}` : ""}</p>
            </div>
          )}

          {/* User profile menu (UI-001: replaces the bare Personal Workspace link) */}
          <div className="pt-3 border-t border-emerald-800/60">
            <details className="group" data-sb-label>
              <summary className="flex items-center gap-2 px-3 py-2 cursor-pointer list-none rounded-lg hover:bg-emerald-800/30">
                <div className="w-7 h-7 rounded-full bg-emerald-400 flex items-center justify-center text-emerald-950 text-xs font-bold">{profile?.full_name?.[0] ?? "N"}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-white text-xs font-medium truncate">{profile?.full_name}</p>
                  <p className="text-emerald-300/60 text-[10px]">Healthcare Worker</p>
                </div>
                <span className="text-emerald-300/60 text-[10px] transition-transform group-open:rotate-180">▾</span>
              </summary>
              <div className="mt-1 mb-1 flex flex-col gap-0.5">
                {PROFILE_LINKS.map(l => (
                  <Link key={l.href} href={l.href} className="flex items-center gap-2 px-3 py-1 rounded-lg text-[12px] text-emerald-100/60 hover:bg-emerald-800/40 hover:text-white transition-colors">
                    <span className="w-4 text-center text-xs">{l.icon}</span>{l.label}
                  </Link>
                ))}
              </div>
            </details>
            {(userRoles.length > 1 || workspaces.length > 0) && <div className="mb-2" data-sb-label><RoleSwitcher roles={userRoles} activeRole={activeRole} workspaces={workspaces} /></div>}
            <form action="/api/auth/logout" method="POST">
              <button type="submit" data-sb-item className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-emerald-100/50 hover:bg-emerald-800/30 hover:text-white transition-colors">
                <span className="w-5 text-center">↩</span><span data-sb-label>Sign out</span>
              </button>
            </form>
          </div>
        </aside>

        <main data-content className="flex-1 md:ml-56 px-4 md:px-6 pt-24 md:pt-8 pb-8 max-w-7xl">{children}</main>

        {/* Clinical AI Copilot — persistent floating action (UI-001) */}
        <Link href="/healthcare-worker/copilot" title="Clinical AI Copilot"
          className="fixed bottom-6 right-6 z-30 w-12 h-12 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white text-xl flex items-center justify-center shadow-lg shadow-emerald-900/30 transition-colors">
          ✨
        </Link>
      </div>
    </div>
  );
}
