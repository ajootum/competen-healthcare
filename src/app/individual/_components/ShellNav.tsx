"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { EXPERIENCES, experienceHref, navFor, bottomNavFor, type ExperienceKey } from "@/lib/individual/experiences";
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

export function SignOutButton() {
  return (
    <button type="button"
      onClick={async () => { await createClient().auth.signOut(); window.location.assign("/individual"); }}
      className={`rounded-lg border border-gray-200 px-3 py-1.5 text-[12.5px] font-medium text-gray-600 hover:bg-gray-50 pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`}>
      Sign out
    </button>
  );
}
