import Link from "next/link";
import type { ReactNode } from "react";
import { experienceHref } from "@/lib/individual/experiences";
import { LearningIcon } from "@/components/ui/scholar-learning";
import type { SessionHit } from "@/lib/individual/scholar/learn-search";
import { Unreadable, focusRing } from "../../../../../_components/chrome";
import { HistoryNotice } from "../../../../../_components/SearchHistoryChoice";
import { LEARN, learnHref } from "./learn-landing";
import { toneAction } from "./progress-parts";
import { HistoryKeyInput } from "./search-history-client";
import { STEP_MARKS_MAX, lastActive, stepOf } from "./study-home-model";

// SCH-HFE-01: the Study Home's three sections. What they say is decided by the page and study-home-model.ts.

const box = "rounded-2xl bg-[var(--cmp-app-surface)] ring-1 ring-[var(--cmp-app-border)]";
export const textLink = `inline-flex min-h-[40px] items-center gap-1 rounded text-[13.5px] font-semibold text-[var(--learn-ink)] underline-offset-2 hover:underline pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`;

function StepMarks({ step, of }: { step: number; of: number }) {
  if (of > STEP_MARKS_MAX) return null;
  return (
    <span aria-hidden className="flex max-w-[360px] gap-1">
      {Array.from({ length: of }, (_, i) => <span key={i} className={`h-1.5 flex-1 rounded-full ${i < step ? "bg-[var(--learn-ink)]" : "bg-[var(--learn-border)]"}`} />)}
    </span>
  );
}

export function ContinueCard({ s, href, more }: { s: SessionHit; href: string; more: boolean }) {
  const at = stepOf(s);
  const when = lastActive(s.lastActiveAt);
  const heading = s.topic ?? s.title;
  // The source only where it adds something: a session is often named after its one document.
  const sources = s.sources.filter(t => t.trim().toLowerCase() !== heading.trim().toLowerCase());
  return (
    <section aria-labelledby="home-continue-h" className="cmp-learn-next" data-study-continue={s.id}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-x-3">
        <h2 id="home-continue-h" className="text-[17px] font-bold text-gray-900">Continue learning</h2>
        {more && <Link href={learnHref({ tab: "sessions" })} className={textLink}>View all sessions<span aria-hidden>→</span></Link>}
      </div>
      <div className="cmp-learn-box flex flex-col gap-4 p-4 sm:p-5 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0 flex-1">
          <h3 className="break-words text-[20px] font-bold leading-snug tracking-tight text-gray-900">{heading}</h3>
          {sources.length > 0 && <p className="mt-0.5 break-words text-[14px] text-gray-700">{sources.slice(0, 2).join(", ")}{sources.length > 2 ? ` and ${sources.length - 2} more` : ""}</p>}
          {at && <div className="mt-3"><StepMarks step={at.step} of={at.of} /></div>}
          <p className="mt-1.5 text-[13px] font-medium text-gray-700">{[at?.label, when].filter(Boolean).join(" · ")}</p>
        </div>
        <Link href={href} className={`${toneAction.primary} w-full shrink-0 justify-center md:w-auto`}>Continue learning<span className="sr-only">: {heading}</span><span aria-hidden className="ml-1.5">→</span></Link>
      </div>
    </section>
  );
}

export function StartLearning({ hasMaterials, historyOn, sessionsLink, libraryHref }: { hasMaterials: boolean; historyOn: boolean; sessionsLink: boolean; libraryHref: string }) {
  return (
    <section aria-labelledby="home-start-h" className={`cmp-learn-key ${box} p-4 sm:p-5`}>
      <h2 id="home-start-h" className="text-[17px] font-bold text-gray-900">What would you like to learn?</h2>
      <p className="mt-0.5 text-[13.5px] text-gray-700">Enter a topic or question. We&rsquo;ll help you choose the next step.</p>
      <form action={LEARN} method="get" role="search" className="mt-3 flex flex-col gap-2.5 md:flex-row" data-study-start>
        <label htmlFor="home-q" className="sr-only">A topic, clinical concept, question or area of study</label>
        <input id="home-q" name="q" type="search" required maxLength={200} autoComplete="off" placeholder="For example: recognising patient deterioration"
          className={`block min-h-[48px] w-full min-w-0 flex-1 rounded-xl border border-gray-300 bg-white px-3.5 py-2.5 text-[15px] text-gray-900 ${focusRing}`} />
        {historyOn && <HistoryKeyInput />}
        <button type="submit" className={`${toneAction.primary} min-h-[48px] w-full shrink-0 justify-center md:w-auto`}>Start learning<span aria-hidden className="ml-1.5">→</span></button>
      </form>
      <p className="mt-2 text-[12.5px] text-gray-600">No AI is used until you choose an AI learning action in Learn.</p>
      <HistoryNotice className="mt-1" />
      <p className="mt-1 flex flex-wrap gap-x-4">
        {hasMaterials && <Link href={libraryHref} className={textLink}>Or choose from your materials</Link>}
        {sessionsLink && <Link href={learnHref({ tab: "sessions" })} className={textLink}>View all study sessions</Link>}
      </p>
    </section>
  );
}

export type MaterialView = { id: string; title: string; type: string; state: { label: string; ready: boolean } };

export function RecentMaterials({ rows, unreadable, upload, libraryHref }: { rows: MaterialView[]; unreadable: boolean; upload: ReactNode; libraryHref: string }) {
  return (
    <section aria-labelledby="home-recent-h" className="cmp-learn-key">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-x-3">
        <h2 id="home-recent-h" className="text-[17px] font-bold text-gray-900">Recent materials</h2>
        <div className="flex flex-wrap items-center gap-x-3">
          {rows.length > 0 && upload}
          <Link href={libraryHref} className={textLink} data-open-library>Open my library<span aria-hidden>→</span></Link>
        </div>
      </div>
      {unreadable ? <Unreadable what="study materials" /> : rows.length === 0 ? (
        <div className={`${box} p-5 text-center`}>
          <p className="text-[15px] font-bold text-gray-900">Your library is ready for your first upload</p>
          <p className="mx-auto mt-1 max-w-md text-[13.5px] text-gray-700">Add your notes, slides or a paper, then choose how you want to study. No programme or competency is needed first.</p>
          <div className="mt-3 flex justify-center">{upload}</div>
        </div>
      ) : (
        <ul className={`${box} divide-y divide-gray-100 overflow-hidden`}>
          {rows.map((m, i) => (
            // Three on a phone, up to five on a wider screen.
            <li key={m.id} className={i >= 3 ? "hidden md:block" : undefined}>
              <Link href={experienceHref("scholar", `study/${m.id}`)} data-study-material={m.id}
                className={`flex min-h-[56px] items-center gap-3 px-3.5 py-2.5 hover:bg-[var(--learn-surface)] ${focusRing} focus-visible:-outline-offset-2`}>
                <span aria-hidden className="cmp-learn-accent grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[var(--learn-surface)]"><LearningIcon name="notes" className="h-5 w-5" /></span>
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2 break-words text-[14.5px] font-semibold leading-snug text-gray-900">{m.title}</span>
                  <span className="mt-0.5 block text-[12.5px] text-gray-700">{m.type} · <span className={m.state.ready ? undefined : "font-semibold text-[var(--cmp-role-revision-strong)]"}>{m.state.label}</span></span>
                </span>
                <span className="sr-only">{m.state.ready ? "Open" : "See what happened to"}</span>
                <span aria-hidden className="cmp-learn-ink shrink-0 text-[18px] font-bold">›</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

