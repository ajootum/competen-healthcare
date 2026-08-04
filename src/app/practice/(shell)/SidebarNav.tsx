"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// CPR-001 v4 sidebar. A client component for ONE reason: the active item.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// THE COMP HIGHLIGHTS WHERE YOU ARE, AND THE OLD SIDEBAR DID NOT.
//
// Twenty-one links rendered identically means the only way to know which page you are on is to read the
// heading -- so every navigation is a small act of re-orientation. The highlight is the cheapest
// legibility win on the whole screen, and it needs the current path, which a server layout does not have.
//
// MATCHING IS LONGEST-PREFIX, NOT EQUALITY. /practice/privacy/security must light Security rather than
// lighting both it and Privacy, and an equality test would light neither on a detail page like
// /practice/patients/<id> -- leaving a person deep in a record with no idea which section they are in.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export type NavRenderItem = {
  href: string; label: string; icon: string; group: string;
  /** A live count, where one exists. Null renders no badge -- a zero badge is noise. */
  badge?: number | null;
};

export default function SidebarNav({ layers, items }: {
  /** CPR-SET-000 Part I: the three layers, each with the groups that sit inside it. */
  layers: { layer: string; groups: string[] }[];
  items: NavRenderItem[];
}) {
  const pathname = usePathname() ?? "";

  // The single best match, computed once: the longest href that the current path sits under.
  const activeHref = items
    .filter(i => pathname === i.href || pathname.startsWith(`${i.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href ?? null;

  return (
    <nav className="flex-1 overflow-y-auto px-3 py-3" aria-label="Practice navigation">
      {layers.map(({ layer, groups }, li) => (
        <div key={layer} className={li > 0 ? "mt-2 border-t border-white/10 pt-3" : ""}>
          {/* THE LAYER HEADING, and the group headings beneath it. A layer holding one group would
              render two near-identical labels in a row, so the group heading is suppressed there --
              "PRACTICE SETUP / Setup / Practice Setup" is three ways of saying one thing. */}
          <p className="px-2 pb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--cp-accent)]/70">
            {layer}
          </p>
          {groups.map(g => (
        <div key={g} className="mb-4">
          {groups.length > 1 && (
            <p className="px-2 pb-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-blue-200/45">{g}</p>
          )}
          {items.filter(i => i.group === g).map(i => {
            const active = i.href === activeHref;
            return (
              <Link key={i.href} href={i.href}
                aria-current={active ? "page" : undefined}
                className={`mb-0.5 flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] transition-colors ${
                  active
                    ? "bg-white/12 font-semibold text-white"
                    : "text-blue-100/75 hover:bg-white/8 hover:text-white"
                }`}>
                <span aria-hidden className={`w-4 text-center ${active ? "text-[var(--cp-accent)]" : "text-blue-200/60"}`}>
                  {i.icon}
                </span>
                <span className="min-w-0 flex-1 truncate">{i.label}</span>
                {/* A count only when there IS one. The comp badges Tasks and Messages; a badge showing
                    nought would make every quiet day look like an unread notification. */}
                {typeof i.badge === "number" && i.badge > 0 && (
                  <span className="shrink-0 rounded-full bg-[var(--cp-error)] px-1.5 py-0.5 text-[9px] font-bold leading-none text-white">
                    {i.badge > 99 ? "99+" : i.badge}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
          ))}
        </div>
      ))}
    </nav>
  );
}
