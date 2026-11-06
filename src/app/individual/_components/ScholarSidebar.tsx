"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { SCHOLAR, experienceHref } from "@/lib/individual/experiences";
import { NAV_STORAGE_KEY, SCHOLAR_NAV, activeOf, parseExpanded, visibleItems, visibleModules, type NavLeaf, type NavModuleKey } from "@/lib/individual/scholar/nav";
import type { ScholarModuleKey } from "@/lib/individual/scholar/module-access";
import { withStudy } from "@/lib/individual/scholar/study-carry";
import { useActiveStudyId } from "@/app/individual/(app)/[experience]/(scholar)/study/_components/study-active";

// SCHOLAR'S SIDEBAR -- modular restructuring, 2 Nov 2026. Home, three modules that open and close (My Learning, Courses &
// Training, My Competencies) and the shared links, all from SCHOLAR_NAV (src/lib/individual/scholar/nav.ts), so this
// tree and the mobile drawer (ScholarDrawer) are one list. SidebarNav delegates here for Scholar; Professional is unchanged.
//
// A module heading is a button that opens and closes its leaves and NEVER navigates. A leaf is a real link. The open
// state is the learner's own (localStorage, read in an effect so the server and first client render agree), and the
// module holding the current page is opened on every navigation, so the learner always sees where they are. A collapsed
// heading that holds the current page keeps the accent and says so to a screen reader (the cue is never colour alone).
// My Learning's links carry ?study=<id> while a connected study session is open, so the session survives navigation.
// CPR-MOB-001: touch-target height is gated on pointer-coarse, not on viewport width.

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900";
const SYNC_EVENT = "cmp:scholar:nav";

function save(open: readonly NavModuleKey[]) {
  try { window.localStorage.setItem(NAV_STORAGE_KEY, JSON.stringify(open)); } catch { /* storage blocked: the state lives for this visit only */ }
  window.dispatchEvent(new CustomEvent<NavModuleKey[]>(SYNC_EVENT, { detail: [...open] }));
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg aria-hidden width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
      className={`ml-auto shrink-0 transition-transform ${open ? "rotate-90" : ""}`}><path d="M9 6l6 6-6 6" /></svg>
  );
}

