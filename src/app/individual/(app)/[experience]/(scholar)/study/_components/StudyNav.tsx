"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { SCHOLAR, experienceHref } from "@/lib/individual/experiences";
import { SCHOLAR_SPACES, spaceOfPath, type ScholarSpaceKey } from "@/lib/individual/scholar/spaces";
import { STUDY_SPACES } from "@/lib/individual/scholar/study-session";
import type { StudyBarView } from "@/lib/individual/scholar/study-carry";
import { StudySessionBar } from "./study-session-bar";
import { STUDY_EVENT, setActiveStudy } from "./study-active";
import { NotebookReturn } from "./notebook-return";

// The IN-WORKSPACE SWITCHER on every My Learning page (modular restructuring, 2 Nov 2026). My Plan, Library and Progress are
// reached from the sidebar and the mobile drawer (ScholarSidebar, scholar/nav.ts); this keeps only the four study stages.
// Without a study session: a slim pill row of Learn, Revise, Apply and Evaluate (spaces.ts), each a real link to a real page,
// open at any time: the stages are a guide, never a sequence. Scrolls sideways on a narrow screen.
// SCHOLAR-SESSION-AI-02 slice B: with a connected study session open (`study`, resolved by the server) the StudySessionBar
// is shown INSTEAD -- its four stage chips already carry ?study=<id> and are the stage switcher, so two rows are not stacked.
// A session started on this page by Learn arrives as a STUDY_EVENT (learn-client.tsx) and is shown the same way.

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900";

// SCHOLAR-HFE-COLOR-01/02: a small icon on a soft chip per space, a quiet wayfinding cue. Teal for core study, amber
// for revision, indigo for reasoning and evaluation, green for progress (tokens.ts activityRole). The tab text always
// names the space and the chip is aria-hidden, so the cue never carries meaning on colour alone.
const ICON: Record<ScholarSpaceKey, React.ReactNode> = {
  plan: <><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M8 3v4M16 3v4M4 10h16M8 14h3" /></>,
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

export default function StudyNav({ dueCount, study = null }: { dueCount?: number | null; study?: StudyBarView | null }) {
  const pathname = usePathname() ?? "";
  const current = spaceOfPath(pathname);
  const [started, setStarted] = useState<StudyBarView | null>(null);
  const bar = study ?? started;
  // Set while this page shows the session, cleared when it goes, so the sidebar's My Learning links (useActiveStudyId) carry it only then.
  useEffect(() => { setActiveStudy(bar?.id ?? null); return () => setActiveStudy(null); }, [bar?.id]);
  useEffect(() => {
    const on = (e: Event) => { const d = (e as CustomEvent<StudyBarView>).detail; if (d && typeof d.id === "string") setStarted(d); };
    window.addEventListener(STUDY_EVENT, on);
    return () => window.removeEventListener(STUDY_EVENT, on);
  }, []);
  if (bar) return <><NotebookReturn /><StudySessionBar bar={bar} /></>;
  return (
    <>
    <NotebookReturn />
    <nav aria-label="Learning spaces" className="mb-5 overflow-x-auto md:mt-[23px]">
      <ul className="flex min-w-max gap-2">
        {SCHOLAR_SPACES.filter(s => (STUDY_SPACES as readonly string[]).includes(s.key)).map(s => {
          const on = current === s.key;
          return (
            <li key={s.key}>
              <Link href={experienceHref("scholar", s.segment)} aria-current={on ? "page" : undefined}
                className={`inline-flex min-h-[40px] items-center gap-2 rounded-full border py-1 pl-1.5 pr-3.5 text-[14.5px] font-semibold pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing} ${on ? "bg-[var(--cmp-theme-soft)]" : "border-gray-200 bg-white text-gray-600 hover:text-gray-900"}`}
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
    </>
  );
}
