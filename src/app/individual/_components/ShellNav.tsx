"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { EXPERIENCES, experienceHref, navFor, bottomNavFor, overflowNavFor, type ExperienceKey, type ShellNavItem } from "@/lib/individual/experiences";
import { createClient } from "@/lib/supabase/client";

// The Individual navigation, generated from the registry (src/lib/individual/experiences.ts) and nothing
// else: the sidebar from md up, the bottom bar below it. CPR-MOB-001's freeze applies -- ONE md edge,
// and touch-target height gated on pointer-coarse, not on viewport width.
//
// The two presentations share one list, the way the Practice shell feeds its sidebar and bottom bar from
// the same filtered set: same destinations, different medium.

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900";

function isActive(pathname: string, href: string, isHome: boolean) {
  return isHome ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * `learning`: COMPETEN-LEARNING-01 (ADR-017). Competen Learning belongs to the Individual identity, not to an
 * experience, so it is one absolute link after the registry's items -- shown only while learning_app is on -- and
 * never an experience module. The bottom bar is not touched (CPR-MOB-001, at most five tabs): on small screens the
 * shell header carries the same link.
 */
export function SidebarNav({ experience, learning = false }: { experience: ExperienceKey; learning?: boolean }) {
  const pathname = usePathname() ?? "";
  const x = EXPERIENCES[experience];
  return (
    <nav aria-label={`${x.name} navigation`} className="flex flex-col gap-[7px] px-4 pt-[26px]">
      {navFor(experience).map(item => {
        const href = experienceHref(experience, item.segment);
        const on = isActive(pathname, href, item.segment === "");
        return (
          <Link key={item.key} href={href} aria-current={on ? "page" : undefined}
            className={`flex items-center gap-3 rounded-[9px] px-4 py-2.5 text-[15px] pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing} ${on ? "font-bold" : "font-medium text-gray-900 hover:bg-gray-50"}`}
            style={on ? { background: x.accentSoft, color: x.accent } : undefined}>
            <span aria-hidden className="w-5 text-center text-[15px]">{item.icon}</span>
            {item.label}
          </Link>
        );
      })}
      {learning && (
        <Link href="/individual/learning" className={`mt-2 flex items-center gap-3 rounded-[9px] border-t border-gray-100 px-4 py-2.5 pt-3 text-[15px] font-medium text-gray-900 hover:bg-gray-50 pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`}>
          <span aria-hidden className="w-5 text-center text-[15px]">◫</span>
          Competen Learning
        </Link>
      )}
    </nav>
  );
}

export function BottomNav({ experience }: { experience: ExperienceKey }) {
  const pathname = usePathname() ?? "";
  const x = EXPERIENCES[experience];
  // Composed by the registry (bottomNavFor): at most five tabs, Settings never on the bar.
  const items = bottomNavFor(experience);
  return (
    <nav aria-label={`${x.name} navigation`}
      className="md:hidden fixed inset-x-0 bottom-0 z-30 border-t border-gray-200 bg-white pb-[env(safe-area-inset-bottom)]">
      <ul className="grid" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
        {items.map(item => {
          const href = experienceHref(experience, item.segment);
          const on = isActive(pathname, href, item.segment === "");
          return (
            <li key={item.key}>
              <Link href={href} aria-current={on ? "page" : undefined}
                className={`flex min-h-[56px] flex-col items-center justify-center gap-0.5 text-[11px] font-semibold ${focusRing} ${on ? "" : "text-gray-500"}`}
                style={on ? { color: x.accent } : undefined}>
                <span aria-hidden className="text-[18px] leading-none">{item.icon}</span>
                {item.short}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * HFE-01 D1 (owner Option A): the account menu behind the avatar, on phone and desktop. Below md it lists every
 * destination the five-tab bottom bar cannot hold (overflowNavFor), so nothing is reachable only by deep link; from
 * md up, where the sidebar shows everything, it holds Profile & history, Settings and Sign out. The bar itself is
 * unchanged (CPR-MOB-001).
 */
export function AccountMenu({ experience, initials, name }: { experience: ExperienceKey; initials: string; name: string }) {
  const pathname = usePathname() ?? "";
  const x = EXPERIENCES[experience];
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); btn.current?.focus(); } };
    document.addEventListener("mousedown", onDown); document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);
  const desktop = navFor(experience).filter(i => i.segment === "profile" || i.segment === "settings");
  const item = (i: ShellNavItem, cls: string) => {
    const href = experienceHref(experience, i.segment);
    const on = isActive(pathname, href, i.segment === "");
    return (
      <li key={`${cls}-${i.key}`} className={cls}>
        <Link href={href} aria-current={on ? "page" : undefined} onClick={() => setOpen(false)}
          className={`flex min-h-[44px] items-center gap-3 rounded-lg px-3 text-[14.5px] ${on ? "font-bold" : "font-medium text-gray-900 hover:bg-gray-50"} ${focusRing}`}
          style={on ? { background: x.accentSoft, color: x.accent } : undefined}>
          <span aria-hidden className="w-5 text-center">{i.icon}</span>{i.label}
        </Link>
      </li>
    );
  };
  return (
    <div ref={box} className="relative shrink-0">
      <button ref={btn} type="button" aria-haspopup="true" aria-expanded={open} aria-controls={menuId} aria-label="Account and more"
        onClick={() => setOpen(o => !o)}
        className={`flex min-h-[44px] items-center gap-2.5 rounded-lg px-1 hover:bg-gray-50 ${focusRing}`}>
        <span aria-hidden className="flex h-8 w-8 md:h-9 md:w-9 items-center justify-center rounded-full text-[12px] md:text-[13px] font-bold text-white" style={{ background: x.accent }}>{initials}</span>
        <span className="hidden md:inline max-w-[12rem] truncate text-[13px] font-semibold" style={{ color: x.accent }}>{name}</span>
        <span aria-hidden className="hidden md:inline text-[11px] text-gray-500">▾</span>
      </button>
      {open && (
        <div id={menuId} className="absolute right-0 top-full z-40 mt-2 w-[min(18rem,calc(100vw-2rem))] rounded-xl border border-gray-200 bg-white p-2 shadow-lg">
          <ul className="space-y-0.5">
            {overflowNavFor(experience).map(i => item(i, "md:hidden"))}
            {desktop.map(i => item(i, "hidden md:block"))}
          </ul>
          <div className="mt-2 border-t border-gray-100 px-1 pt-2"><SignOutButton /></div>
        </div>
      )}
    </div>
  );
}

export function SignOutButton() {
  return (
    <button type="button"
      onClick={async () => { await createClient().auth.signOut(); window.location.assign("/individual"); }}
      className={`rounded-lg border border-gray-200 px-3 py-1.5 text-[12.5px] font-medium text-gray-600 hover:bg-gray-50 pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`}>
      Sign out
    </button>
  );
}
