"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SCHOLAR, experienceHref } from "@/lib/individual/experiences";
import { SCHOLAR_SPACES, spaceOfPath, type ScholarSpaceKey } from "@/lib/individual/scholar/spaces";

// My Learning's learning spaces: Library, Learn, Revise, Apply, Evaluate and Progress (spaces.ts). Upload,
// classification and a material's own study start in the Library. Every tab is a real link to a real page,
// open at any time: the spaces are a guide, never a sequence. Scrolls sideways on a narrow screen.

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900";

// SCHOLAR-HFE-COLOR-01/02: a small icon on a soft chip per space, a quiet wayfinding cue. Teal for core study, amber
// for revision, indigo for reasoning and evaluation, green for progress (tokens.ts activityRole). The tab text always
// names the space and the chip is aria-hidden, so the cue never carries meaning on colour alone.
const ICON: Record<ScholarSpaceKey, React.ReactNode> = {
  library: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  learn: <><path d="M9 18h6M10 21h4" /><path d="M12 3a6 6 0 0 0-3.5 10.9V16h7v-2.1A6 6 0 0 0 12 3z" /></>,
  revise: <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h4" /></>,
  apply: <><path d="M6 3v6a5 5 0 0 0 10 0V3" /><path d="M11 14v2a4 4 0 0 0 8 0v-1" /><circle cx="19" cy="13" r="2" /></>,
  evaluate: <path d="M5 20V12M12 20V5M19 20v-9" />,
  progress: <><path d="M4 20h16" /><path d="M5 15l5-5 4 4 6-6" /></>,
};
function ActivityChip({ space }: { space: ScholarSpaceKey }) {
  return (
    <span aria-hidden className="inline-flex h-7 w-7 items-center justify-center rounded-lg"
      style={{ background: `var(--cmp-activity-${space}-chip)`, color: `var(--cmp-activity-${space}-icon)` }}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{ICON[space]}</svg>
    </span>
  );
}

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
                <ActivityChip space={s.key} />
                {s.tab}
                {s.key === "revise" && dueCount ? (
                  // Cards due is the suggested next step: the revision accent (its strong shade, 5.02:1 with white).
                  <span className="rounded-full bg-[var(--cmp-role-revision-strong)] px-2 py-0.5 text-[11.5px] font-bold text-white tabular-nums">
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
