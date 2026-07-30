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

// Healthcare Worker Workspace (HWW-001 / HWW-WARD-001 / HWW-ARCH-002) — the
// bedside nurse's patient-centred operational workspace. ARCH-002 is the
// authoritative navigation: one flat sidebar in workflow order (dashboard →
// patients → tasks → medications → assessments → handover → communications →
// quality & safety → AI → reports), personal-productivity items stay in the
// Personal Workspace, and a live CURRENT SHIFT card anchors the sidebar.
// Gate: nurses (primary), team leaders/charge nurses (assessor tier), admins.
/* eslint-disable @typescript-eslint/no-explicit-any */
type NavItem = { label: string; href?: string; icon: string; exact?: boolean; soon?: boolean; badge?: string };
type NavEntry = { item: NavItem } | { group: string; items: NavItem[] };

// HWW-ARCH-002 S3 sidebar, verbatim order. "Assessments" and "Quality &
// Safety" expand to their live modules; Reports = the shift report surface.
const NAV: NavEntry[] = [
  { item: { label: "Shift Dashboard", href: "/healthcare-worker", icon: "🏠", exact: true } },
  { item: { label: "My Patients", href: "/healthcare-worker/patients", icon: "🧑‍⚕️" } },
  { item: { label: "My Tasks", href: "/healthcare-worker/tasks", icon: "✅", badge: "myTasks" } },
  { item: { label: "Medication Schedule", href: "/healthcare-worker/medications", icon: "💊" } },
  { group: "Assessments", items: [
    { label: "Observations & PEWS", href: "/healthcare-worker/observations", icon: "📈", badge: "obsDue" },
    { label: "Acuity Assessment", href: "/healthcare-worker/acuity", icon: "🌡️" },
    { label: "Workload Assessment", href: "/healthcare-worker/workload", icon: "⚖️" },
  ]},
  { item: { label: "Handover", href: "/healthcare-worker/handover", icon: "🔄" } },
  { item: { label: "Communications", href: "/healthcare-worker/communication", icon: "💬", badge: "unread" } },
  { group: "Quality & Safety", items: [
    { label: "Safety & Escalation", href: "/healthcare-worker/safety", icon: "🛡️", badge: "alerts" },
    { label: "Nurse Concerns", href: "/healthcare-worker/concerns", icon: "🚩", badge: "concerns" },
  ]},
  { item: { label: "Clinical AI Copilot", href: "/healthcare-worker/copilot", icon: "✨" } },
  { item: { label: "Reports", href: "/healthcare-worker/shift-summary", icon: "📋" } },
  { item: { label: "Tools & Settings", icon: "⚙️", soon: true } },
];

const ALLOWED = ["nurse", "assessor", "hospital_admin", "super_admin"];
const linkCls = "flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-[13px] text-emerald-100/70 hover:bg-emerald-800/50 hover:text-white transition-colors";
const activeCls = "flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-[13px] bg-emerald-700/60 text-white font-medium";

