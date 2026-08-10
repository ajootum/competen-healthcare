"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import NavLink from "@/components/NavLink";
import NavGroup from "@/components/NavGroup";
import RoleSwitcher from "@/components/RoleSwitcher";
import type { AppRole } from "@/lib/roles";
import { parentHrefs } from "@/lib/nav/active";
import { filterHqNav } from "@/lib/hq/nav-filter";
import { GENERAL_NAV, CKP_NAV, STUDIO_NAV, AI_NAV, GOV_NAV, SYS_NAV, OVERVIEW_HREFS } from "./nav-tables";

// Super-admin sidebar with dedicated workspace shells. Inside /super-admin/ckp/*
// it renders the Clinical Knowledge Platform nav, and inside /super-admin/ai/*
// the AI & Intelligence Platform nav (each with NAVIGATION + QUICK ACCESS),
// matching their mockups; elsewhere it renders the full Mission Control nav.
// Branches on the pathname so the swap is instant on client navigation.
//
// The tables themselves live in ./nav-tables so the CP-HQ-NAV-001 capability filter can be asserted
// against the real data rather than a fixture.
/* eslint-disable @typescript-eslint/no-explicit-any */

// activeRole is NULLABLE as of CP-SPLIT-002. highestRole() returns null for an identity that holds no
// estate role at all, and RoleSwitcher indexes ROLE_CONFIG[activeRole] -- so passing a fabricated role
// to keep the type happy would print a badge the person does not hold, which is the exact defect this
// arc removes. No role, no switcher.
export default function WorkspaceSidebar({ profileName, roles, activeRole, workspaces, isOwner, hqCapabilities }: {
  profileName: string | null;
  roles: AppRole[];
  activeRole: AppRole | null;
  workspaces: any[];
  // ⚠ BOTH ARE REQUIRED, AND isOwner IS NOT DERIVABLE FROM hqCapabilities. The layout resolves capabilities
  // only for non-owners -- an owner reaches this component with hqCapabilities: [], because the owner branch
  // short-circuits before any HQ table is read. Inferring ownership from a non-empty list would blank the
  // sidebar for every platform owner. See src/lib/hq/nav-filter.ts.
  isOwner: boolean;
  hqCapabilities: string[];
}) {
  const pathname = usePathname();
  const inCkp = pathname.startsWith("/super-admin/ckp");
  const inStudio = pathname.startsWith("/super-admin/studio") || pathname.startsWith("/super-admin/content") || pathname.startsWith("/super-admin/assessment-methods");
  const inAi = pathname === "/super-admin/ai" || pathname.startsWith("/super-admin/ai/");
  const inGov = pathname === "/super-admin/governance" || pathname.startsWith("/super-admin/governance/");
  const inSys = pathname === "/super-admin/system" || pathname.startsWith("/super-admin/system/");
  const inWorkspace = inCkp || inStudio || inAi || inGov || inSys;
  const table = inCkp ? CKP_NAV : inStudio ? STUDIO_NAV : inAi ? AI_NAV : inGov ? GOV_NAV : inSys ? SYS_NAV : GENERAL_NAV;
  // CP-HQ-NAV-001. Owners get `table` back unchanged.
  const nav = filterHqNav(table, { isOwner, capabilities: hqCapabilities });
  // ⚠ FLATTENED ACROSS GROUPS, NOT COMPUTED PER GROUP. /super-admin sits alone in MISSION CONTROL and is a
  // prefix of every other entry in the sidebar, so a per-group scan would never see it as a parent at all.
  //
  // ⚠ AND DERIVED FROM THE UNFILTERED TABLE. If a viewer cannot see a child, the parent would stop looking
  // like a parent and revert to prefix matching -- so in observe mode, where a would_deny still renders the
  // page, an appointee standing on a hidden child would light up its parent. Highlighting must not depend on
  // who is looking.
  const exactHrefs = parentHrefs(table.flatMap(g => g.items));
  const home = inCkp ? "/super-admin/ckp" : inStudio ? "/super-admin/studio" : inAi ? "/super-admin/ai" : inGov ? "/super-admin/governance" : inSys ? "/super-admin/system" : "/super-admin";
  const subtitle = inCkp ? "Clinical Knowledge Platform" : inStudio ? "Competency Studio" : inAi ? "AI & Intelligence" : inGov ? "Governance & Compliance" : inSys ? "System & Security" : "Mission Control";
  // ⚠ THE NAME OF THIS PLACE, AS TOLD TO THE PERSON STANDING IN IT. "Super Admin" is a role, and an HQ
  // appointee does not hold it -- Elisha holds a POSITION (Practice Product Director) that opens three
  // pages. Labelling their console "Super Admin" would tell them something untrue about their own
  // authority, in the one product whose entire point is that a position is not a role.
  const spaceLabel = isOwner ? "Super Admin" : "Competen HQ";

  return (
    <>
      <Link href={home} className="flex items-center gap-2 mb-6 px-2" data-sb-item>
        <div className="w-7 h-7 rounded bg-[var(--cmp-color-error)] flex items-center justify-center text-white font-bold text-sm">C</div>
        <div className="flex flex-col leading-none" data-sb-label>
          <span className="text-white font-semibold text-sm">Competen</span>
          <span className="text-rose-300/70 text-[10px] font-medium">{subtitle}</span>
        </div>
      </Link>

      {inWorkspace ? (
        <Link href="/super-admin" className="flex items-center gap-2 px-3 mb-3 text-[10px] font-semibold text-slate-500 hover:text-white transition-colors" data-sb-label>
          ← {spaceLabel}
        </Link>
      ) : (
        <div className="px-3 mb-4" data-sb-label>
          <span className="text-[10px] font-bold text-rose-400/70 uppercase tracking-widest">{spaceLabel} Workspace</span>
        </div>
      )}

      <nav className="flex flex-col gap-0.5 flex-1 overflow-y-auto">
        {nav.map(({ group, items }) => (
          <NavGroup key={group} title={group} hrefs={items.map(i => i.href)} headerClass="text-[9px] font-bold text-slate-600 uppercase tracking-widest">
            {items.map(({ label, href, icon }) => (
              <NavLink key={label} href={href} icon={icon} label={label}
                exact={OVERVIEW_HREFS.has(href) || exactHrefs.has(href.split("?")[0])}
                className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-xs text-slate-400 hover:bg-rose-900/30 hover:text-white transition-colors"
                activeClassName="flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-xs bg-rose-900/50 text-white font-medium" />
            ))}
          </NavGroup>
        ))}
      </nav>

      <div className="pt-4 border-t border-slate-800/60">
        <div className="flex items-center gap-2 px-3 py-2">
          <div className="w-7 h-7 rounded-full bg-[var(--cmp-color-error)] flex items-center justify-center text-white text-xs font-bold">{profileName?.[0] ?? "S"}</div>
          <div className="flex-1 min-w-0" data-sb-label>
            <p className="text-white text-xs font-medium truncate">{profileName}</p>
            {/* ⚠ THIS LINE IS ABOUT THE PERSON, NOT THE PLACE, SO IT MUST BE TRUE OF THEM. It read
                "Platform Owner"/"Super Admin" for everybody, which was safe while super_admin was the only
                way in and became false the moment an appointment could open this door. It names no
                position -- what somebody holds is not the sidebar's to disclose -- only that they are here
                by appointment rather than by ownership. */}
            <p className="text-rose-300/60 text-[10px]">{isOwner ? (inWorkspace ? "Platform Owner" : "Super Admin") : "HQ Appointee"}</p>
          </div>
        </div>
        {activeRole !== null && (roles.length > 1 || workspaces.length > 0) && (
          <div className="mb-2" data-sb-label><RoleSwitcher roles={roles} activeRole={activeRole} workspaces={workspaces} /></div>
        )}
        <form action="/api/auth/logout" method="POST">
          <button type="submit" data-sb-item className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-slate-500 hover:bg-slate-800/30 hover:text-white transition-colors">
            <span className="w-5 text-center">↩</span>
            <span data-sb-label>Sign out</span>
          </button>
        </form>
      </div>
    </>
  );
}
