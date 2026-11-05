import Link from "next/link";
import { LearningIcon, learnTone, type LearningIconName } from "@/components/ui/scholar-learning";
import { CATALOGUE_STATUS_LABEL, CONSOLIDATION_LABEL, REVISE_VIEWS, REVISE_VIEW_LABEL, shortDate, type CatalogueRow, type QueueItem, type ReviseView, type StudiedMonth } from "@/lib/individual/scholar/revise-workspace";
import { sectionLead, toneAction } from "./progress-parts";
import { StartRevisionButton } from "./revision-client";
import { studyHref } from "./question-view";

// THE REVISE WORKSPACE -- SCHOLAR-REVISE-WORKSPACE-01 (owner GO, 5 Nov 2026). Server-rendered parts on the design system's tones, so
// colours stay Scholar's own. Each view is one view at a time, so nothing scrolls past something unrelated, and no list scrolls inside itself.

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900";
const card = "rounded-xl bg-[var(--cmp-app-surface)] ring-1 ring-[var(--learn-border)]";
export const reviseHref = (view: ReviseView, extra: Record<string, string | null | undefined> = {}) => {
  const params: Record<string, string | null | undefined> = { ...(view === "today" ? {} : { view }), ...extra };
  const q = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => !!e[1]));
  const s = q.toString();
  return `${studyHref("revise")}${s ? `?${s}` : ""}`;
};

/** The four views, and Insights apart as the secondary one. A row that scrolls sideways on a phone, so the action stays near the top. */
export function ReviseViewNav({ current, carry }: { current: ReviseView | null; carry?: string | null }) {
  const main = REVISE_VIEWS.filter(v => v !== "insights");
  const link = (v: ReviseView) => (
    <Link key={v} href={reviseHref(v, { study: carry })} aria-current={current === v ? "page" : undefined} prefetch={false}
      className={`inline-flex min-h-[40px] shrink-0 items-center whitespace-nowrap rounded-full border px-3.5 text-[14px] font-semibold pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing} ${current === v ? "border-[var(--learn-ink)] bg-[var(--learn-ink)] text-[var(--learn-surface)]" : "border-[var(--learn-border)] bg-[var(--cmp-app-surface)] text-gray-900 hover:bg-[var(--learn-surface)]"}`}>
      {REVISE_VIEW_LABEL[v]}
    </Link>
  );
  return (
    <nav aria-label="Revise views" className={`${learnTone("next")} -mx-4 mb-2 overflow-x-auto px-4`}>
      <div className="flex min-w-max items-center gap-1.5">
        {main.map(link)}
        <span aria-hidden className="mx-1 h-6 w-px bg-gray-300" />
        {link("insights")}
      </div>
    </nav>
  );
}

/** Direct ways in, small on purpose: they are not sections of the page. */
export function ReviseShortcuts({ items }: { items: { label: string; href: string }[] }) {
  return (
    <nav aria-label="Revise shortcuts" className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13.5px]">
      <span className="text-gray-600">Go straight to</span>
      {items.map(i => <Link key={i.label} href={i.href} prefetch={false} className={`font-semibold text-gray-900 underline underline-offset-2 hover:opacity-80 pointer-coarse:inline-flex pointer-coarse:min-h-[var(--cmp-touch-min)] pointer-coarse:items-center ${focusRing}`}>{i.label}</Link>)}
    </nav>
  );
}

const QUEUE_ICON: Record<QueueItem["kind"], LearningIconName> = { resume: "bolt", cards: "cards", retrieval: "clock", weak: "target", mistakes: "record", plan: "compass", recommended: "check" };

function ItemAction({ item, primary }: { item: QueueItem; primary: boolean }) {
  const cls = primary ? toneAction.primary : toneAction.secondary;
  return item.action.kind === "link"
    ? <Link href={item.action.href} prefetch={false} className={cls}>{item.action.label}</Link>
    : <StartRevisionButton mode={item.action.mode} label={item.action.label} className={cls} />;
}

function WhyMore({ more }: { more: readonly string[] }) {
  if (!more.length) return null;
  return (
    <details className="mt-1" suppressHydrationWarning>
      <summary className={`cursor-pointer text-[12.5px] font-semibold text-gray-700 pointer-coarse:py-3.5 ${focusRing}`}>How this is scheduled</summary>
      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[12.5px] text-gray-700">{more.map((m, n) => <li key={n}>{m}</li>)}</ul>
    </details>
  );
}