const fmtT = (iso: string | null) => iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }) : "--:--";
const dur = (ms: number) => `${Math.floor(ms / 3.6e6)}h ${Math.floor((ms % 3.6e6) / 6e4)}m`;

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

  // Live nav badges — the nurse's OWN counts. Fail-soft: errors resolve to 0.
  const bNum = (r: any) => (r?.error ? 0 : r?.count ?? 0);
  const { data: myAsg } = await admin.from("op_patient_assignments").select("patient_id").eq("staff_id", user.id).eq("status", "active").limit(100);
  const myPatientIds = ((myAsg ?? []) as any[]).map(r => r.patient_id).filter(Boolean);
  const [unreadRes, taskRes, concernRes, actionRes, obsRes, alertRes, shiftRes] = await Promise.all([
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
      .select("status, op_shifts!shift_id(shift_date, shift_type, status, starts_at, ends_at, units!unit_id(name), departments!department_id(name))")
      .eq("staff_id", user.id).limit(20),
  ]);
  const badges: Record<string, number> = { unread: bNum(unreadRes), myTasks: bNum(taskRes), obsDue: bNum(obsRes), alerts: bNum(alertRes), concerns: bNum(concernRes) + bNum(actionRes) };
  const groupBadge = (items: NavItem[]) =>
    [...new Set(items.filter(i => i.href && !i.soon && i.badge).map(i => i.badge!))].reduce((n, k) => n + (badges[k] ?? 0), 0);

  // CURRENT SHIFT card (ARCH-002 mockup): the caller's active shift with a
  // live elapsed/remaining progress bar — server-computed each request.
  const activeShift = ((shiftRes.data ?? []) as any[]).map(d => d.op_shifts).find((s: any) => s?.status === "active") ?? null;
  let shiftCard: { label: string; ward: string | null; window: string; elapsed: string; remaining: string; pct: number } | null = null;
  if (activeShift?.starts_at && activeShift?.ends_at) {
    const now = Date.now();
    const start = +new Date(activeShift.starts_at), end = +new Date(activeShift.ends_at);
    const pct = Math.max(0, Math.min(100, ((now - start) / Math.max(1, end - start)) * 100));
    shiftCard = {
      label: `${String(activeShift.shift_type ?? "").replace(/_/g, " ").replace(/\b\w/g, (ch: string) => ch.toUpperCase())} Shift`,
      ward: activeShift.units?.name ?? activeShift.departments?.name ?? null,
      window: `${fmtT(activeShift.starts_at)} – ${fmtT(activeShift.ends_at)}`,
      elapsed: dur(Math.max(0, now - start)),
      remaining: now >= end ? "ended" : dur(end - now),
      pct: Math.round(pct),
    };
  }

  const allItems: NavItem[] = NAV.flatMap(e => ("item" in e ? [e.item] : e.items));
  const mobileItems = [...new Map(allItems.filter(i => i.href && !i.soon).map(i => [i.href, i] as const)).values()];

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
            {NAV.map(e => "item" in e ? renderItem(e.item) : (
              <NavGroup key={e.group} title={e.group} hrefs={e.items.filter(i => i.href).map(i => i.href!.split(/[?#]/)[0])}
                badge={groupBadge(e.items)}
                headerClass="text-[9px] font-bold uppercase tracking-widest text-emerald-400/50">
                {e.items.map(renderItem)}
              </NavGroup>
            ))}
            <div className="my-2 border-t border-emerald-800/30" />
            <Link href="/dashboard" data-sb-item title="Personal Workspace" className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-[13px] text-emerald-100/40 hover:bg-emerald-800/50 hover:text-white transition-colors">
              <span className="w-5 text-center text-sm">⊞</span>
              <span data-sb-label>Personal Workspace</span>
            </Link>
          </nav>

          {/* CURRENT SHIFT card (ARCH-002) — live window + progress */}
          {shiftCard && (
            <div className="mx-1 mb-2 rounded-xl bg-emerald-900/60 border border-emerald-800/60 p-3" data-sb-label>
              <div className="flex items-center justify-between">
                <span className="text-[9px] font-bold uppercase tracking-widest text-emerald-400/70">Current Shift</span>
                <span className="flex items-center gap-1 text-[9px] text-emerald-400">● In Progress</span>
              </div>
              <p className="text-white text-xs font-semibold mt-1">{shiftCard.window} · {shiftCard.label}</p>
              {shiftCard.ward && <p className="text-emerald-200/60 text-[10px]">{shiftCard.ward}</p>}
              <div className="h-1.5 rounded-full bg-emerald-950 overflow-hidden mt-2">
                <div className="h-full rounded-full bg-emerald-400" style={{ width: `${shiftCard.pct}%` }} />
              </div>
              <p className="text-emerald-200/60 text-[10px] mt-1">{shiftCard.elapsed} elapsed · {shiftCard.remaining} remaining</p>
            </div>
          )}

          <div className="pt-3 border-t border-emerald-800/60">
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
