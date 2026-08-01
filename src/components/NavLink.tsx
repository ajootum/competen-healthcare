"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

// Sidebar link with active-page highlighting (review item: "you can't tell
// where you are"). Active when the path matches exactly, or is a sub-path
// for non-root hrefs.
//
// QUERY-AWARE, because sibling entries can share a path and differ only by filter: HWW-UI-005 puts Vitals,
// Pain, Neurological and Fluid Balance on /healthcare-worker/observations with different ?type= values.
// Comparing pathname alone would highlight ALL of them at once and never highlight the filtered one, since
// pathname never contains the query. Matching is union-of-keys equality: every param either side pins must
// agree, so the unfiltered entry is active only when no filter is applied.

// Badge severity -> colour (HWW-UI-005 s14). Default stays critical: a count with no declared severity is
// more likely to be something needing action than something merely new, and over-warning is the safer
// error in a clinical sidebar.
const BADGE_TONE: Record<string, string> = {
  critical: "bg-[var(--cmp-color-critical)] text-white",
  warning: "bg-[var(--cmp-color-warning)] text-black",
  info: "bg-[var(--cmp-color-success)] text-white",
};
const BADGE_MEANING: Record<string, string> = {
  critical: "requiring immediate action",
  warning: "needing attention",
  info: "new",
};

export default function NavLink({ href, icon, label, className, activeClassName, exact, badge, severity }: {
  href: string;
  icon: string;
  label: string;
  className: string;        // idle styles
  activeClassName: string;  // styles when this is the current page
  exact?: boolean;          // match only the exact path (for portal roots)
  badge?: number;           // unread-count chip (hidden when 0/undefined)
  severity?: "critical" | "warning" | "info";
}) {
  const pathname = usePathname();
  const search = useSearchParams();

  const [path, query] = href.split("?");
  const hrefParams = new URLSearchParams(query ?? "");
  const keys = new Set<string>([...hrefParams.keys(), ...Array.from(search?.keys() ?? [])]);
  const queryMatches = [...keys].every(k => (hrefParams.get(k) ?? null) === (search?.get(k) ?? null));

  const pathMatches = exact
    ? pathname === path
    : pathname === path || pathname.startsWith(path + "/");
  const active = pathMatches && queryMatches;

  const tone = severity ?? "critical";

  return (
    <Link href={href} className={active ? activeClassName : className} aria-current={active ? "page" : undefined} data-sb-item title={label}>
      <span className="w-5 text-center text-sm leading-none">{icon}</span>
      <span className="flex-1" data-sb-label>{label}</span>
      {!!badge && (
        <span
          // The number alone is not accessible: "4" tells a screen reader nothing about urgency, and the
          // colour that carries it is invisible to them.
          aria-label={`${badge} ${BADGE_MEANING[tone]}`}
          className={`ml-auto ${BADGE_TONE[tone]} text-[9px] font-bold rounded-full min-w-[16px] h-4 px-1 flex items-center justify-center`}
          data-sb-label
        >
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </Link>
  );
}
