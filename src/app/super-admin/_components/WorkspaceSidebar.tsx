"use client";

import { useEffect, useId, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import NavLink from "@/components/NavLink";
import { NavGroupOrPlain } from "@/components/NavGroup";
import RoleSwitcher from "@/components/RoleSwitcher";
import type { AppRole } from "@/lib/roles";
import { parentHrefs, pathMatches } from "@/lib/nav/active";
import { filterHqNav } from "@/lib/hq/nav-filter";
import { matchNavSubject, navSearchTerms } from "@/lib/hq/nav-search";
import { isParentOpen, submenuWithOverview } from "@/lib/nav/expand";
import { HQ_WORKSPACES, OVERVIEW_HREFS, hqWorkspaceForPath, type HqSection, type NavEntry } from "./nav-tables";
import { setParentOpen, useParentRecords } from "./nav-expand-store";

// Competen HQ sidebar (COMPETEN-HQ-IA-02): seven workspaces, always listed, each opening into its
// contextual sections. Which workspace holds the page is the registry's answer for the pathname
// (hqWorkspaceForPath).
//
// HQ-NAV-EXPAND-01: A PARENT IS A DISCLOSURE, NOT A LINK. A workspace, or an item with children, is a
// button that opens and closes its submenu and never navigates -- on a tablet a tap on Governance must
// not leave the page. An item's own landing page is its submenu's first row, "Overview". The parent of
// the page you are on opens by itself, several parents may be open at once, and what you open stays open
// as you move (src/lib/nav/expand.ts holds the rule, ./nav-expand-store the choices).
//
// The registry lives in ./nav-tables so the CP-HQ-NAV-001 capability filter can be asserted against the
// real data rather than a fixture.
/* eslint-disable @typescript-eslint/no-explicit-any */

// ⚠ TOUCH TARGETS FOLLOW pointer-coarse, NEVER THE VIEWPORT WIDTH (the CPR-MOB-001 freeze). Written out in
// full, never composed from a variable inside a class name: Tailwind reads source text.
const TOUCH = "pointer-coarse:min-h-[var(--cp-touch)]";
const FOCUS = "focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-rose-300";
const ROW = `flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-xs text-slate-400 hover:bg-rose-900/30 hover:text-white transition-colors ${TOUCH} ${FOCUS}`;
const ROW_ACTIVE = `flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-xs bg-rose-900/50 text-white font-medium ${TOUCH} ${FOCUS}`;
const CHILD = `flex items-center gap-2 pl-9 pr-3 py-1 rounded-lg text-[11px] text-slate-400 hover:bg-rose-900/30 hover:text-white transition-colors ${TOUCH} ${FOCUS}`;
const CHILD_ACTIVE = `flex items-center gap-2 pl-9 pr-3 py-1 rounded-lg text-[11px] bg-rose-900/50 text-white font-medium ${TOUCH} ${FOCUS}`;

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
  const uid = useId();
  const records = useParentRecords();
  const domId = (key: string) => `${uid}-${key.replace(/[^a-z0-9-]/gi, "-")}`;

  // CP-HQ-NAV-001, per workspace. Owners get each table back unchanged; a workspace with nothing visible
  // is not drawn (the same rule that drops an empty group, one level up).
  const visible = HQ_WORKSPACES.map(w => {
    const table = w.sections;
    const nav = filterHqNav(table, { isOwner, capabilities: hqCapabilities });
    // ⚠ DERIVED FROM THE UNFILTERED TABLE, children included. If a viewer cannot see a child, the parent
    // would stop looking like a parent and revert to prefix matching -- so in observe mode an appointee
    // standing on a hidden child would light up its parent. Highlighting must not depend on who is looking.
    const exactHrefs = parentHrefs(table.flatMap(g => g.items.flatMap(i => [i, ...(i.children ?? [])])));
    return { w, nav, exactHrefs };
  }).filter(v => v.nav.length > 0);

  // ⚠ THE NAME OF THIS PLACE, AS TOLD TO THE PERSON STANDING IN IT. "Super Admin" is a role, and an HQ
  // appointee does not hold it -- Elisha holds a POSITION (Practice Product Director) that opens three
  // pages. Labelling their console "Super Admin" would tell them something untrue about their own
  // authority, in the one product whose entire point is that a position is not a role.
  const spaceLabel = isOwner ? "Super Admin" : "Competen HQ";
  const off = new Set(offSwitches ?? []);

  // THE SIDEBAR FILTER (owner, 29 Oct 2026). Typing replaces the tree with the matching rows, each with where it
  // lives, drawn from the SAME capability-filtered tables -- so a filter never shows a page the viewer cannot open.
  // Search HQ (Ctrl/Cmd+K) stays the search across every destination.
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();
  const matches = query ? sidebarMatches(visible.map(v => ({ label: v.w.label, sections: v.nav as HqSection[] })), query) : [];

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

      <div className="px-2 mb-3" data-sb-label>
        <label htmlFor={`${uid}-filter`} className="sr-only">Filter the menu</label>
        <input id={`${uid}-filter`} type="search" value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === "Escape") setQ(""); }}
          placeholder="Filter the menu…" autoComplete="off"
          className={`w-full rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-1.5 text-xs text-white placeholder:text-slate-500 ${TOUCH} ${FOCUS}`} />
      </div>

      <nav ref={navRef} aria-label="Competen HQ" className="flex flex-col gap-0.5 flex-1 overflow-y-auto">
        {query ? (
          <div aria-live="polite" className="flex flex-col gap-0.5">
            {matches.length === 0 ? (
              <div className="px-3 py-2 text-xs text-slate-400">
                <p>No menu item matches.</p>
                <button type="button" className={`mt-1 font-semibold text-rose-300 hover:text-white ${FOCUS}`}
                  onClick={() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }))}>Search all of HQ</button>
              </div>
            ) : matches.map(m => (
              <div key={m.e.key ?? m.e.href}>
                {row(m.e, OVERVIEW_HREFS.has(m.e.href))}
                <p className="px-3 pb-1 -mt-0.5 text-[10px] text-slate-500 truncate" data-sb-label>{m.where}{m.via?.length ? ` · matches: ${m.via.join(", ")}` : ""}</p>
              </div>
            ))}
          </div>
        ) : visible.map(({ w, nav, exactHrefs }) => {
          const wsKey = `ws:${w.key}`;
          const holdsPage = w.key === activeKey;
          const open = isParentOpen(holdsPage, records[wsKey], pathname);
          return (
            <div key={w.key} data-hq-workspace={w.key} className={open ? "mb-2" : undefined}>
              {/* The workspace row. Holding the page, it wears the SECTION tone, never the page fill:
                  exactly one row -- the page you are on -- carries the full treatment. */}
              <ParentToggle id={domId(wsKey)} open={open} holdsPage={holdsPage} icon={w.icon} label={w.label}
                onToggle={() => setParentOpen(wsKey, !open, pathname)}
                className={`flex w-full items-center gap-2.5 px-3 py-2 rounded-lg text-left text-[13px] transition-colors ${TOUCH} ${FOCUS} ${holdsPage ? "bg-white/5 text-white font-semibold" : "text-slate-300 hover:bg-rose-900/30 hover:text-white"}`} />
              <div id={domId(wsKey)} hidden={!open} className="flex flex-col gap-0.5">
                {nav.map(section => {
                  const s = section as HqSection; // filterHqNav spreads the section, so its key and plain survive
                  return (
                    <NavGroupOrPlain key={s.key} heading={s.plain ? null : section.group} hrefs={flat(section.items).map(i => i.href)} defaultOpen
                      headerClass="text-[9px] font-bold text-slate-400 uppercase tracking-widest">
                      {section.items.map(e => {
                        const kids = e.children ?? [];
                        if (kids.length === 0) return row(e, OVERVIEW_HREFS.has(e.href) || exactHrefs.has(e.href.split("?")[0]));
                        // An item with children: a disclosure whose submenu starts with its own page, "Overview".
                        const itemKey = `item:${e.key ?? e.href}`;
                        const submenu = submenuWithOverview(e, kids) as NavEntry[];
                        const holds = submenu.some(c => pathMatches(c.href, pathname, false));
                        const itemOpen = isParentOpen(holds, records[itemKey], pathname);
                        return (
                          <div key={e.key ?? e.href} className="flex flex-col gap-0.5">
                            <ParentToggle id={domId(itemKey)} open={itemOpen} holdsPage={holds} icon={e.icon} label={e.label}
                              status={offSwitches && e.flag && off.has(e.flag) ? "Off" : undefined}
                              onToggle={() => setParentOpen(itemKey, !itemOpen, pathname)}
                              className={`flex w-full items-center gap-2.5 px-3 py-1.5 rounded-lg text-left text-xs transition-colors ${TOUCH} ${FOCUS} ${holds ? "bg-white/5 text-white font-medium" : "text-slate-400 hover:bg-rose-900/30 hover:text-white"}`} />
                            <div id={domId(itemKey)} hidden={!itemOpen} className="flex flex-col gap-0.5">
                              {submenu.map(c => row(c, OVERVIEW_HREFS.has(c.href) || exactHrefs.has(c.href.split("?")[0]), true))}
                            </div>
                          </div>
                        );
                      })}
                    </NavGroupOrPlain>
                  );
                })}
              </div>
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

/**
 * A parent row (HQ-NAV-EXPAND-01). A real button, so Enter and Space work and focus is visible; it states
 * whether it is open (aria-expanded) and what it opens (aria-controls), and shows it with a chevron that
 * turns. It never navigates.
 */
function ParentToggle({ id, open, holdsPage, icon, label, status, onToggle, className }: {
  id: string; open: boolean; holdsPage: boolean; icon: string; label: string; status?: string;
  onToggle: () => void; className: string;
}) {
  return (
    <button type="button" aria-expanded={open} aria-controls={id} onClick={onToggle} data-sb-item title={label}
      data-holds-page={holdsPage || undefined} className={className}>
      <span className="w-5 text-center text-sm leading-none" aria-hidden>{icon}</span>
      <span className="flex-1" data-sb-label>{label}</span>
      {status && (
        <span aria-label={`(${status})`} className="rounded border border-slate-500/60 px-1 text-[9px] font-semibold uppercase tracking-wide text-slate-300" data-sb-label>{status}</span>
      )}
      <span className={`text-[9px] text-slate-400 transition-transform motion-reduce:transition-none ${open ? "rotate-90" : ""}`} aria-hidden data-sb-label>▶</span>
    </button>
  );
}

const flat = (items: NavEntry[]) => items.flatMap(i => [i, ...(i.children ?? [])]);

/**
 * The sidebar filter: every row whose label, location, keywords or route words match the query (the shared
 * matcher in lib/hq/nav-search.ts, the same one Search HQ uses), once each, best match first, with where it
 * lives ("Workspace › Group › Parent") and, when a keyword carried the match, that keyword in `via`. A row
 * also matches when its workspace, group or parent does, so typing a section name lists what is in it.
 * The input is already the viewer's capability-filtered tables, so a page they cannot open never matches.
 */
export function sidebarMatches(workspaces: { label: string; sections: HqSection[] }[], query: string, limit = 40): { e: NavEntry; where: string; via?: string[] }[] {
  const terms = navSearchTerms(query);
  if (terms.length === 0) return [];
  const hits: { e: NavEntry; where: string; via?: string[]; rank: number }[] = [];
  const seen = new Set<string>();
  for (const w of workspaces) for (const s of w.sections) for (const i of s.items) {
    const rows: { e: NavEntry; trail: (string | null | undefined)[] }[] = [{ e: i, trail: [w.label, s.plain ? null : s.group] }, ...(i.children ?? []).map(c => ({ e: c, trail: [w.label, s.plain ? null : s.group, i.label] }))];
    for (const r of rows) {
      const href = r.e.href.split("?")[0];
      if (seen.has(href)) continue;
      const hit = matchNavSubject({ label: r.e.label, href: r.e.href, trail: r.trail, keywords: r.e.keywords }, terms);
      if (!hit) continue;
      seen.add(href);
      hits.push({ e: r.e, where: r.trail.filter(Boolean).join(" › "), ...(hit.via.length ? { via: hit.via } : {}), rank: hit.rank });
    }
  }
  return hits.sort((a, b) => a.rank - b.rank).slice(0, limit).map(h => ({ e: h.e, where: h.where, ...(h.via ? { via: h.via } : {}) }));
}
