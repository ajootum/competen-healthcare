"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import MoreSheet, { type MoreSection } from "./MoreSheet";

// CPR-MOB-001 s3 — the global mobile navigation: five fixed positions, below md only.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// THE FIVE ARE THE SPECIFICATION'S, NOT A RESPONSIVE SQUEEZE OF THE SIDEBAR. s3 names them by position:
// Today, Session, Patients, Follow-ups, More. Everything else the eleven-item sidebar carries reaches
// mobile through the More sheet — a full-height list, because s3 forbids "critical destinations behind
// multiple nested menus". The sidebar itself is untouched: it is hidden below md by its own class and
// this bar exists only there, so at every width exactly one global navigation is on screen.
//
// ⚠ THE TABS ARRIVE FROM THE LAYOUT ALREADY CAPABILITY-FILTERED, from the same primaryNav() call that
// builds the sidebar. This component never decides who may see Patients; it renders fewer than five
// when the caller may see fewer. A hard-coded five would offer somebody a tab whose page redirects
// them — the sidebar item that bounces, in a new position.
//
// ⚠ sessionActive IS A FACT PASSED DOWN, NOT A SECOND READ. The layout already resolves todaysPlan for
// CurrentActivityHeader; this is `plan.current !== null` from that same read, so the bar and the
// header can never disagree about whether a session is running. When the plan could not be read at
// all the layout passes false — no emphasis rather than a guessed one, for the same reason the header
// renders "Unknown" there instead of a plausible clinic.
//
// s4/s17 CONTRACT: every target is at least var(--cp-touch); labels are visible words, never
// icon-only or hover-revealed; the active tab is marked by aria-current AND weight AND an indicator
// bar, so no state rides on colour alone. The bar pads itself with the safe-area inset so the home
// indicator does not sit on top of the Follow-ups label.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export type MobileTab = { href: string; label: string; icon: string };

export default function MobileBottomNav({ tabs, moreSections, sessionActive }: {
  tabs: MobileTab[];
  moreSections: MoreSection[];
  sessionActive: boolean;
}) {
  const pathname = usePathname() ?? "";
  const [moreOpen, setMoreOpen] = useState(false);

  // Navigating closes the sheet. The links inside it also close it on click, but a navigation that
  // arrives any other way (browser back, a shortcut) must not leave a full-screen menu over a page the
  // person asked for. State adjustment during render with a prev-comparison — the React-docs pattern
  // MobileSidebar already uses, because a setState inside an effect is a cascading render the lint
  // rightly refuses.
  const [prevPath, setPrevPath] = useState(pathname);
  if (prevPath !== pathname) {
    setPrevPath(pathname);
    setMoreOpen(false);
  }

  // Longest-prefix, the same rule SidebarNav uses and for the same reason: /practice/today/complete
  // must light Session, and /practice/patients/<id> must light Patients rather than nothing. Computed
  // across the tabs AND the sheet's destinations, so standing in the Planner lights More — the honest
  // answer to "where am I" when the workspace lives behind that button.
  const all = [...tabs.map(t => t.href), ...moreSections.flatMap(s => s.items.map(i => i.href))];
  const activeHref = all
    .filter(h => pathname === h || pathname.startsWith(`${h}/`))
    .sort((a, b) => b.length - a.length)[0] ?? null;
  const moreActive = activeHref !== null && !tabs.some(t => t.href === activeHref);

  const itemClass = (active: boolean) =>
    `relative flex min-h-[var(--cp-touch)] min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-1 ${
      active ? "font-bold text-white" : "font-medium text-blue-100/60"}`;

  // The active indicator: a bar at the top edge of the tab. A SHAPE, present or absent, sitting beside
  // aria-current and the weight change — three signals, none of them a hue swap (s4: never colour alone).
  const indicator = (
    <span aria-hidden className="absolute inset-x-3 top-0 h-0.5 rounded-b bg-[var(--cp-accent)]" />
  );

  return (
    <>
      <nav
        aria-label="Practice navigation"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-[var(--cp-shell)] pb-[var(--cp-safe-bottom)] md:hidden"
      >
        <div className="flex h-[var(--cp-bottomnav-h)] items-stretch">
          {tabs.map(t => {
            const active = t.href === activeHref;
            const isSession = t.href === "/practice/today";
            return (
              <Link key={t.href} href={t.href} aria-current={active ? "page" : undefined}
                className={itemClass(active)}>
                {active && indicator}
                <span aria-hidden className="relative text-[17px] leading-none">
                  {t.icon}
                  {/* s3: "visually emphasise when a session is active" — a live dot on the Session
                      item, present at every tab state so a person mid-record can see their clinic is
                      still running. The words carrying it for a screen reader are below. */}
                  {isSession && sessionActive && (
                    <span aria-hidden className="absolute -right-1.5 -top-0.5 h-2 w-2 rounded-full bg-emerald-400 ring-2 ring-[var(--cp-shell)]" />
                  )}
                </span>
                <span className="max-w-full truncate text-[10px] leading-tight">{t.label}</span>
                {isSession && sessionActive && <span className="sr-only">— session running</span>}
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={moreOpen}
            className={itemClass(moreActive)}
          >
            {moreActive && indicator}
            <span aria-hidden className="text-[17px] leading-none">⋯</span>
            <span className="text-[10px] leading-tight">More</span>
          </button>
        </div>
      </nav>

      <MoreSheet open={moreOpen} onClose={() => setMoreOpen(false)} sections={moreSections} />
    </>
  );
}
