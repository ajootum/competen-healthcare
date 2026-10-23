"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SCHOLAR, experienceHref } from "@/lib/individual/experiences";

// My Learning's own sub-navigation. Upload, Understand and Assess happen on a material, so "Materials"
// is where they start; Revise, Apply and Progress each have a page. Scrolls sideways on a narrow screen
// rather than wrapping, and every tab is a real link to a real page.

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900";

const TABS = [
  { segment: "study", label: "Materials", exact: false, excludes: ["study/revise", "study/apply", "study/progress"] },
  { segment: "study/revise", label: "Revise", exact: false, excludes: [] },
  { segment: "study/apply", label: "Apply", exact: false, excludes: [] },
  { segment: "study/progress", label: "Progress", exact: false, excludes: [] },
];

export default function StudyNav({ dueCount }: { dueCount?: number | null }) {
  const pathname = usePathname() ?? "";
  return (
    <nav aria-label="My Learning" className="sticky top-14 z-20 -mx-4 mb-6 overflow-x-auto bg-gray-50/95 px-4 backdrop-blur md:static md:mx-0 md:bg-transparent md:px-0 md:backdrop-blur-none">
      <ul className="flex min-w-max gap-1 border-b border-gray-200">
        {TABS.map(t => {
          const href = experienceHref("scholar", t.segment);
          const on = (pathname === href || pathname.startsWith(`${href}/`))
            && !t.excludes.some(e => pathname.startsWith(experienceHref("scholar", e)));
          return (
            <li key={t.segment}>
              <Link href={href} aria-current={on ? "page" : undefined}
                className={`-mb-px inline-flex min-h-[44px] items-center gap-2 border-b-2 px-3 text-[14px] font-semibold ${focusRing} ${on ? "" : "border-transparent text-gray-600 hover:text-gray-900"}`}
                style={on ? { borderColor: SCHOLAR.accent, color: SCHOLAR.accent } : undefined}>
                {t.label}
                {t.segment === "study/revise" && dueCount ? (
                  <span className="rounded-full px-2 py-0.5 text-[11.5px] font-bold text-white tabular-nums" style={{ background: SCHOLAR.accent }}>
                    {dueCount}<span className="sr-only"> cards due</span>
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
