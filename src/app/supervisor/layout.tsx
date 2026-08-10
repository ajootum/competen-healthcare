import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import NavLink from "@/components/NavLink";
import NavGroup from "@/components/NavGroup";
import SidebarToggle from "@/components/SidebarToggle";
import { type AppRole } from "@/lib/roles";
import { admitToEstate, NO_MEMBERSHIP_DESTINATION } from "@/lib/platform-membership";
import { resolveSswNavigation } from "@/lib/ssw/navigation";
import GlobalHeader from "@/components/platform/GlobalHeader";
import { loadHeaderContext } from "@/lib/platform/header";

// Shift Command Centre (SSW-001) — the real-time operational command surface for
// a clinical shift, organised into the twelve operational domains a supervisor
// actually works in. Role-scoped to operational coordinators (charge nurse /
// shift supervisor = assessor tier, and admins).
//
// The sidebar is no longer hard-coded here: it is RESOLVED from the workspace
// configuration engine (src/lib/ssw/navigation.ts), so a hospital can hide,
// rename or reorder any module through the WCE Designer without a deployment.
// Items link to live surfaces; capabilities without a built surface yet are
// shown muted ("soon") rather than as dead links.
/* eslint-disable @typescript-eslint/no-explicit-any */

const ALLOWED = ["assessor", "hospital_admin", "super_admin"];
const linkCls = "flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-[13px] text-teal-100/70 hover:bg-teal-800/50 hover:text-white transition-colors";
const activeCls = "flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-[13px] bg-teal-700/60 text-white font-medium";

