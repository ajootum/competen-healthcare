import Link from "next/link";
import type { ReactNode } from "react";
import { experienceHref } from "@/lib/individual/experiences";
import { LearningIcon } from "@/components/ui/scholar-learning";
import type { SessionHit } from "@/lib/individual/scholar/learn-search";
import { focusRing } from "../../../../../_components/chrome";
import { learnHref } from "./learn-landing";
import { textLink } from "./study-home";
import { lastActive, stepOf } from "./study-home-model";

// SCH-HFE-01, Learn landing: Learn's own workspace, in the Study Home's language. Study Home asks "where next?" across every space;
// this asks "what shall I learn?": go back to a lesson, take the plan's next step, reopen a lesson already studied, or open the
// library. Opening a saved lesson shows what was kept and asks for no new teaching. Reads only, no AI on this page.

const box = "rounded-2xl bg-[var(--cmp-app-surface)] ring-1 ring-[var(--cmp-app-border)]";
const rowLink = `flex min-h-[56px] items-center gap-3 px-3.5 py-2.5 hover:bg-[var(--learn-surface)] ${focusRing} focus-visible:-outline-offset-2`;
const sectionHead = "text-[17px] font-bold text-gray-900";

function Row({ href, title, detail, icon }: { href: string; title: string; detail: string | null; icon: "notes" | "book" | "target" | "library" }) {
  return (
    <Link prefetch={false} href={href} className={rowLink}>
      <span aria-hidden className="cmp-learn-accent grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[var(--learn-surface)]"><LearningIcon name={icon} className="h-5 w-5" /></span>
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 break-words text-[14.5px] font-semibold leading-snug text-gray-900">{title}</span>
        {detail && <span className="mt-0.5 block text-[12.5px] text-gray-700">{detail}</span>}
      </span>
      <span aria-hidden className="cmp-learn-ink shrink-0 text-[18px] font-bold">›</span>
    </Link>
  );
}

/** Pure: the sessions that are not the one offered for resuming, newest first. */
export function recentLessons(sessions: readonly SessionHit[], resumeId: string | null, max = 3): SessionHit[] {
  return sessions.filter(s => s.id !== resumeId).slice(0, max);
}

const lessonDetail = (s: SessionHit): string => {
  const at = stepOf(s);
  const state = s.status === "completed" ? "Completed" : at ? at.label : "In progress";
  return [state, lastActive(s.lastActiveAt)].filter(Boolean).join(" · ");
};

export function RecentLessons({ sessions, unreadable, total }: { sessions: readonly SessionHit[]; unreadable: boolean; total: number | null }) {
  if (!unreadable && sessions.length === 0) return null;
  return (
    <section aria-labelledby="learn-recent-h" className="cmp-learn-next" data-learn-recent>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-x-3">
        <h2 id="learn-recent-h" className={sectionHead}>Recent lessons</h2>
        {!unreadable && (total ?? 0) > 1 && <Link prefetch={false} href={learnHref({ tab: "sessions" })} className={textLink}>View all{total ? ` (${total})` : ""}<span aria-hidden>→</span></Link>}
      </div>
      {unreadable ? <p className={`${box} p-4 text-[13.5px] text-gray-800`}>Your lessons could not be read just now. Nothing has been lost.</p> : (
        <ul className={`${box} divide-y divide-gray-100 overflow-hidden`}>
          {sessions.map(s => (
            <li key={s.id}><Row href={learnHref({ session: s.id })} title={s.topic ?? s.title} detail={lessonDetail(s)} icon="book" /></li>
          ))}
        </ul>
      )}
    </section>
  );
}

export type StudyNextItem = { title: string; minutes: number | null; href: string | null };

/** Study next, from My Plan. The plan says why on My Plan, and this offers the one next step. */
export function StudyNext({ item, starting, unreadable }: { item: StudyNextItem | null; starting: boolean; unreadable: boolean }) {
  const plan = experienceHref("scholar", "study/plan");
  return (
    <section aria-labelledby="learn-next-h" className="cmp-learn-key" data-learn-next>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-x-3">
        <h2 id="learn-next-h" className={sectionHead}>Study next</h2>
        <Link prefetch={false} href={plan} className={textLink}>Open My Plan<span aria-hidden>→</span></Link>
      </div>
      {unreadable ? <p className={`${box} p-4 text-[13.5px] text-gray-800`}>Your next step could not be worked out just now. Your plan is unchanged.</p>
        : item?.href ? (
          <div className={box}><Row href={item.href} title={item.title} detail={[starting ? "A suggestion from your materials" : "From your plan", item.minutes ? `about ${item.minutes} min` : null].filter(Boolean).join(" · ")} icon="target" /></div>
        ) : (
          <p className={`${box} p-4 text-[13.5px] text-gray-800`}>Nothing is waiting in your plan. Search below, or choose from your library.</p>
        )}
    </section>
  );
}

export function LearningLibrary({ materials, savedOn, coursesOn, extra }: { materials: number | null; savedOn: boolean; coursesOn: boolean; extra?: ReactNode }) {
  const count = materials === null ? "Could not be counted just now" : materials === 0 ? "Nothing uploaded yet" : `${materials} ${materials === 1 ? "material" : "materials"}`;
  return (
    <section aria-labelledby="learn-library-h" className="cmp-learn-key" data-learn-library>
      <h2 id="learn-library-h" className={`${sectionHead} mb-2`}>My learning library</h2>
      <p className="mb-1 px-0.5 text-[12px] font-semibold text-gray-600">Yours</p>
      <ul className={`${box} divide-y divide-gray-100 overflow-hidden`}>
        <li><Row href={experienceHref("scholar", "study/library")} title="My Library" detail={`Your uploaded notes and slides · ${count}`} icon="library" /></li>
        {savedOn && <li><Row href={experienceHref("scholar", "study/saved")} title="Saved learning" detail="Your saved lessons, notes and cards" icon="book" /></li>}
      </ul>
      {coursesOn && (
        <>
          <p className="mb-1 mt-3 px-0.5 text-[12px] font-semibold text-gray-600">From Competen</p>
          <div className={box}><Row href={experienceHref("scholar", "courses")} title="Courses" detail="Learning provided by Competen, separate from your own notes" icon="book" /></div>
        </>
      )}
      {extra}
    </section>
  );
}

/** Tucked away, not removed: everything the old landing listed is still one tap from here. */
export function MoreToLearnFrom({ label, children }: { label: string; children: ReactNode }) {
  return (
    <details className={`${box} mt-3`}>
      <summary className={`flex min-h-[48px] cursor-pointer items-center px-3.5 text-[14px] font-semibold text-gray-900 pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`}>{label}</summary>
      <div className="border-t border-gray-100 p-3.5">{children}</div>
    </details>
  );
}