const Status = ({ text, priority }: { text: string; priority: boolean }) => (
  <span className="inline-flex flex-wrap items-center gap-1.5 text-[12px] font-semibold text-gray-800">
    <span className="rounded-full bg-[var(--learn-surface)] px-2 py-0.5 ring-1 ring-[var(--learn-border)]">{text}</span>
    {priority && <span className="rounded-full bg-[var(--cmp-app-surface)] px-2 py-0.5 ring-1 ring-gray-300">In your priorities</span>}
  </span>
);

/** What needs attention: the first thing large, with why and how to begin. The rest one compact queue, not panels. */
export function TodayQueue({ items, clear }: { items: QueueItem[]; clear: React.ReactNode }) {
  if (!items.length) return <section aria-labelledby="queue-h" className={`${learnTone("next")} cmp-learn-box p-4 sm:p-5`}><h2 id="queue-h" className="text-[17px] font-bold text-gray-900">Nothing needs attention right now</h2><div className="mt-1 text-[14px] text-gray-800">{clear}</div></section>;
  const [first, ...rest] = items;
  return (
    <div className="space-y-3" data-revise-queue>
      <section aria-labelledby="queue-h" data-revise-first={first.kind} className={`${learnTone("next")} cmp-learn-box p-4 sm:p-5`}>
        <p id="queue-h" className="cmp-learn-ink text-[12.5px] font-bold">Start here</p>
        <div className="mt-1 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0 flex-1 basis-[18rem]">
            <h2 className="break-words text-[19px] font-bold leading-snug text-gray-900">{first.title}</h2>
            <p className="mt-1 text-[14px] text-gray-800">{first.why}</p>
            <div className="mt-2"><Status text={first.status} priority={first.priority} /></div>
            <WhyMore more={first.more} />
          </div>
          <ItemAction item={first} primary />
        </div>
      </section>
      {rest.length > 0 && (
        <section aria-labelledby="queue-rest-h" className={`${learnTone("summary")}`}>
          <h2 id="queue-rest-h" className="mb-1.5 text-[14px] font-bold text-gray-900">Then</h2>
          <ul className="divide-y divide-gray-100 overflow-hidden rounded-xl bg-[var(--cmp-app-surface)] ring-1 ring-gray-200">
            {rest.map(i => (
              <li key={i.key} data-revise-item={i.kind} className="flex flex-wrap items-start gap-x-3 gap-y-2 px-3.5 py-3">
                <span aria-hidden className="mt-0.5 shrink-0 text-gray-600"><LearningIcon name={QUEUE_ICON[i.kind]} className="h-5 w-5" /></span>
                <div className="min-w-0 flex-1 basis-[14rem]">
                  <p className="break-words text-[14.5px] font-semibold text-gray-900">{i.title}</p>
                  <p className="text-[13px] text-gray-700">{i.why}</p>
                  <div className="mt-1"><Status text={i.status} priority={i.priority} /></div>
                  <WhyMore more={i.more} />
                </div>
                <ItemAction item={i} primary={false} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

const daysLine = (days: readonly string[]) => (days.length > 4 ? `${days.length} days, latest ${shortDate(days[days.length - 1])}` : days.map(shortDate).join(", "));

/** What was actually studied this month. Studied dates come from records of learning; the upload date is shown as what it is. */
export function StudiedMonthView({ v, today }: { v: StudiedMonth; today: string }) {
  const month = new Date(`${v.month}-15T12:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
  const empty = !v.groups.length && !v.unplaced.length;
  return (
    <section aria-labelledby="month-h" className={`${learnTone("record")} space-y-3`}>
      <div>
        <h2 id="month-h" className="text-[18px] font-bold text-gray-900">Studied in {month}</h2>
        <p className={sectionLead}>Days you answered questions, reviewed cards or worked through a lesson. Uploading a material does not count as studying it.</p>
      </div>
      {empty && <p className={`${card} p-4 text-[14px] text-gray-800`}>No learning is recorded yet this month. Today is {shortDate(today)}.</p>}
      {v.groups.length > 0 && (
        <ul className="space-y-2">
          {v.groups.map(g => (
            <li key={g.materialId} data-studied-material={g.materialId} className={`${card} p-3.5`}>
              <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
                <div className="min-w-0 flex-1 basis-[16rem]">
                  <p className="break-words text-[15px] font-bold text-gray-900">{g.title}</p>
                  <p className="mt-0.5 text-[13px] text-gray-800"><span className="font-semibold">Studied</span> {daysLine(g.days)} <span className="text-gray-600">· Uploaded {shortDate(g.uploadedOn)}</span></p>
                  <p className="mt-0.5 text-[13px] text-gray-700">{[g.answered ? `${g.answered} answered` : null, g.missed ? `${g.missed} missed` : null, g.reviews ? `${g.reviews} card reviews` : null, g.lessons.length ? `${g.lessons.length} ${g.lessons.length === 1 ? "lesson" : "lessons"}` : null].filter(Boolean).join(" · ")}</p>
                  <div className="mt-1.5"><Status text={g.consolidation === "due" ? `${g.dueCards} ${g.dueCards === 1 ? "card" : "cards"} due` : CONSOLIDATION_LABEL[g.consolidation]} priority={false} /></div>
                  {g.lessons.length > 0 && (
                    <details className="mt-1" suppressHydrationWarning>
                      <summary className={`cursor-pointer text-[12.5px] font-semibold text-gray-700 pointer-coarse:py-3.5 ${focusRing}`}>Lessons</summary>
                      <ul className="mt-1 space-y-0.5 text-[13px]">{g.lessons.map(l => <li key={l.id}><Link href={`${studyHref("learn")}?session=${l.id}`} prefetch={false} className={toneAction.link}>{l.title}</Link>{l.completed ? <span className="text-gray-600"> · finished</span> : null}</li>)}</ul>
                    </details>
                  )}
                </div>
                <Link href={reviseHref("today", { material: g.materialId })} prefetch={false} className={toneAction.secondary}>Revise this</Link>
              </div>
            </li>
          ))}
        </ul>
      )}
      {v.unplaced.length > 0 && (
        <div>
          <h3 className="text-[14px] font-bold text-gray-900">Other lessons</h3>
          <ul className="mt-1 space-y-1 text-[13.5px]">{v.unplaced.map(l => <li key={l.id}><Link href={`${studyHref("learn")}?session=${l.id}`} prefetch={false} className={toneAction.link}>{l.title}</Link><span className="text-gray-700"> · {shortDate(l.day)}</span></li>)}</ul>
        </div>
      )}
      {v.uploadedNotStudied.length > 0 && (
        <details className={`${card} p-3.5`} suppressHydrationWarning>
          <summary className={`cursor-pointer text-[13.5px] font-semibold text-gray-900 pointer-coarse:py-3.5 ${focusRing}`}>Uploaded this month, not studied yet ({v.uploadedNotStudied.length})</summary>
          <ul className="mt-2 space-y-1 text-[13.5px]">{v.uploadedNotStudied.map(m => <li key={m.id}><Link href={`${studyHref("learn")}?material=${m.id}`} prefetch={false} className={toneAction.link}>{m.title}</Link><span className="text-gray-700"> · uploaded {shortDate(m.uploadedOn)}</span></li>)}</ul>
        </details>
      )}
    </section>
  );
}

/** One row of the catalogue: what it is, where its revision stands, and how to begin. */
export function CatalogueRowView({ r }: { r: CatalogueRow }) {
  return (
    <li data-catalogue-material={r.materialId} className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2 px-3.5 py-3">
      <div className="min-w-0 flex-1 basis-[16rem]">
        <p className="break-words text-[14.5px] font-semibold text-gray-900">{r.title}</p>
        <p className="mt-0.5 text-[13px] text-gray-700">{r.lastStudied ? `Last studied ${shortDate(r.lastStudied)}` : "Not studied yet"} · Uploaded {shortDate(r.uploadedOn)}{r.answered ? ` · ${r.answered} answered` : ""}</p>
        <div className="mt-1"><Status text={r.status === "due" ? `${r.dueCards} ${r.dueCards === 1 ? "card" : "cards"} due` : CATALOGUE_STATUS_LABEL[r.status]} priority={false} /></div>
        {r.topics.length > 0 && (
          <ul className="mt-1.5 flex flex-wrap gap-1.5" aria-label={`Topics in ${r.title}`}>
            {r.topics.slice(0, 6).map(t => <li key={t}><Link href={reviseHref("today", { topic: t })} prefetch={false} className={`inline-flex items-center rounded-full border border-gray-300 bg-white px-2.5 py-0.5 text-[12.5px] text-gray-800 hover:bg-gray-50 pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`}>{t}</Link></li>)}
          </ul>
        )}
      </div>
      <Link href={reviseHref("today", { material: r.materialId })} prefetch={false} className={toneAction.secondary}>Revise this</Link>
    </li>
  );
}
