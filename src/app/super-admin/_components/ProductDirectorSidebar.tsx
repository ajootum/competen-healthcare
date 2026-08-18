"use client";

import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { parentHrefs, pathMatches } from "@/lib/nav/active";
import { useModalFocus } from "@/components/ui/use-modal-focus";
import type { WorkspaceLink } from "@/lib/roles";
import { PD_NAV, PD_HOME, PD_ALL_HREFS } from "./pd-nav";
import PdContextSwitcher from "./PdContextSwitcher";
import {
  PD_RAIL_FLYOUT_LEFT,
  PD_SIDEBAR_COOKIE,
  PD_SIDEBAR_COOKIE_MAX_AGE,
  PD_SIDEBAR_GEOMETRY,
  type PdSidebarGeometry,
  type PdSidebarMode,
} from "./pd-sidebar-mode";

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// CPR-PD-001 — THE PRACTICE PRODUCT DIRECTOR SIDEBAR (and the shell it needs to reflow into).
//
// ⚠ A SECOND COMPONENT, NOT A BRANCH INSIDE WorkspaceSidebar. PD-001 s7: "if a user has multiple product
// entitlements, product switching occurs through the HQ/product context architecture rather than by
// mixing unrelated product sidebars". Competen HQ governs four product lines; this governs one. Growing
// one component until it serves both is precisely how that rule gets broken, and pd-nav.ts says the same
// thing about the two TABLES for the same reason.
//
// ⚠ IT OWNS <main> TOO, AND THAT IS NOT SCOPE CREEP. s4's last two rows are about the CONTENT: "main
// content expands when the sidebar collapses; no blank reserved gutter" and "content must not jump
// vertically". The rail's width and the content's left margin are one number in two places, and the only
// way they cannot disagree is for one component to hold it. So the shell takes the header and the page as
// slots (children/props rendered on the SERVER and passed through -- see the Next.js composition rules)
// and applies both halves of the geometry itself.
//
// ⚠ IT DELIBERATELY DOES NOT CARRY data-sidebar. That attribute opts an aside into the estate-wide
// collapse mechanism in globals.css, which is driven by <html class="sb-collapsed"> from localStorage and
// re-applied by a pre-paint script in the root layout. A Product Director who had collapsed some OTHER
// workspace's sidebar would arrive here with this one already collapsed and no cookie saying so -- two
// sources of truth for one width. This sidebar's width comes from its cookie and from nothing else.
//
// ⚠ AND IT DOES NOT USE NavLink / NavGroup, WHICH WAS THE FIRST PLAN. Both are reused everywhere and both
// break a requirement here:
//   • NavLink's accessible name comes from its visible label. In a rail that label is display:none, and
//     display:none text is excluded from the accessible name computation -- so every icon would announce
//     as an empty link. s4 is explicit that "tooltips are not a substitute for aria-labels", so the name
//     is carried by aria-label on the anchor here and cannot depend on what CSS is drawing.
//   • NavGroup is a <details> accordion whose rail behaviour (hide the summary, force the items visible)
//     is a globals.css rule scoped to aside[data-sidebar] -- which this aside is not, deliberately, per
//     the paragraph above. A collapsed group would hide four destinations in the rail.
// What IS reused is the part that could silently drift: parentHrefs and pathMatches from lib/nav/active,
// the same two functions scripts/sidebar-active-harness.ts holds the HQ sidebar to.
// ════════════════════════════════════════════════════════════════════════════════════════════════════

/** s6: "the sidebar header must identify the product context as Competen Practice and the role context
 *  as Product Director Workspace." Two lines, both required, neither inferred. */
const PRODUCT_LABEL = "Competen Practice";
const ROLE_LABEL = "Product Director Workspace";

// The desktop threshold. Matches `lg:` in pd-sidebar-mode.ts; see the ladder note there for why lg.
const DESKTOP_QUERY = "(min-width: 1024px)";

