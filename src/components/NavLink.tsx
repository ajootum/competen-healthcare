"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Sidebar link with active-page highlighting (review item: "you can't tell
// where you are"). Active when the path matches exactly, or is a sub-path
// for non-root hrefs.

export default function NavLink({ href, icon, label, className, activeClassName, exact }: {
  href: string;
  icon: string;
  label: string;
  className: string;        // idle styles
  activeClassName: string;  // styles when this is the current page
  exact?: boolean;          // match only the exact path (for portal roots)
}) {
  const pathname = usePathname();
  const active = exact
    ? pathname === href
    : pathname === href || pathname.startsWith(href + "/");

  return (
    <Link href={href} className={active ? activeClassName : className} aria-current={active ? "page" : undefined}>
      <span className="w-5 text-center text-sm leading-none">{icon}</span>
      <span>{label}</span>
    </Link>
  );
}