/** The navigation list itself (no wrapper), shared by the sidebar and the drawer. `onNavigate` lets the drawer close on a tap. */
// `modules`: the private modules this learner may see (private module development access). REQUIRED, so no caller can forget it: a module not named is not drawn.
export function ScholarNavTree({ myPlan, searchHistory = false, notebook = false, modules, onNavigate }: { myPlan: boolean; searchHistory?: boolean; notebook?: boolean; modules: readonly ScholarModuleKey[]; onNavigate?: () => void }) {
  const pathname = usePathname() ?? "";
  const studyId = useActiveStudyId();
  const base = useId();
  const active = activeOf(pathname);
  const activeModule = active?.module ?? null;
  const [open, setOpen] = useState<NavModuleKey[]>(activeModule ? [activeModule] : []);
  const openRef = useRef(open);
  useEffect(() => { openRef.current = open; });

  // The learner's own open modules, read once the page is in the browser; the current page's module stays open.
  useEffect(() => {
    let stored: NavModuleKey[] = [];
    try { stored = parseExpanded(window.localStorage.getItem(NAV_STORAGE_KEY)); } catch { /* blocked: none stored */ }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage exists only in the browser, so it is read after hydration, not in the first render
    setOpen(prev => [...new Set([...prev, ...stored])]);
    const onSync = (e: Event) => { const d = (e as CustomEvent<NavModuleKey[]>).detail; if (Array.isArray(d)) setOpen(d); };
    window.addEventListener(SYNC_EVENT, onSync);
    return () => window.removeEventListener(SYNC_EVENT, onSync);
  }, []);
  // On navigation the active module is forced open (a collapse by the learner holds until the next navigation).
  useEffect(() => {
    if (activeModule && !openRef.current.includes(activeModule)) {
      const next = [...openRef.current, activeModule];
      setOpen(next); save(next);
    }
  }, [pathname, activeModule]);

  const toggle = (k: NavModuleKey) => {
    const next = open.includes(k) ? open.filter(x => x !== k) : [...open, k];
    setOpen(next); save(next);
  };

  const linkBase = `flex items-center gap-3 rounded-[9px] px-4 py-2.5 text-[15px] pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`;
  const topLink = (leaf: NavLeaf, icon: string) => {
    const on = active?.leaf.key === leaf.key;
    return (
      <Link prefetch={false} key={leaf.key} href={experienceHref("scholar", leaf.segment)} aria-current={on ? "page" : undefined} onClick={onNavigate}
        className={`${linkBase} ${on ? "font-bold" : "font-medium text-gray-900 hover:bg-gray-50"}`}
        style={on ? { background: SCHOLAR.accentSoft, color: SCHOLAR.accent } : undefined}>
        <span aria-hidden className="w-5 text-center text-[15px]">{icon}</span>
        {leaf.label}
      </Link>
    );
  };
  const ICON: Record<string, string> = { home: "⌂", assistant: "✦", passport: "▣", profile: "◉", settings: "⚙" };

  return (
    <div className="flex flex-col gap-[7px]">
      {topLink(SCHOLAR_NAV.home, ICON.home)}
      {visibleModules(modules).map(m => {
        const isOpen = open.includes(m.key);
        const holds = activeModule === m.key;
        const listId = `${base}-${m.key}`;
        const accented = holds && !isOpen;
        return (
          <div key={m.key}>
            <button type="button" aria-expanded={isOpen} aria-controls={listId} onClick={() => toggle(m.key)}
              className={`${linkBase} w-full text-left ${accented ? "font-bold" : "font-semibold text-gray-900 hover:bg-gray-50"}`}
              style={accented ? { background: SCHOLAR.accentSoft, color: SCHOLAR.accent } : undefined}>
              <span aria-hidden className="w-5 text-center text-[15px]">{m.icon}</span>
              <span className="min-w-0 truncate whitespace-nowrap">{m.label}</span>
              {accented && <span className="sr-only"> contains current page</span>}
              <Chevron open={isOpen} />
            </button>
            <ul id={listId} hidden={!isOpen} className="mt-1 flex flex-col gap-0.5 pl-[22px]">
              {visibleItems(m, { myPlan, searchHistory, notebook }).map(leaf => {
                const on = active?.leaf.key === leaf.key;
                const href = experienceHref("scholar", leaf.segment);
                return (
                  <li key={leaf.key}>
                    <Link prefetch={false} href={leaf.carriesStudy ? withStudy(href, studyId) : href} aria-current={on ? "page" : undefined} onClick={onNavigate}
                      className={`flex items-center rounded-[9px] border-l-2 py-2 pl-3.5 pr-3 text-[14.5px] pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing} ${on ? "font-bold" : "border-transparent font-medium text-gray-700 hover:bg-gray-50"}`}
                      style={on ? { background: SCHOLAR.accentSoft, color: SCHOLAR.accent, borderColor: SCHOLAR.accent } : undefined}>
                      {leaf.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
      <div className="mt-1 flex flex-col gap-[7px] border-t border-gray-100 pt-3">
        {SCHOLAR_NAV.shared.map(leaf => topLink(leaf, ICON[leaf.key] ?? "•"))}
      </div>
    </div>
  );
}

/** The desktop sidebar's navigation, with its own scroll area so a long open tree never pushes the footer off the screen. */
export function ScholarSidebar({ myPlan, searchHistory = false, notebook = false, modules }: { myPlan: boolean; searchHistory?: boolean; notebook?: boolean; modules: readonly ScholarModuleKey[] }) {
  return (
    <nav aria-label="Competen Scholar navigation" className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-[26px]">
      <ScholarNavTree myPlan={myPlan} searchHistory={searchHistory} notebook={notebook} modules={modules} />
    </nav>
  );
}
