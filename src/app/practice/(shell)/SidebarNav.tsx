"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// CPR-V3-002 sidebar. A client component for ONE reason: knowing where you are.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// NINE SECTIONS, FLAT, AS ALL SIX COMPS DRAW THEM -- replacing three layers, six group headings and
// twenty-three links. The old sidebar was arranged the way the codebase is; this one is arranged the way
// a clinic morning is, which is what V3-002 means by "navigation follows the practitioner's natural
// workflow".
//
// ⚠ THE SIXTEEN OTHER MODULES ARE NOT DELETED AND NOT HIDDEN. Rendering only the nine would leave every
// one of them working and unreachable -- the same defect that made /practice/setup and the settings
// cards dead ends. Each declares a parent section and appears indented beneath it WHEN THAT SECTION IS
// THE ONE YOU ARE IN. So the resting state is the comp's nine, and nothing costs more than two clicks:
// one to the section, one to the module.
//
// MATCHING IS LONGEST-PREFIX, NOT EQUALITY. /practice/privacy/security must light Security rather than
// lighting both it and Activity Log, and an equality test would light neither on a detail page like
// /practice/patients/<id> -- leaving a person deep in a record with no idea which section they are in.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export type NavRenderItem = {
  href: string; label: string; icon: string;
  /** A live count, where one exists. Null renders no badge -- a zero badge is noise. */
  badge?: number | null;
  /** The modules filed under this section, already capability-filtered by the server. */
  children?: NavRenderItem[];
};

export default function SidebarNav({ items }: { items: NavRenderItem[] }) {
  const pathname = usePathname() ?? "";

  // The single best match across sections AND their modules, computed once over the flattened list: the
  // longest href the current path sits under. Computed across both, or /practice/calendar would light
  // Today's Work (its parent) instead of Calendar.
  const flat = items.flatMap(i => [i, ...(i.children ?? [])]);
  const activeHref = flat
    .filter(i => pathname === i.href || pathname.startsWith(`${i.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href ?? null;

  const rowClass = (active: boolean) =>
    `mb-0.5 flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] transition-colors ${
      active ? "bg-white/12 font-semibold text-white" : "text-blue-100/75 hover:bg-white/8 hover:text-white"}`;

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
      {items.map(section => {
        const active = section.href === activeHref;
        // A section opens when you are in it OR in anything filed under it -- so arriving at
        // /practice/calendar from a link elsewhere still shows you which section you are standing in.
        const inSection = active || (section.children ?? []).some(c => c.href === activeHref);
        const children = section.children ?? [];

        return (
          <div key={section.href}>
            <Link href={section.href} aria-current={active ? "page" : undefined} className={rowClass(active)}>
              <span aria-hidden className={`w-4 text-center ${active ? "text-[var(--cp-accent)]" : "text-blue-200/60"}`}>
                {section.icon}
              </span>
              <span className="min-w-0 flex-1 truncate">{section.label}</span>
              {badge(section.badge)}
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
    </nav>
  );
}
