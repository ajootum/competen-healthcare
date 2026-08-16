import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import NavLink from "@/components/NavLink";
import NavGroup from "@/components/NavGroup";
import SidebarToggle from "@/components/SidebarToggle";
import { estateRolesOf, type AppRole } from "@/lib/roles";
import GlobalHeader from "@/components/platform/GlobalHeader";
import { loadHeaderContext } from "@/lib/platform/header";
import { buildShiftCard, loadShiftWidget } from "@/lib/hww/my-shift";
import { resolveHwwNavigation, resolveUnitContext, type ResolvedItem } from "@/lib/hww/navigation";
import { orgRolesOf } from "@/lib/roles";

// Healthcare Worker Workspace shell (HWW-001 / ARCH-002 / UI-001) — the
// bedside nurse's patient-centred workspace. The sidebar is GENERATED from
// workspace configuration (src/lib/hww/navigation.ts + the WCE override
// store), not hard-coded: workflow-first sections, role- and unit-adaptive
// visibility, and hospital-level enable/rename/reorder without a deployment.
// Plus live badges, the CURRENT SHIFT widget (patients, tasks, medications
// due, break status, progress), a user PROFILE menu, and the Clinical AI
// Copilot as a persistent floating action.
// Gate: nurse (primary), assessor tier, admins.
/* eslint-disable @typescript-eslint/no-explicit-any */
type NavItem = ResolvedItem;

const ALLOWED = ["nurse", "assessor", "hospital_admin", "super_admin"];
const linkCls = "flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-[13px] text-emerald-100/70 hover:bg-emerald-800/50 hover:text-white transition-colors";
const activeCls = "flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-[13px] bg-emerald-700/60 text-white font-medium";

