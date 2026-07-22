"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

// Collapsible sidebar section (accordion). Wraps a nav group's header + items in
// a native <details> so clicking the header expands/collapses the section — no
// heavy client state, keyboard-accessible for free. The section holding the
// current page opens by default; a manual toggle is remembered per section in
// localStorage and wins over the auto-open. In the collapsed icon-rail
// (html.sb-collapsed) the header is hidden and items are force-shown as icons
// (rules in globals.css), so the accordion never hides the rail.
//
// Uncontrolled by design: we render <details open> for a flash-free first paint
// (all sections expanded, as before) and only ever adjust `open` imperatively
// via the ref — React keeps the `open` prop at the constant `true`, so it never
// fights the user's clicks after mount.

export default function NavGroup({ title, hrefs, headerClass, badge, children }: {
  title: string;
  hrefs: string[];              // item hrefs in this group — used to auto-open the active section
  headerClass: string;         // per-workspace styling for the section label
  badge?: number;              // aggregate unread/attention count — useful when collapsed
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const active = hrefs.some(h => pathname === h || pathname.startsWith(h + "/"));
  const ref = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let saved: string | null = null;
    try { saved = localStorage.getItem("nav:" + title); } catch { /* ignore */ }
    el.open = saved === null ? active : saved === "1";
  }, [active, title]);

  return (
    <details ref={ref} data-nav-group open className="group/nav flex flex-col gap-0.5"
      onToggle={e => { try { localStorage.setItem("nav:" + title, (e.currentTarget as HTMLDetailsElement).open ? "1" : "0"); } catch { /* ignore */ } }}>
      <summary data-sb-item className="flex items-center gap-1 px-3 pt-3 pb-1 cursor-pointer select-none rounded hover:bg-white/5">
        <span className="text-[8px] leading-none text-slate-500 transition-transform duration-150 group-open/nav:rotate-90" aria-hidden>▶</span>
        <span className={headerClass} data-sb-label>{title}</span>
        {!!badge && (
          <span className="ml-auto bg-red-500 text-white text-[9px] font-bold rounded-full min-w-[16px] h-4 px-1 flex items-center justify-center group-open/nav:hidden" data-sb-label>
            {badge > 99 ? "99+" : badge}
          </span>
        )}
      </summary>
      <div className="flex flex-col gap-0.5">{children}</div>
    </details>
  );
}
