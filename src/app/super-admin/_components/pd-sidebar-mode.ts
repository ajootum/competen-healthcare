// CPR-PD-001 s4/s5 — THE PRODUCT DIRECTOR SIDEBAR'S WIDTH, AS DATA.
//
// No "use client" and no imports, for the same reason pd-nav.ts beside it has none: this module is read
// by the LAYOUT (a server component, which resolves the stored preference before the first byte) and by
// the sidebar (a client component, which applies it). A value that both halves must agree on cannot live
// inside either one.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠ A COOKIE, NOT localStorage, AND THE REASON IS THE FIRST PAINT.
//
// The estate already has a collapse mechanism -- SidebarToggle flips <html class="sb-collapsed"> from
// localStorage, and the root layout re-applies it in a <script> before paint to hide the flash. That
// works, and it costs a synchronous blocking script plus a rule in globals.css that every workspace
// shares. PD-014 build 1 asks for something stricter: "persist sidebar state using approved preference
// mechanism WITHOUT MAKING NAVIGATION DEPENDENT ON CLIENT-ONLY STATE". A cookie is sent with the request,
// so the server renders the correct width first time; there is no wrong-width frame to hide and no
// pre-paint script to keep in sync.
//
// ⚠ NO MIGRATION, DELIBERATELY. This is a DEVICE preference, not an account one -- the same person on a
// laptop and on a tablet wants different answers, and a row in a table would give them one. PD-001 s4
// says as much: "persist the user's sidebar state ... for the same device/browser".
//
// ⚠ AND IT MUST NOT CARRY THE PD SIDEBAR'S EXISTENCE. This cookie says how WIDE the sidebar is, never
// whether the viewer may see it: that is resolved server-side from the viewer's Mission Control profile
// on every request. A cookie that decided which product's navigation renders would be a client-editable
// authorization, which is the thing PD-001 s7 rules out.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export const PD_SIDEBAR_COOKIE = "pd_sidebar";

/** A year. The preference is a habit, not a session. */
export const PD_SIDEBAR_COOKIE_MAX_AGE = 31536000;

/**
 * ⚠ THREE STATES, NOT A BOOLEAN, AND THE THIRD ONE IS THE TABLET.
 *
 * PD-001 s4 wants the desktop default EXPANDED; s5 wants the tablet default COLLAPSED. A boolean cannot
 * hold both, because the server cannot see the viewport -- so `auto` means "no stored preference yet",
 * and the two defaults are expressed in a media query instead of guessed at. The moment somebody uses
 * the toggle their choice becomes explicit and wins at every width, which is exactly what s4's "default
 * on desktop at first eligible entry UNLESS A STORED USER PREFERENCE EXISTS" asks for.
 */
export type PdSidebarMode = "auto" | "expanded" | "collapsed";

/** Anything that is not one of the two explicit choices is "no preference stored". */
export function readPdSidebarMode(raw: string | null | undefined): PdSidebarMode {
  return raw === "collapsed" || raw === "expanded" ? raw : "auto";
}

/**
 * The class strings each mode resolves to.
 *
 * ⚠ WRITTEN OUT IN FULL, NEVER COMPOSED. Tailwind scans source text: `md:w-[${w}]` produces no CSS at
 * all, and the failure looks like a sidebar with no width rather than like a build error.
 *
 * ⚠ THE BREAKPOINT LADDER, AND WHY IT IS md/lg. Below `md` the sidebar is not a rail at all -- it is the
 * off-canvas drawer (s5), so none of these apply and `main` carries no margin. `md`..`lg` is the tablet
 * band, where `auto` resolves to the rail. From `lg` up is desktop, where `auto` resolves to expanded.
 * CPR-MOB-001 measured 1024-1199 as column-identical to desktop for CONTENT, which is why the ladder
 * stops at lg rather than xl: a 1100px window is a desktop window, and rails-by-default there would
 * contradict s4's "expanded ... default on desktop".
 */
export type PdSidebarGeometry = {
  /** The fixed rail's own width, md and up. */
  aside: string;
  /** The matching left margin on the header and on <main>, so nothing reserves a blank gutter. */
  content: string;
  /** Applied to every label and section heading: present, or not. */
  label: string;
  /** The inverse of `label` -- applied to the rail-only affordances (the hover/focus flyout). */
  railOnly: string;
  /** Row alignment: an icon centres itself in a rail and sits left of its label in a full sidebar. */
  row: string;
  /** The toggle's own row: centred over a rail, right-aligned over a full sidebar. */
  toggleRow: string;
};

export const PD_SIDEBAR_GEOMETRY: Record<PdSidebarMode, PdSidebarGeometry> = {
  auto: {
    aside: "md:w-[4.75rem] lg:w-60",
    content: "md:ml-[4.75rem] lg:ml-60",
    label: "hidden lg:block",
    railOnly: "lg:hidden",
    row: "justify-center lg:justify-start",
    toggleRow: "justify-center lg:justify-end",
  },
  expanded: {
    aside: "md:w-60",
    content: "md:ml-60",
    label: "block",
    railOnly: "hidden",
    row: "justify-start",
    toggleRow: "justify-end",
  },
  collapsed: {
    aside: "md:w-[4.75rem]",
    content: "md:ml-[4.75rem]",
    label: "hidden",
    railOnly: "",
    row: "justify-center",
    toggleRow: "justify-center",
  },
};

/**
 * Where the hover/focus flyout sits: just clear of the rail's right edge.
 *
 * ⚠ IT IS FIXED-POSITIONED AND THAT IS NOT A STYLE CHOICE. The nav scrolls, and a scroll container clips
 * on BOTH axes -- `overflow-y: auto` computes `overflow-x` to `auto` too, so a label positioned at
 * `left: 100%` inside the rail is cut off at the rail's edge and the tooltip shows nothing. Taking it out
 * of the scroller is the only way it can be read.
 */
export const PD_RAIL_FLYOUT_LEFT = "5.25rem";
