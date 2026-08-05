"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// CPR-V5-002 SIDEBAR -- DESIGN FREEZE.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// NINE WORKSPACES IN TWO SECTIONS: NAVIGATION over the eight operational ones, ADMINISTRATION over
// Practice Setup. "The sidebar represents primary workspaces only; supporting information should not
// become top-level navigation."
//
// ⚠ THE SIXTEEN OTHER MODULES ARE NOT DELETED AND NOT HIDDEN. V5-002 removes Tasks, Analytics and
// Patient Insights from PRIMARY and says in the same breath that they "remain available contextually".
// Each declares the section that owns it and appears indented beneath it WHEN THAT SECTION IS THE ONE
// YOU ARE IN -- so the resting state is the comp's nine, and nothing costs more than two clicks. The
// alternative, rendering only the nine, would leave every one of them working and unreachable: the
// defect that made /practice/setup and the settings cards dead ends earlier in this build.
//
// MATCHING IS LONGEST-PREFIX, NOT EQUALITY. /practice/privacy/security must light Security rather than
// lighting both it and Activity Log, and an equality test would light neither on a detail page like
// /practice/patients/<id> -- leaving a person deep in a record with no idea which section they are in.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export type NavRenderItem = {
  href: string; label: string; icon: string;
  /** A live count, where one exists. Null renders no badge -- a zero badge is noise. */
  badge?: number | null;
  /** A static marker the comp draws, e.g. "AI" beside Practice Assistant. Never a count. */
  tag?: string | null;
  /** The modules filed under this section, already capability-filtered by the server. */
  children?: NavRenderItem[];
};

export type NavRenderSection = { label: string; items: NavRenderItem[] };

export default function SidebarNav({ sections }: { sections: NavRenderSection[] }) {
  const pathname = usePathname() ?? "";

  // The single best match across sections AND their modules, computed once over the flattened list: the
  // longest href the current path sits under. Computed across both, or /practice/calendar would light
  // its parent section instead of Calendar.
  const flat = sections.flatMap(s => s.items).flatMap(i => [i, ...(i.children ?? [])]);
  const activeHref = flat
    .filter(i => pathname === i.href || pathname.startsWith(`${i.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href ?? null;

  const rowClass = (active: boolean) =>
    `mb-0.5 flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] transition-colors ${
      active ? "bg-[var(--cp-primary)] font-semibold text-white" : "text-blue-100/75 hover:bg-white/8 hover:text-white"}`;

  const badge = (n?: number | null) =>
    // A count only when there IS one. The comp badges Tasks and Messages; a badge showing nought would
    // make every quiet day look like an unread notification.
    typeof n === "number" && n > 0 ? (
      <span className="shrink-0 rounded-full bg-[var(--cp-error)] px-1.5 py-0.5 text-[9px] font-bold leading-none text-white">
        {n > 99 ? "99+" : n}
      </span>
    ) : null;

  return (
    <nav className="flex-1 overflow-y-auto px-3 py-3" aria-label="Practice navigation">
      {sections.map(section => (
        <div key={section.label} className="mb-3">
          <p className="px-2.5 pb-1.5 text-[9.5px] font-bold uppercase tracking-[0.14em] text-blue-200/40">
            {section.label}
          </p>
          {section.items.map(item => {
            const active = item.href === activeHref;
            // A section opens when you are in it OR in anything filed under it -- so arriving at
            // /practice/tasks from a link elsewhere still shows which section you are standing in.
            const children = item.children ?? [];
            const inSection = active || children.some(c => c.href === activeHref);

            return (
              <div key={item.href}>
                <Link href={item.href} aria-current={active ? "page" : undefined} className={rowClass(active)}>
                  <span aria-hidden className={`w-4 text-center ${active ? "text-white" : "text-blue-200/60"}`}>
                    {item.icon}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {/* The comp's "AI" chip. A LABEL, never a count -- it says what the workspace is, so it
                      renders whether or not anything is waiting, and it must not be mistaken for one. */}
                  {item.tag && (
                    <span className="shrink-0 rounded bg-white/15 px-1.5 py-0.5 text-[9px] font-bold leading-none text-blue-100">
                      {item.tag}
                    </span>
                  )}
                  {badge(item.badge)}
                </Link>

                {inSection && children.length > 0 && (
                  <div className="mb-1.5 ml-4 border-l border-white/10 pl-2.5">
                    {children.map(c => {
                      const cActive = c.href === activeHref;
                      return (
                        <Link key={c.href} href={c.href} aria-current={cActive ? "page" : undefined}
                          className={`mb-0.5 flex items-center gap-2 rounded-lg px-2 py-1.5 text-[12px] transition-colors ${
                            cActive ? "bg-white/12 font-semibold text-white" : "text-blue-100/60 hover:bg-white/8 hover:text-white"}`}>
                          <span aria-hidden className={`w-3.5 text-center text-[11px] ${cActive ? "text-[var(--cp-accent)]" : "text-blue-200/45"}`}>
                            {c.icon}
                          </span>
                          <span className="min-w-0 flex-1 truncate">{c.label}</span>
                          {badge(c.badge)}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
