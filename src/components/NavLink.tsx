"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Sidebar link with active-page highlighting (review item: "you can't tell
// where you are"). Active when the path matches exactly, or is a sub-path
// for non-root hrefs.

export default function NavLink({ href, icon, label, className, activeClassName, exact, badge, code }: {
  href: string;
  icon: string;
  label: string;
  className: string;        // idle styles
  activeClassName: string;  // styles when this is the current page
  exact?: boolean;          // match only the exact path (for portal roots)
  badge?: number;           // unread-count chip (hidden when 0/undefined)
  code?: string;            // optional module code shown before the label (e.g. "UMG-QS-001")
}) {
  const pathname = usePathname();
  const active = exact
    ? pathname === href
    : pathname === href || pathname.startsWith(href + "/");

  return (
    <Link href={href} className={active ? activeClassName : className} aria-current={active ? "page" : undefined} data-sb-item title={code ? `${code} · ${label}` : label}>
      <span className="w-5 text-center text-sm leading-none">{icon}</span>
      {code && <span className="text-[9px] font-semibold tracking-wide opacity-40 shrink-0" data-sb-label>{code}</span>}
      <span className={`flex-1${code ? " min-w-0 truncate" : ""}`} data-sb-label>{label}</span>
      {!!badge && (
        <span className="ml-auto bg-red-500 text-white text-[9px] font-bold rounded-full min-w-[16px] h-4 px-1 flex items-center justify-center" data-sb-label>
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </Link>
  );
}