function subscribeDesktop(cb: () => void) {
  const mq = window.matchMedia(DESKTOP_QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

type TipHandler = (label: string, el: HTMLElement | null) => void;

export default function ProductDirectorSidebar({
  initialMode,
  profileName,
  positionNames,
  workspaces,
  capabilities,
  isOwner,
  header,
  children,
}: {
  /** Resolved from the cookie by the LAYOUT, so the first paint is already the right width. */
  initialMode: PdSidebarMode;
  profileName: string | null;
  /** The live HQ appointments this person holds, for the s6 identity line. */
  positionNames: string[];
  /** Server-resolved switch destinations. Visibility grants nothing; see PdContextSwitcher. */
  workspaces: WorkspaceLink[];
  /**
   * What this viewer actually holds, resolved server-side (CPR-PD-001 s7: "sidebar visibility is
   * capability/entitlement driven; do not hard-code access from job title alone").
   *
   * ⚠ HIDING IS COURTESY, NOT SECURITY. s7 again: "a hidden navigation item does not constitute
   * authorization." Every destination re-authorises on arrival through its own requireHqCapability, so
   * this list only decides what is worth OFFERING. If it were ever the only check, typing the URL would
   * defeat it -- which is exactly the failure the 85 per-page guards exist to prevent.
   *
   * ⚠ AN OWNER HOLDS NO HQ CAPABILITIES BY CONSTRUCTION -- resolveHqPositions short-circuits before
   * reading any HQ table -- so an empty list from an owner means "everything", not "nothing". Inferring
   * ownership from an empty list is how every owner gets a blank sidebar; the HQ sidebar's own filter
   * carries this warning for the same reason.
   */
  capabilities: string[];
  isOwner: boolean;
  /** The PUI-002 global header, rendered on the server and passed through as a slot. */
  header: React.ReactNode;
  children: React.ReactNode;
}) {
  const pathname = usePathname() ?? "";
  const [mode, setMode] = useState<PdSidebarMode>(initialMode);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [tip, setTip] = useState<{ label: string; top: number } | null>(null);

  // ⚠ THE SERVER SNAPSHOT IS `true`, AND IT ONLY EVER DECIDES WORDS. Width and label visibility are pure
  // CSS (see PD_SIDEBAR_GEOMETRY), so nothing moves when this settles after hydration. It is read for two
  // things that genuinely need to know the answer in JavaScript: which way the toggle should go from
  // `auto`, and whether the rail flyout is worth rendering. The useSyncExternalStore/server-snapshot shape
  // is SidebarToggle's, so there is no hydration mismatch to suppress.
  const desktop = useSyncExternalStore(
    subscribeDesktop,
    () => window.matchMedia(DESKTOP_QUERY).matches,
    () => true,
  );

  /**
   * s7's capability-driven visibility. An owner sees the table unchanged, for the reason in the prop's
   * own comment: their capability list is empty BY CONSTRUCTION, so filtering against it would blank
   * the sidebar for exactly the people who may see everything.
   *
   * ⚠ A GROUP WITH NOTHING LEFT IN IT DISAPPEARS ENTIRELY. An empty CONTROL heading over blank space
   * tells a viewer there is something there they cannot have, which is both useless and a small
   * disclosure -- s7 rules that out for object names and the same argument covers a section heading.
   */
  const visibleNav = useMemo(() => {
    if (isOwner) return PD_NAV;
    const held = new Set(capabilities);
    return PD_NAV
      .map(g => ({ ...g, items: g.items.filter(i => held.has(i.capability)) }))
      .filter(g => g.items.length > 0);
  }, [isOwner, capabilities]);

  const geometry = PD_SIDEBAR_GEOMETRY[mode];
  /** Is the desktop sidebar presenting as an icon rail right now? */
  const rail = mode === "collapsed" || (mode === "auto" && !desktop);

  // s4: "persistent collapse/expand control at the top of the sidebar. ONE CLICK ONLY."
  const toggle = useCallback(() => {
    const next: PdSidebarMode = rail ? "expanded" : "collapsed";
    setMode(next);
    setTip(null);
    // The write half of the persistence. The read half is in the layout, before the first byte.
    try {
      document.cookie =
        `${PD_SIDEBAR_COOKIE}=${next};path=/;max-age=${PD_SIDEBAR_COOKIE_MAX_AGE};samesite=lax`;
    } catch { /* a browser refusing cookies loses the preference, not the sidebar */ }
  }, [rail]);

  // ⚠ STABLE, NOT AN INLINE ARROW. useModalFocus re-runs its effect when onDismiss changes identity, and
  // its cleanup RESTORES FOCUS TO THE OPENER -- a fresh closure on every render would bounce focus out of
  // the drawer and back in on each keystroke.
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  const showTip = useCallback<TipHandler>((label, el) => {
    if (!el) return;
    const r = el.getBoundingClientRect();
    setTip({ label, top: r.top + r.height / 2 });
  }, []);
  const hideTip = useCallback(() => setTip(null), []);

  const bodyProps = {
    profileName,
    positionNames,
    workspaces,
    pathname,
    // s7: the filtered table, resolved once in the parent so the rail and the drawer cannot disagree
    // about which destinations exist for this viewer.
    nav: visibleNav,
  };

  return (
    <>
      {/* ── Small mobile: the global menu control (s5) ────────────────────────────────────────────
          HQ renders no navigation at all below md -- its aside is `hidden md:flex` and its header
          `hidden md:block` -- so there was nothing to open a drawer from and this bar is it. A BAR,
          not a rail: s5 requires that the sidebar "must not permanently consume viewport width", and
          height is the one dimension a phone can spare. */}
      <div className="sticky top-0 z-30 flex items-center gap-2 bg-[var(--pd-shell)] px-3 py-2 md:hidden">
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          aria-expanded={drawerOpen}
          aria-haspopup="dialog"
          aria-label="Open Product Director navigation"
          className="flex items-center justify-center rounded-lg px-2 py-1.5 text-lg leading-none text-[var(--pd-shell-ink)] transition-colors hover:bg-[var(--pd-shell-hover)] pointer-coarse:min-h-[var(--cp-touch)] pointer-coarse:min-w-[var(--cp-touch)] motion-reduce:transition-none"
        >
          <span aria-hidden>☰</span>
        </button>
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-[var(--pd-shell-ink)]">
          {PRODUCT_LABEL}
          <span className="ml-1.5 text-[11px] font-normal text-[var(--pd-shell-ink-dim)]">{ROLE_LABEL}</span>
        </span>
      </div>

      {/* The PUI-002 header keeps the same left margin as the content, or it would sit over the rail. */}
      <div className={`hidden transition-[margin-left] duration-200 ease-out motion-reduce:transition-none md:block ${geometry.content}`}>
        {header}
      </div>

      <aside
        data-pd-sidebar={mode}
        className={`fixed left-0 top-0 z-20 hidden h-screen flex-col bg-[var(--pd-shell)] py-4 transition-[width] duration-200 ease-out motion-reduce:transition-none md:flex ${geometry.aside}`}
      >
        <PdSidebarBody
          {...bodyProps}
          geometry={geometry}
          navId="pd-sidebar-nav"
          rail={rail}
          onTip={rail ? showTip : undefined}
          onHideTip={hideTip}
          toggle={{ kind: "collapse", rail, onToggle: toggle }}
        />
      </aside>

      {/* ── The rail's hover/focus label (s4) ──────────────────────────────────────────────────────
          Rendered ONCE, outside the scrolling nav, and positioned from the row's own rectangle. The
          reason it cannot simply be a child of the row is in pd-sidebar-mode.ts: a scroll container
          clips on both axes, so an in-row flyout is cut off at the rail's edge.

          aria-hidden, and that is the point rather than an omission -- the anchor already carries the
          full label as its accessible name. This is the VISIBLE half of s4's "hover/focus"; announcing
          it again would read every rail item twice. */}
      {tip && rail && (
        <div
          aria-hidden
          className="pointer-events-none fixed z-40 hidden -translate-y-1/2 whitespace-nowrap rounded-md bg-[var(--pd-shell-deep)] px-2.5 py-1.5 text-[12px] font-medium text-[var(--pd-shell-ink)] shadow-lg ring-1 ring-[var(--pd-shell-line)] md:block"
          style={{ top: tip.top, left: PD_RAIL_FLYOUT_LEFT }}
        >
          {tip.label}
        </div>
      )}

      {drawerOpen && (
        <PdDrawer onClose={closeDrawer}>
          <PdSidebarBody
            {...bodyProps}
            // The drawer is never a rail: it opens at full width or not at all.
            geometry={PD_SIDEBAR_GEOMETRY.expanded}
            rail={false}
            toggle={{ kind: "close", onToggle: closeDrawer }}
            // ⚠ THE DRAWER CLOSES ON THE CLICK, NOT IN AN EFFECT WATCHING THE PATHNAME. Same visible
            // behaviour, and it is the difference between handling an event and synchronising state --
            // the effect version is a cascading render React's own lint rule refuses, and it would
            // ALSO have closed the drawer via a path this component never initiated.
            onNavigate={closeDrawer}
          />
        </PdDrawer>
      )}

      <main
        id="main-content"
        className={`max-w-6xl px-4 pb-8 pt-3 transition-[margin-left] duration-200 ease-out motion-reduce:transition-none md:px-6 ${geometry.content}`}
      >
        {children}
      </main>
    </>
  );
}

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// The off-canvas drawer (s5).
// ────────────────────────────────────────────────────────────────────────────────────────────────────

function PdDrawer({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  // Focus moves IN, Tab wraps inside, Escape closes, and focus RETURNS to the opener -- s5's last
  // sentence. The shared hook exists because three drawers in this codebase promised aria-modal and kept
  // none of it; re-implementing it here would have made a fourth.
  //
  // The flag is a literal because this component only MOUNTS while the drawer is open, so unmounting is
  // what runs the hook's cleanup and hands focus back.
  useModalFocus(true, panel, onClose);

  return (
    <div className="fixed inset-0 z-50 md:hidden">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={`${PRODUCT_LABEL} — ${ROLE_LABEL} navigation`}
        className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-[var(--pd-shell)] py-4 shadow-2xl"
      >
        {children}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// The sidebar's contents, rendered identically into the desktop rail and the mobile drawer.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

type ToggleSpec =
  | { kind: "collapse"; rail: boolean; onToggle: () => void }
  | { kind: "close"; onToggle: () => void };

function PdSidebarBody({
  geometry, rail, navId, onTip, onHideTip, onNavigate, toggle,
  profileName, positionNames, workspaces, pathname, nav,
}: {
  geometry: PdSidebarGeometry;
  rail: boolean;
  navId?: string;
  onTip?: TipHandler;
  onHideTip?: () => void;
  /** Set only in the drawer: following a link there must dismiss it. */
  onNavigate?: () => void;
  toggle: ToggleSpec;
  profileName: string | null;
  positionNames: string[];
  workspaces: WorkspaceLink[];
  pathname: string;
  /** The capability-filtered nav, from the parent. See its useMemo for why an owner is exempt. */
  nav: typeof PD_NAV;
}) {
  /**
   * ⚠ DERIVED FROM THE WHOLE TABLE, PARENTS AND CHILDREN TOGETHER, AND NEVER FROM A FILTERED COPY.
   *
   * parentHrefs marks an href that is a strict prefix of another as "exact match only", which is what
   * stops Mission Control (/super-admin, a prefix of all eleven others) from being lit on every page in
   * the workspace. PD_ALL_HREFS is already the deduplicated union, so a parent whose children a viewer
   * cannot see still matches exactly -- highlighting must not change with who is looking.
   */
  const exactHrefs = useMemo(() => parentHrefs(PD_ALL_HREFS.map(href => ({ href }))), []);

  /** s8: "preserve the user's expanded/collapsed child-group state during the session where practical."
   *  Absent means "follow the section you are standing in"; an explicit toggle wins. */
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

  const identity = positionNames.length === 1
    ? positionNames[0]
    // ⚠ NOT GUESSED AT WHEN THERE ARE SEVERAL. Which appointment is "effective" is a governance-context
    // question, and resolving it here would cost two reads on every page of this workspace. The count is
    // true without pretending. WorkspaceSidebar states the same thing the same way.
    : positionNames.length > 1
      ? `${positionNames.length} HQ appointments`
      // ⚠ AND THE FALLBACK IS THE ROLE CONTEXT, NOT AN APPOINTMENT NAME. s6 asks for "the user's current
      // effective role ... rather than the generic 'HQ Appointee' label". When no position name resolves,
      // the workspace itself is still a true statement about what they are doing here; inventing
      // "Practice Product Director" would assert an appointment we did not read.
      : ROLE_LABEL;

  const isCollapse = toggle.kind === "collapse";
  const toggleLabel = toggle.kind === "close"
    ? "Close navigation"
    : toggle.rail ? "Expand sidebar" : "Collapse sidebar";

  return (
    <>
      {/* ── The toggle, at the TOP, never in a menu (s4) ────────────────────────────────────────── */}
      <div className={`flex px-2 pb-1 ${isCollapse ? geometry.toggleRow : "justify-end"}`}>
        <button
          type="button"
          onClick={toggle.onToggle}
          aria-label={toggleLabel}
          title={toggleLabel}
          aria-expanded={toggle.kind === "collapse" ? !toggle.rail : undefined}
          aria-controls={isCollapse ? navId : undefined}
          className="flex items-center justify-center rounded-md px-2 py-1 text-sm leading-none text-[var(--pd-shell-ink-dim)] transition-colors hover:bg-[var(--pd-shell-hover)] hover:text-[var(--pd-shell-ink)] pointer-coarse:min-h-[var(--cp-touch)] pointer-coarse:min-w-[var(--cp-touch)] motion-reduce:transition-none"
        >
          <span aria-hidden>{toggle.kind === "close" ? "✕" : toggle.rail ? "»" : "«"}</span>
        </button>
      </div>

      {/* ── s6: the product context AND the role context, both named ──────────────────────────────
          The brand mark survives the rail (s4); the two lines are what the rail drops. */}
      <Link
        href={PD_HOME}
        aria-label={`${PRODUCT_LABEL} — ${ROLE_LABEL}`}
        onClick={onNavigate}
        className={`mb-3 flex items-center gap-2.5 px-3 ${geometry.row}`}
      >
        <span
          aria-hidden
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-[var(--pd-shell-ink)] text-sm font-bold text-[var(--pd-shell)]"
        >
          C
        </span>
        <span aria-hidden className={`min-w-0 leading-tight ${geometry.label}`}>
          <span className="block truncate text-[13px] font-semibold text-[var(--pd-shell-ink)]">{PRODUCT_LABEL}</span>
          <span className="block truncate text-[10px] font-medium text-[var(--pd-shell-ink-dim)]">{ROLE_LABEL}</span>
        </span>
      </Link>

      {/* ── The twelve destinations, in the four frozen groups ────────────────────────────────────
          ⚠ PD_NAV IS RENDERED IN ITS OWN ORDER AND NOTHING SORTS IT. s9: "use stable item order; do not
          reorder navigation dynamically based on alerts or usage." */}
      <nav
        id={navId}
        aria-label={`${ROLE_LABEL} navigation`}
        className="flex-1 overflow-y-auto px-2"
        onScroll={onHideTip}
      >
        {nav.map(({ group, items }) => (
          <div key={group} className="mb-2">
            {/* s4: the heading may go in the rail. s4 again: "navigation grouping must remain
                semantically represented" -- so it is the <ul>'s accessible name that carries the group,
                and that name is present at every width whether or not this <p> is drawn. */}
            <p className={`px-2.5 pb-1 pt-2 text-[9px] font-bold uppercase tracking-[0.16em] text-[var(--pd-shell-ink-dim)] ${geometry.label}`}>
              {group}
            </p>
            <ul aria-label={titleCase(group)} className="flex flex-col gap-0.5">
              {items.map(item => {
                const children = item.children ?? [];
                const selfActive = pathMatches(item.href, pathname, exactHrefs.has(item.href));
                const childActive = children.some(c => pathMatches(c.href, pathname, exactHrefs.has(c.href)));
                // s4: "parent Product Operations remains active when a child route is open." In the rail
                // the parent is the ONLY row on screen, so it takes the full active treatment; expanded,
                // the child carries "page" and the parent carries "section", which is how two lit rows
                // still say exactly where you are.
                const tone: RowTone = selfActive ? "active"
                  : childActive ? (rail ? "active" : "section")
                  : "idle";
                const expanded = openGroups[item.href] ?? (selfActive || childActive);
                const panelId = `pd-children-${item.href.replace(/\W+/g, "-")}`;

                return (
                  <li key={item.href}>
                    {/* ⚠ THE DISCLOSURE IS A SIBLING OF THE LINK, NEVER A CHILD OF IT. A <button> inside
                        an <a> is invalid HTML and browsers resolve it inconsistently, so the row would
                        sometimes navigate when the intent was to expand. */}
                    <div className={`${rowClass(tone)} ${geometry.row} pr-1`}>
                      {(tone === "active" || tone === "section") && (
                        // Never colour alone (s9): the bar and the weight say it as well as the fill.
                        <span
                          aria-hidden
                          className={`absolute left-0 top-1/2 w-[3px] -translate-y-1/2 rounded-r bg-[var(--pd-shell-ink)] ${
                            tone === "active" ? "h-5" : "h-2.5 opacity-60"}`}
                        />
                      )}
                      <Link
                        href={item.href}
                        // s8: "clicking the label must still have a predictable destination" -- every
                        // parent routes to its own overview, and the disclosure is an extra, not the way in.
                        aria-current={selfActive ? "page" : undefined}
                        // The complete name, always, whatever CSS is drawing (s4).
                        aria-label={tone === "section" ? `${item.label} (current section)` : item.label}
                        title={item.label}
                        onMouseEnter={e => onTip?.(item.label, e.currentTarget)}
                        onFocus={e => onTip?.(item.label, e.currentTarget)}
                        onMouseLeave={onHideTip}
                        onBlur={onHideTip}
                        onClick={onNavigate}
                        className={`flex min-w-0 flex-1 items-center gap-2.5 ${geometry.row}`}
                      >
                        <span aria-hidden className="w-5 shrink-0 text-center text-sm leading-none">{item.icon}</span>
                        <span aria-hidden className={`min-w-0 flex-1 truncate ${geometry.label}`}>{item.label}</span>
                      </Link>
                      {children.length > 0 && (
                        <span className={geometry.label}>
                          <button
                            type="button"
                            onClick={() => setOpenGroups(s => ({ ...s, [item.href]: !expanded }))}
                            aria-expanded={expanded}
                            aria-controls={panelId}
                            // Says what is inside, not "toggle": "expand" tells a screen-reader user
                            // nothing about whether it is worth expanding.
                            aria-label={`${expanded ? "Hide" : "Show"} the ${children.length} sections filed under ${item.label}`}
                            className={`ml-1 flex shrink-0 items-center justify-center rounded p-0.5 text-[10px] leading-none text-[var(--pd-shell-ink-dim)] transition-transform hover:bg-[var(--pd-shell-hover)] pointer-coarse:min-h-[var(--cp-touch)] pointer-coarse:min-w-[var(--cp-touch)] motion-reduce:transition-none ${
                              expanded ? "rotate-90" : ""}`}
                          >
                            <span aria-hidden>▸</span>
                          </button>
                        </span>
                      )}
                    </div>

                    {expanded && children.length > 0 && (
                      <ul
                        id={panelId}
                        aria-label={`${item.label} sections`}
                        className={`mb-1.5 ml-5 border-l border-[var(--pd-shell-line)] pl-2 ${geometry.label}`}
                      >
                        {children.map(child => {
                          const active = pathMatches(child.href, pathname, exactHrefs.has(child.href));
                          return (
                            <li key={child.href}>
                              <Link
                                href={child.href}
                                aria-current={active ? "page" : undefined}
                                aria-label={child.label}
                                className={`mb-0.5 flex items-center gap-2 rounded-lg px-2 py-1.5 text-[11.5px] transition-colors pointer-coarse:min-h-[var(--cp-touch)] motion-reduce:transition-none ${
                                  active
                                    ? "bg-[var(--pd-shell-active)] font-semibold text-[var(--pd-shell-ink)]"
                                    : "text-[var(--pd-shell-ink-dim)] hover:bg-[var(--pd-shell-hover)] hover:text-[var(--pd-shell-ink)]"}`}
                              >
                                <span aria-hidden className="w-2 shrink-0 text-center text-[9px] leading-none">
                                  {active ? "●" : "·"}
                                </span>
                                <span className="min-w-0 flex-1 truncate">{child.label}</span>
                              </Link>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* ── s4's floor: context control, profile access and sign-out all survive the rail ────────── */}
      <div className="mt-auto border-t border-[var(--pd-shell-line)] px-2 pt-2">
        <PdContextSwitcher
          workspaces={workspaces}
          geometry={geometry}
          productLabel={PRODUCT_LABEL}
          roleLabel={ROLE_LABEL}
        />

        <Link
          href="/dashboard/profile"
          aria-label={`Profile — ${profileName ?? "your account"}, ${identity}`}
          title="Profile"
          className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 transition-colors hover:bg-[var(--pd-shell-hover)] pointer-coarse:min-h-[var(--cp-touch)] motion-reduce:transition-none ${geometry.row}`}
        >
          <span
            aria-hidden
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--pd-shell-active)] text-xs font-bold text-[var(--pd-shell-ink)]"
          >
            {profileName?.[0] ?? "P"}
          </span>
          <span aria-hidden className={`min-w-0 flex-1 leading-tight ${geometry.label}`}>
            <span className="block truncate text-[12px] font-medium text-[var(--pd-shell-ink)]">{profileName ?? "This account"}</span>
            <span className="block truncate text-[10px] text-[var(--pd-shell-ink-dim)]">{identity}</span>
          </span>
        </Link>

        {/* A POST, because signing out is a state change -- and the same endpoint every other shell uses.
            There is no /logout route to link to. */}
        <form action="/api/auth/logout" method="POST">
          <button
            type="submit"
            aria-label="Sign out"
            title="Sign out"
            className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[12px] text-[var(--pd-shell-ink-dim)] transition-colors hover:bg-[var(--pd-shell-hover)] hover:text-[var(--pd-shell-ink)] pointer-coarse:min-h-[var(--cp-touch)] motion-reduce:transition-none ${geometry.row}`}
          >
            <span aria-hidden className="w-5 shrink-0 text-center leading-none">↩</span>
            <span aria-hidden className={`min-w-0 flex-1 truncate text-left ${geometry.label}`}>Sign out</span>
          </button>
        </form>
      </div>
    </>
  );
}

type RowTone = "active" | "section" | "idle";

const ROW_TONE: Record<RowTone, string> = {
  active: "bg-[var(--pd-shell-active)] font-semibold text-[var(--pd-shell-ink)]",
  section: "bg-[var(--pd-shell-hover)] font-semibold text-[var(--pd-shell-ink)]",
  idle: "text-[var(--pd-shell-ink-dim)] hover:bg-[var(--pd-shell-hover)] hover:text-[var(--pd-shell-ink)]",
};

/** ⚠ pointer-coarse, NOT a width. s9 wants targets "comfortably clickable/tappable in collapsed mode";
 *  sizing that by breakpoint would grow the rows on a narrow DESKTOP window, where a mouse is pointing
 *  and 34px is deliberate, and would still miss a tablet held at 1200px+. The question is what is doing
 *  the pointing, and only (pointer: coarse) answers it. This is CPR-MOB-001's idiom, from the Practice
 *  sidebar. */
function rowClass(tone: RowTone) {
  return `group relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[12.5px] transition-colors pointer-coarse:min-h-[var(--cp-touch)] motion-reduce:transition-none ${ROW_TONE[tone]}`;
}

/** "OPERATE" is the label PD-001 s2 prescribes and it is drawn exactly that way; this is only the name
 *  handed to assistive technology, where a shouted acronym-shaped word reads badly. */
function titleCase(s: string) {
  return s.charAt(0) + s.slice(1).toLowerCase();
}
