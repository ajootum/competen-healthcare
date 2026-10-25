"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import NavLink from "@/components/NavLink";
import { NavGroupOrPlain } from "@/components/NavGroup";
import RoleSwitcher from "@/components/RoleSwitcher";
import type { AppRole } from "@/lib/roles";
import { parentHrefs, pathMatches } from "@/lib/nav/active";
import { filterHqNav } from "@/lib/hq/nav-filter";
import { HQ_WORKSPACES, OVERVIEW_HREFS, hqWorkspaceForPath, type HqSection, type NavEntry } from "./nav-tables";

// Competen HQ sidebar (COMPETEN-HQ-IA-02): seven workspaces, always listed, and the one you are in
// expanded into its contextual sections. Which workspace is "in" is the registry's answer for the
// pathname (hqWorkspaceForPath), so the swap is instant on client navigation and needs no state.
//
// The registry lives in ./nav-tables so the CP-HQ-NAV-001 capability filter can be asserted against the
// real data rather than a fixture.
/* eslint-disable @typescript-eslint/no-explicit-any */

const ROW = "flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-xs text-slate-400 hover:bg-rose-900/30 hover:text-white transition-colors";
const ROW_ACTIVE = "flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-xs bg-rose-900/50 text-white font-medium";
const CHILD = "flex items-center gap-2 pl-9 pr-3 py-1 rounded-lg text-[11px] text-slate-400 hover:bg-rose-900/30 hover:text-white transition-colors";
const CHILD_ACTIVE = "flex items-center gap-2 pl-9 pr-3 py-1 rounded-lg text-[11px] bg-rose-900/50 text-white font-medium";