export default async function SupervisorLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("full_name, role, roles, hospital_id").eq("id", user.id).single();
  // One resolver for every workspace, so the header cannot drift between them (PUI-002).
  const header = await loadHeaderContext(admin, user.id, { currentHref: "/supervisor" });
  const userRoles: AppRole[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean) as AppRole[];

  // -- CP-SPLIT-002 stage 3 -- GATE 1: THE ESTATE ADMITS COMPETEN PLATFORM MEMBERS ------------------
  // COMP-ARCH-PSA-001 s7 and s14. An identity with no platform_membership row is a Competen Practice
  // practitioner (or nobody yet), reaches no estate surface, and is sent to the product it DOES belong
  // to -- not to a 404 and not to a dead "Access restricted" panel.
  //
  // The whole decision lives in one module so these eleven layouts cannot drift from each other: a
  // super_admin is answered WITHOUT reading the table (the break-glass), and a store that cannot be
  // read ADMITS and falls back to the estate role gate below rather than blanking the platform for all
  // 47 people. Both choices are argued at length in src/lib/platform-membership.ts.
  if (!(await admitToEstate(admin, user.id, userRoles)).admitted) redirect(NO_MEMBERSHIP_DESTINATION);


  if (!userRoles.some(r => ALLOWED.includes(r))) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-4xl mb-3">🔒</p>
          <h1 className="text-lg font-bold text-gray-900">Access restricted</h1>
          <p className="text-gray-400 text-sm mt-1">The Shift Command Centre is for charge nurses, shift supervisors and managers.</p>
          <Link href="/dashboard" className="mt-4 inline-block text-sm text-teal-600 hover:underline">← Back to dashboard</Link>
        </div>
      </div>
    );
  }

  // ── Live nav badges / unread counts (SSW-001-R2 Ch.14) ──────────────────────
  // Hospital-scoped counts feeding the sidebar attention chips. Fail-soft: any
  // query error (e.g. pre-migration) resolves to 0, so the nav never breaks.
  const bSuper = userRoles.includes("super_admin");
  const bHid = (profile as any)?.hospital_id ?? null;
  const bNONE = "00000000-0000-0000-0000-000000000000";
  const bScope = (q: any) => (bSuper ? q : q.eq("hospital_id", bHid ?? bNONE));
  const bNum = (r: any) => (r?.error ? 0 : r?.count ?? 0);
  const OPEN_TASK = "(completed,verified,cancelled)";
  const [unreadRes, escRes, taskRes, critRes, safetyRes, obsRes, handRes, concernRes, xferRes, mdtRes] = await Promise.all([
    admin.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("read", false),
    bScope(admin.from("op_escalations").select("id", { count: "exact", head: true })).in("status", ["open", "acknowledged"]),
    bScope(admin.from("op_tasks").select("id", { count: "exact", head: true })).not("status", "in", OPEN_TASK),
    bScope(admin.from("op_tasks").select("id", { count: "exact", head: true })).eq("priority", "urgent").not("status", "in", OPEN_TASK),
    bScope(admin.from("op_safety_alerts").select("id", { count: "exact", head: true })).eq("active", true),
    bScope(admin.from("op_observations").select("id", { count: "exact", head: true })).eq("status", "overdue"),
    bScope(admin.from("op_handovers").select("status").order("created_at", { ascending: false }).limit(1)),
    bScope(admin.from("op_concerns").select("id", { count: "exact", head: true })).in("status", ["open", "in_progress", "carried_forward"]),
    bScope(admin.from("op_patient_transfers").select("id", { count: "exact", head: true })).eq("status", "pending"),
    // MDT demand: patients awaiting review + actions still open (migration 160).
    bScope(admin.from("op_mdt_referrals").select("id", { count: "exact", head: true })).eq("status", "awaiting_review"),
  ]);
  const badges: Record<string, number> = {
    unread: bNum(unreadRes), escalations: bNum(escRes), openTasks: bNum(taskRes),
    criticalTasks: bNum(critRes), safety: bNum(safetyRes), overdueObs: bNum(obsRes),
    handover: (!handRes.error && handRes.data?.[0] && handRes.data[0].status !== "accepted") ? 1 : 0,
    concerns: bNum(concernRes),
    transfersPending: bNum(xferRes),
    mdtActions: bNum(mdtRes),
  };
  // ── Resolve the sidebar from workspace configuration (SSW nav engine) ───────
  // Catalogue in code, sparse overrides in the DB, resolved platform -> tenant
  // -> hospital -> unit -> role -> user. Fails soft to catalogue defaults.
  const { sections } = await resolveSswNavigation(admin, {
    hospitalId: bHid, roles: userRoles, userId: user.id,
  });
  const landing = sections.find(s => s.section === null)?.items ?? [];
  const groups = sections.filter(s => s.section !== null);

  const groupBadge = (items: { href?: string; soon?: boolean; badge?: string }[]) =>
    [...new Set(items.filter(i => i.href && !i.soon && i.badge).map(i => i.badge!))].reduce((n, k) => n + (badges[k] ?? 0), 0);

  // Flat list of real (non-soon) destinations for the mobile pill bar, deduped by href.
  const mobileItems = [...new Map(sections.flatMap(s => s.items).filter(i => i.href && !i.soon).map(i => [i.href, i] as const)).values()];

  return (
    <div className="min-h-screen bg-gray-50 font-[family-name:var(--font-geist-sans)]">
      <header className="md:hidden fixed top-0 left-0 right-0 z-40 bg-[#0a2e38] shadow-lg">
        <div className="h-12 flex items-center gap-2 px-3">
          <span className="w-7 h-7 rounded bg-teal-500 flex items-center justify-center text-white font-bold text-sm shrink-0">C</span>
          <span className="min-w-0">
            <span className="block text-white font-semibold text-sm leading-tight">Competen</span>
            <span className="block text-teal-300/60 text-[10px] leading-tight">Shift Command Centre</span>
          </span>
          <span className="flex-1" />
          <Link href="/dashboard" className="text-[11px] text-teal-100/70 border border-teal-800 rounded-lg px-2.5 py-1">⊞ My Dashboard</Link>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-2">
          {mobileItems.map(({ label, href }) => (
            <Link key={href} href={href!} className="shrink-0 text-[11px] text-teal-100/80 bg-teal-800/50 hover:bg-teal-700/60 rounded-full px-3 py-1 transition-colors">{label}</Link>
          ))}
        </nav>
      </header>

      <a href="#main-content" className="cmp-skip-link">Skip to main content</a>
      <div className="hidden md:block md:ml-56">
        <GlobalHeader
          workspaceTitle="Shift Command Centre"
          workspaceHref="/supervisor"
          user={header.user}
          workspaces={header.workspaces}
          units={header.units}
          activeUnitId={header.activeUnitId}
          notifications={header.notifications}
          messages={header.messages}
        />
      </div>

      <div className="flex">
        <aside data-sidebar className="hidden md:flex w-56 h-screen bg-[#0a2e38] flex-col py-6 px-4 fixed top-0 left-0 z-20">
          <SidebarToggle />
          <Link href="/supervisor" className="flex items-center gap-2 mb-4 px-2" data-sb-item>
            <div className="w-7 h-7 rounded bg-teal-500 flex items-center justify-center text-white font-bold text-sm">C</div>
            <span className="min-w-0" data-sb-label>
              <span className="block text-white font-semibold text-sm leading-tight">Competen</span>
              <span className="block text-teal-300/60 text-[9px] leading-tight">Shift Command Centre</span>
            </span>
          </Link>

          <nav className="flex flex-col gap-0.5 flex-1 overflow-y-auto">
            {landing.map(({ key, label, href, icon, exact }) => (
              <NavLink key={key} href={href!} icon={icon} label={label} exact={exact}
                className={linkCls} activeClassName={activeCls} />
            ))}
            <div className="my-1.5 border-t border-teal-800/30" />
            {groups.map(({ section, items }) => {
              const nodes = items.map(({ key, label, href, icon, exact, soon, badge }) => soon || !href ? (
                <span key={key} title={label} data-sb-item
                  className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-[13px] text-teal-100/25 cursor-default select-none">
                  <span className="w-5 text-center text-sm leading-none opacity-60">{icon}</span>
                  <span className="flex-1" data-sb-label>{label}</span>
                  <span className="text-[8px] font-bold uppercase tracking-wider bg-teal-950 text-teal-400/40 rounded px-1 py-0.5" data-sb-label>soon</span>
                </span>
              ) : (
                <NavLink key={key} href={href} icon={icon} label={label} exact={exact}
                  badge={badge ? badges[badge] : undefined}
                  className={linkCls} activeClassName={activeCls} />
              ));
              return (
                <NavGroup key={section!} title={section!} hrefs={items.filter(i => i.href).map(i => i.href!.split(/[?#]/)[0])}
                  badge={groupBadge(items)}
                  headerClass="text-[9px] font-bold uppercase tracking-widest text-teal-400/50">{nodes}</NavGroup>
              );
            })}
            <div className="my-2 border-t border-teal-800/30" />
            <Link href="/dashboard" data-sb-item title="My Dashboard" className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-[13px] text-teal-100/40 hover:bg-teal-800/50 hover:text-white transition-colors">
              <span className="w-5 text-center text-sm">⊞</span>
              <span data-sb-label>My Dashboard</span>
            </Link>
          </nav>

          {/* PUI-002: user controls live in the global header; the sidebar is workflow navigation only. */}
        </aside>

        <main id="main-content" data-content className="flex-1 md:ml-56 px-4 md:px-6 pt-24 md:pt-8 pb-8 max-w-7xl">{children}</main>
      </div>
    </div>
  );
}
