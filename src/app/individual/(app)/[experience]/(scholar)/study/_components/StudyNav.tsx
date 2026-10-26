"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SCHOLAR, experienceHref } from "@/lib/individual/experiences";
import { SCHOLAR_SPACES, spaceOfPath } from "@/lib/individual/scholar/spaces";

// My Learning's learning spaces: Library, Learn, Revise, Apply, Evaluate and Progress (spaces.ts). Upload,
// classification and a material's own study start in the Library. Every tab is a real link to a real page,
// open at any time: the spaces are a guide, never a sequence. Scrolls sideways on a narrow screen.

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900";

export default function StudyNav({ dueCount }: { dueCount?: number | null }) {
  const pathname = usePathname() ?? "";
  const current = spaceOfPath(pathname);
  return (
    <nav aria-label="Learning spaces" className="sticky top-14 z-20 -mx-4 mb-6 overflow-x-auto bg-gray-50/95 px-4 backdrop-blur md:static md:mx-0 md:mt-[23px] md:bg-transparent md:px-0 md:backdrop-blur-none">
      <ul className="flex min-w-max gap-[15px] border-b border-gray-200 md:gap-5">
        {SCHOLAR_SPACES.map(s => {
          const on = current === s.key;
          return (
            <li key={s.key}>
              <Link href={experienceHref("scholar", s.segment)} aria-current={on ? "page" : undefined}
                className={`-mb-px inline-flex min-h-[48px] items-center gap-2 border-b-[3px] px-0.5 text-[15px] font-semibold ${focusRing} ${on ? "" : "border-transparent text-gray-600 hover:text-gray-900"}`}
                style={on ? { borderColor: SCHOLAR.accent, color: SCHOLAR.accent } : undefined}>
                {s.tab}
                {s.key === "revise" && dueCount ? (
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