// activeRole is NULLABLE as of CP-SPLIT-002. highestRole() returns null for an identity that holds no
// estate role at all, and RoleSwitcher indexes ROLE_CONFIG[activeRole] -- so passing a fabricated role
// to keep the type happy would print a badge the person does not hold, which is the exact defect this
// arc removes. No role, no switcher.
export default function WorkspaceSidebar({ profileName, roles, activeRole, workspaces, isOwner, hqCapabilities, positionNames = [], offSwitches = null }: {
  profileName: string | null;
  roles: AppRole[];
  activeRole: AppRole | null;
  workspaces: any[];
  // ⚠ BOTH ARE REQUIRED, AND isOwner IS NOT DERIVABLE FROM hqCapabilities. The layout resolves capabilities
  // only for non-owners -- an owner reaches this component with hqCapabilities: [], because the owner branch
  // short-circuits before any HQ table is read. Inferring ownership from a non-empty list would blank the
  // sidebar for every platform owner. See src/lib/hq/nav-filter.ts.
  isOwner: boolean;
  /** CPR-PD-001 s6: the names of the live appointments this person is here by, for the identity line. */
  positionNames?: string[];
  hqCapabilities: string[];
  /**
   * The launch flags that are OFF, read on the server. Null when they could not be read: then no badge is
   * shown at all, because "Off" printed on a failed read is a claim nobody measured.
   * ⚠ A STATUS, NEVER A VISIBILITY INPUT. The link stays, because the page stays reachable to the people
   * who configure the product before anybody switches it on.
   */
  offSwitches?: string[] | null;
}) {
  const pathname = usePathname();
  const activeKey = hqWorkspaceForPath(pathname);
  // A deep page (a Practice child, a CGR module) can sit well below the fold of its workspace: bring the
  // lit row into view when the page changes. DOM only, no state.
  const navRef = useRef<HTMLElement>(null);
  useEffect(() => {
    navRef.current?.querySelector("a[aria-current=\"page\"]")?.scrollIntoView({ block: "nearest" });
  }, [pathname]);
  const inWorkspace = activeKey !== "mission";

  // CP-HQ-NAV-001, per workspace. Owners get each table back unchanged; a workspace with nothing visible
  // is not drawn (the same rule that drops an empty group, one level up).
  const visible = HQ_WORKSPACES.map(w => {
    const table = w.sections;
    const nav = filterHqNav(table, { isOwner, capabilities: hqCapabilities });
    // ⚠ DERIVED FROM THE UNFILTERED TABLE, children included. If a viewer cannot see a child, the parent
    // would stop looking like a parent and revert to prefix matching -- so in observe mode an appointee
    // standing on a hidden child would light up its parent. Highlighting must not depend on who is looking.
    const exactHrefs = parentHrefs(table.flatMap(g => g.items.flatMap(i => [i, ...(i.children ?? [])])));
    // The label goes to the first destination this viewer can open, in registry order: no landing page
    // was built for a workspace, and clicking a label must still have a predictable destination.
    const home = nav.flatMap(s => s.items).find(i => i.kind !== "cross" && i.kind !== "external")?.href
      ?? nav[0]?.items[0]?.href;
    return { w, nav, exactHrefs, home };
  }).filter(v => v.nav.length > 0 && v.home);

  // ⚠ THE NAME OF THIS PLACE, AS TOLD TO THE PERSON STANDING IN IT. "Super Admin" is a role, and an HQ
  // appointee does not hold it -- Elisha holds a POSITION (Practice Product Director) that opens three
  // pages. Labelling their console "Super Admin" would tell them something untrue about their own
  // authority, in the one product whose entire point is that a position is not a role.
  const spaceLabel = isOwner ? "Super Admin" : "Competen HQ";
  const off = new Set(offSwitches ?? []);

  const row = (e: NavEntry, exact: boolean, child = false) => (
    <NavLink key={e.key ?? e.href} href={e.href} icon={child ? "" : e.icon}
      label={e.kind === "cross" ? `${e.label} ↗` : e.label}
      exact={exact}
      status={offSwitches && e.flag && off.has(e.flag) ? "Off" : undefined}
      className={child ? CHILD : ROW}
      activeClassName={child ? CHILD_ACTIVE : ROW_ACTIVE} />
  );

  return (
    <>
      <Link href="/super-admin" className="flex items-center gap-2 mb-6 px-2" data-sb-item>
        <div className="w-7 h-7 rounded bg-[var(--cmp-color-error)] flex items-center justify-center text-white font-bold text-sm">C</div>
        <div className="flex flex-col leading-none" data-sb-label>
          <span className="text-white font-semibold text-sm">Competen</span>
          <span className="text-rose-300/70 text-[10px] font-medium">{HQ_WORKSPACES.find(w => w.key === activeKey)?.label ?? "Mission Control"}</span>
        </div>
      </Link>

      <div className="px-3 mb-4" data-sb-label>
        <span className="text-[10px] font-bold text-rose-300 uppercase tracking-widest">{spaceLabel} Workspace</span>
      </div>

      <nav ref={navRef} aria-label="Competen HQ" className="flex flex-col gap-0.5 flex-1 overflow-y-auto">
        {visible.map(({ w, nav, exactHrefs, home }) => {
          const open = w.key === activeKey;
          return (
            <div key={w.key} data-hq-workspace={w.key} className={open ? "mb-2" : undefined}>
              {/* The workspace row. Open, it wears the SECTION tone, never the page fill: exactly one row
                  -- the page you are on -- carries the full treatment. */}
              <Link href={home!} data-sb-item title={w.label}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] transition-colors ${open ? "bg-white/5 text-white font-semibold" : "text-slate-300 hover:bg-rose-900/30 hover:text-white"}`}>
                <span className="w-5 text-center text-sm leading-none" aria-hidden>{w.icon}</span>
                <span className="flex-1" data-sb-label>{w.label}</span>
                <span className={`text-[8px] text-slate-500 transition-transform ${open ? "rotate-90" : ""}`} aria-hidden data-sb-label>▶</span>
              </Link>
              {open && nav.map(section => {
                const s = section as HqSection; // filterHqNav spreads the section, so its key and plain survive
                return (
                  <NavGroupOrPlain key={s.key} heading={s.plain ? null : section.group} hrefs={flat(section.items).map(i => i.href)}
                    headerClass="text-[9px] font-bold text-slate-400 uppercase tracking-widest">
                    {section.items.map(e => {
                      const kids = e.children ?? [];
                      const showKids = kids.length > 0 && (pathMatches(e.href, pathname, false) || kids.some(c => pathMatches(c.href, pathname, false)));
                      return (
                        <div key={e.key ?? e.href} className="flex flex-col gap-0.5">
                          {row(e, OVERVIEW_HREFS.has(e.href) || exactHrefs.has(e.href.split("?")[0]))}
                          {showKids && kids.map(c => row(c, OVERVIEW_HREFS.has(c.href) || exactHrefs.has(c.href.split("?")[0]), true))}
                        </div>
                      );
                    })}
                  </NavGroupOrPlain>
                );
              })}
            </div>
          );
        })}
      </nav>

      <div className="pt-4 border-t border-slate-800/60">
        <div className="flex items-center gap-2 px-3 py-2">
          <div className="w-7 h-7 rounded-full bg-[var(--cmp-color-error)] flex items-center justify-center text-white text-xs font-bold">{profileName?.[0] ?? "S"}</div>
          <div className="flex-1 min-w-0" data-sb-label>
            <p className="text-white text-xs font-medium truncate">{profileName}</p>
            {/* ⚠ THIS LINE IS ABOUT THE PERSON, NOT THE PLACE, SO IT MUST BE TRUE OF THEM. It read
                "Platform Owner"/"Super Admin" for everybody, which was safe while super_admin was the only
                way in and became false the moment an appointment could open this door.
                ⚠ AND "HQ Appointee" IS SUPERSEDED (CPR-PD-001 s6, 2026-08-17, the owner reading it on
                screen). The identity area "should display the user's current effective role (for example,
                Practice Product Director) rather than the generic 'HQ Appointee' label". Newest document
                governs. "HQ Appointee" survives only as the honest fallback when no name resolves.
                ⚠ PLURAL IS NOT GUESSED AT. With more than one live appointment the effective one is
                whichever the governance cookie selects, and the "Acting as" switcher on the page is the
                authority -- it names the active one and can change it. */}
            <p className="text-rose-300 text-[10px]">
              {isOwner
                ? (inWorkspace ? "Platform Owner" : "Super Admin")
                : positionNames.length === 1 ? positionNames[0]
                : positionNames.length > 1 ? `${positionNames.length} HQ appointments`
                : "HQ Appointee"}
            </p>
          </div>
        </div>
        {activeRole !== null && (roles.length > 1 || workspaces.length > 0) && (
          <div className="mb-2" data-sb-label><RoleSwitcher roles={roles} activeRole={activeRole} workspaces={workspaces} /></div>
        )}
        {/* HWW-UI-002: "Sign Out is no longer displayed in the sidebar." It lives in the header user
            menu, which every workspace renders through the shared GlobalHeader -- one place to sign out,
            in the same position on every screen, rather than a second one that drifts. */}
      </div>
    </>
  );
}

const flat = (items: NavEntry[]) => items.flatMap(i => [i, ...(i.children ?? [])]);