export default async function HealthcareWorkerLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("full_name, role, roles, org_role, org_roles, hospital_id").eq("id", user.id).single();
  const userRoles: AppRole[] = estateRolesOf(profile) as AppRole[];

  if (!userRoles.some(r => ALLOWED.includes(r))) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-4xl mb-3">🔒</p>
          <h1 className="text-lg font-bold text-gray-900">Access restricted</h1>
          <p className="text-gray-400 text-sm mt-1">The Healthcare Worker Workspace is for bedside clinicians and their team leaders.</p>
          <Link href="/dashboard" className="mt-4 inline-block text-sm text-[var(--cmp-text-success)] hover:underline">← Back to dashboard</Link>
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
      .select("status, op_shifts!shift_id(id, shift_date, shift_type, status, starts_at, ends_at, unit_id, units!unit_id(name), departments!department_id(name))")
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

  // Config-driven navigation (UI-001): catalogue + WCE overrides, filtered by
  // the caller's roles/professions and their resolved unit context.
  // One resolver, every workspace — so the header cannot drift between them (PUI-002).
  const header = await loadHeaderContext(admin, user.id, { currentHref: "/healthcare-worker" });
  const unitType = await resolveUnitContext(admin, user.id, activeShift?.unit_id ?? null);
  const { sections: NAV } = await resolveHwwNavigation(admin, {
    hospitalId: profile?.hospital_id ?? null,
    unitId: activeShift?.unit_id ?? null,
    userId: user.id,
    roles: userRoles,
    professions: orgRolesOf(profile as any).filter(Boolean) as string[],
    unitType,
  });

  const allItems: NavItem[] = NAV.flatMap(s => s.entries.flatMap(e => ("item" in e ? [e.item] : e.items)));

  const mobileItems = [...new Map(allItems.filter(i => i.href && !i.soon).map(i => [i.href!.split(/[?#]/)[0], i] as const)).values()];

  const renderItem = ({ key, label, href, icon, exact, soon, badge, severity }: NavItem) => soon || !href ? (
    <span key={key} title={`${label} — coming soon`} data-sb-item
      className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-[13px] text-emerald-100/25 cursor-default select-none">
      <span className="w-5 text-center text-sm leading-none opacity-60">{icon}</span>
      <span className="flex-1" data-sb-label>{label}</span>
      <span className="text-[8px] font-bold uppercase tracking-wider bg-emerald-950 text-emerald-400/40 rounded px-1 py-0.5" data-sb-label>soon</span>
    </span>
  ) : (
    <NavLink key={key} href={href} icon={icon} label={label} exact={exact}
      badge={badge ? badges[badge] : undefined} severity={severity}
      className={linkCls} activeClassName={activeCls} />
  );

  return (
    <div className="min-h-screen bg-gray-50 font-[family-name:var(--font-geist-sans)]">
      <header className="md:hidden fixed top-0 left-0 right-0 z-40 bg-[#0a2f23] shadow-lg">
        <div className="h-12 flex items-center gap-2 px-3">
          <span className="w-7 h-7 rounded bg-[var(--cmp-color-success)] flex items-center justify-center text-white font-bold text-sm shrink-0">C</span>
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

      {/* Global header (PUI-002 / HWW-UI-002) — identical in every workspace. */}
      <a href="#main-content" className="cmp-skip-link">Skip to main content</a>
      <div className="hidden md:block md:ml-56">
        <GlobalHeader
          workspaceTitle="Healthcare Worker Workspace"
          workspaceHref="/healthcare-worker"
          user={header.user}
          workspaces={header.workspaces}
          units={header.units}
          activeUnitId={header.activeUnitId}
          notifications={header.notifications}
          messages={header.messages}
        />
      </div>

      <div className="flex">
        <aside data-sidebar className="hidden md:flex w-56 h-screen bg-[#0a2f23] flex-col py-6 px-4 fixed top-0 left-0 z-20">
          <SidebarToggle />
          <Link href="/healthcare-worker" className="flex items-center gap-2 mb-4 px-2" data-sb-item>
            <div className="w-7 h-7 rounded bg-[var(--cmp-color-success)] flex items-center justify-center text-white font-bold text-sm">C</div>
            <span className="min-w-0" data-sb-label>
              <span className="block text-white font-semibold text-sm leading-tight">Competen</span>
              <span className="block text-emerald-300/60 text-[9px] leading-tight">Healthcare Worker Workspace</span>
            </span>
          </Link>

          {/* HWW-UI-005B s4 explicitly prohibits a Command Palette, Quick Actions and Favourites. Removed
              rather than hidden behind a flag: a prohibited control that is one boolean from returning is
              not removed, it is dormant. */}
          <nav className="flex flex-col gap-0.5 flex-1 overflow-y-auto">
            {NAV.map((s, i) => {
              const entries = s.entries.map(e => "item" in e ? renderItem(e.item) : (
                <NavGroup key={e.group} title={e.group} hrefs={e.items.filter(i2 => i2.href).map(i2 => i2.href!.split(/[?#]/)[0])}
                  badge={groupBadge(e.items)}
                  headerClass="text-[11px] font-semibold text-emerald-100/60">
                  {e.items.map(renderItem)}
                </NavGroup>
              ));
              // A titled section is now an accordion too, not just its sub-groups: SHIFT / CLINICAL /
              // COMMUNICATION collapse the same way "Clinical Assessment" already did. Same NavGroup, so
              // there is one collapse mechanism rather than two that can drift -- it keeps the keyboard
              // behaviour, the auto-open-on-active-page, the saved state and the icon-rail rules for free.
              const items = s.entries.flatMap(e => "item" in e ? [e.item] : e.items);
              if (!s.section) return <div key={`s${i}`} className="flex flex-col gap-0.5">{entries}</div>;
              return (
                // s13 section dividers. A hairline above each titled section, never the first -- a rule at
                // the very top of the list separates nothing.
                <div key={s.section} className={i > 1 ? "mt-1 pt-1 border-t border-emerald-800/40" : undefined}>
                  <NavGroup title={s.section}
                    hrefs={items.filter(it => it.href).map(it => it.href!.split(/[?#]/)[0])}
                    badge={groupBadge(items)}
                    headerClass="text-[9px] font-bold uppercase tracking-widest text-emerald-400/50">
                    {entries}
                  </NavGroup>
                </div>
              );
            })}
          </nav>

          {/* CURRENT SHIFT widget (UI-001): counts + break status + progress. s4 "Do NOT redesign the
              Current Shift card" — restored to the previously approved form. */}
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
                <div className="h-full rounded-full bg-[var(--cmp-color-success)]" style={{ width: `${shiftCard.pct}%` }} />
              </div>
              <p className="text-emerald-200/60 text-[10px] mt-1">{shiftCard.remaining} remaining{widget.breakLabel ? ` · ☕ ${widget.breakLabel}` : ""}</p>
            </div>
          )}

          {/* HWW-UI-002: "Bottom of sidebar reserved for Current Shift status widget only." The profile
              menu, workspace switcher and Sign Out that used to sit here now live in the global header. */}
        </aside>

        <main id="main-content" data-content className="flex-1 md:ml-56 px-4 md:px-6 pt-24 md:pt-4 pb-8 max-w-7xl">{children}</main>

        {/* Clinical AI Copilot — persistent floating action (UI-001) */}
        <Link href="/healthcare-worker/copilot" title="Clinical AI Copilot"
          className="fixed bottom-6 right-6 z-30 w-12 h-12 rounded-full bg-[var(--cmp-color-success)] hover:bg-emerald-700 text-white text-xl flex items-center justify-center shadow-lg shadow-emerald-900/30 transition-colors">
          ✨
        </Link>
      </div>
    </div>
  );
}
