import Link from "next/link";
import { LearningIcon, LearningSectionHead, type LearningIconName } from "@/components/ui/scholar-learning";
import { citeChunk } from "@/lib/individual/scholar/extract";
import { getPassage, getPrivateCase, getPrivateCaseSession } from "@/lib/individual/scholar/store";
import { competencyLabels, loadLearnerCatalogue } from "@/lib/individual/scholar/competency-view";
import { PRACTICE_FORMAT_LABEL, PRACTICE_STATUS_LABEL, type PracticeRow } from "@/lib/individual/scholar/practice-library";
import { toneAction } from "./progress-parts";
import { sourceHref, studyHref } from "./question-view";
import { ReplayCase } from "./case-client";

// APPLY, CONNECTED -- SCHOLAR-APPLY-CONNECTED-01 (owner GO, 5 Nov 2026), on the owner's Apply mock-up, in Scholar's own tones. Server-rendered parts.
// Every source, date and figure comes from the learner's own records. Practice is simulation: never verified clinical competence.

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900";
export const APPLY_VIEWS = ["today", "priorities", "recent", "library"] as const;
export type ApplyView = (typeof APPLY_VIEWS)[number];
const VIEW_LABEL: Record<ApplyView, string> = { today: "Today", priorities: "My Priorities", recent: "Recent Learning", library: "All Practice & Library" };
export const parseApplyView = (v: unknown): ApplyView => ((APPLY_VIEWS as readonly unknown[]).includes(v) ? v as ApplyView : "today");
export const applyHref = (view: ApplyView, extra: Record<string, string | null | undefined> = {}) => {
  const params: Record<string, string | null | undefined> = { ...(view === "today" ? {} : { view }), ...extra };
  const q = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => !!e[1]));
  const s = q.toString();
  return `${studyHref("apply")}${s ? `?${s}` : ""}`;
};

export function ApplyViewNav({ current, study }: { current: ApplyView; study?: string | null }) {
  return (
    <nav aria-label="Apply views" className={`cmp-learn-next -mx-4 mb-4 overflow-x-auto px-4`}>
      <div className="flex min-w-max items-center gap-1.5">
        {APPLY_VIEWS.map(v => (
          <Link key={v} href={applyHref(v, { study })} prefetch={false} aria-current={current === v ? "page" : undefined}
            className={`inline-flex min-h-[40px] shrink-0 items-center whitespace-nowrap rounded-full border px-3.5 text-[14px] font-semibold pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing} ${current === v ? "border-[var(--learn-ink)] bg-[var(--learn-ink)] text-[var(--learn-surface)]" : "border-[var(--learn-border)] bg-[var(--cmp-app-surface)] text-gray-900 hover:bg-[var(--learn-surface)]"}`}>{VIEW_LABEL[v]}</Link>
        ))}
      </div>
    </nav>
  );
}

const card = "rounded-xl bg-[var(--cmp-app-surface)] ring-1 ring-gray-200";

/** The four ways in. A format with nowhere to go is not shown. */
export function PracticeFormats({ items }: { items: { icon: LearningIconName; title: string; text: string; action: string; href: string }[] }) {
  return (
    <section aria-labelledby="formats-h">
      <h2 id="formats-h" className="text-[16px] font-bold text-gray-900">Choose a practice format</h2>
      <ul className="mt-2 grid gap-2 sm:grid-cols-2">
        {items.map(i => (
          <li key={i.title} className={`${card} flex items-start gap-3 p-3.5`}>
            <span aria-hidden className="mt-0.5 shrink-0 text-gray-700"><LearningIcon name={i.icon} className="h-5 w-5" /></span>
            <div className="min-w-0 flex-1">
              <p className="text-[14.5px] font-bold text-gray-900">{i.title}</p>
              <p className="text-[13px] text-gray-700">{i.text}</p>
              <Link href={i.href} prefetch={false} className={`mt-1 text-[13.5px] ${toneAction.link}`}>{i.action}</Link>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function GlanceCard({ saved, attempts, revisit, unreadable }: { saved: number; attempts: number; revisit: number; unreadable: boolean }) {
  const stat = (n: number, label: string) => <div><dd className="cmp-learn-ink text-[22px] font-bold tabular-nums">{unreadable ? "?" : n}</dd><dt className="text-[12.5px] text-gray-700">{label}</dt></div>;
  return (
    <section aria-labelledby="glance-h" className={`cmp-learn-summary cmp-learn-box p-4`}>
      <h2 id="glance-h" className="text-[15px] font-bold text-gray-900">Your practice at a glance</h2>
      {unreadable ? <p className="mt-1 text-[13px] text-gray-700">Could not be read just now.</p> : <dl className="mt-2 grid grid-cols-3 gap-2">{stat(saved, "Saved")}{stat(attempts, "Attempts")}{stat(revisit, "To revisit")}</dl>}
      <p className="mt-2 text-[12.5px] text-gray-700">Simulated practice, not verified clinical competence.</p>
    </section>
  );
}

export function WhyPractice({ why, areas, allStudied }: { why: string; areas: { chunkId: string; materialId: string; label: string; materialTitle: string; how: string }[]; allStudied: boolean }) {
  return (
    <section aria-labelledby="why-h" className={`cmp-learn-sources cmp-learn-box p-4`} data-why-practice>
      <h2 id="why-h" className="text-[15px] font-bold text-gray-900">Why this practice?</h2>
      <p className="mt-1 text-[13px] text-gray-800">{why}</p>
      <ul className="mt-2 space-y-2">
        {areas.map(a => (
          <li key={a.chunkId} className="text-[13px]">
            <Link href={sourceHref(a.materialId, a.chunkId)} prefetch={false} className={toneAction.link}>{a.label}</Link>
            <span className="block text-gray-700">{a.how} · {a.materialTitle}</span>
          </li>
        ))}
      </ul>
      {!allStudied && <p className="mt-2 text-[12.5px] text-gray-700">Some of this is in your materials but you have not studied it yet.</p>}
    </section>
  );
}

const when = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

/** One stored activity. Opening it, or playing it again, uses no AI. */
export function PracticeRowView({ r }: { r: PracticeRow }) {
  return (
    <li className="px-3.5 py-3" data-practice-row={r.format} data-practice-key={r.key}>
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
        <div className="min-w-0 flex-1 basis-[16rem]">
          <Link href={r.href} prefetch={false} className={`break-words text-[14.5px] font-bold text-gray-900 underline-offset-2 hover:underline ${focusRing}`}>{r.title}</Link>
          <p className="mt-0.5 text-[12.5px] text-gray-700">{PRACTICE_FORMAT_LABEL[r.format]} · {PRACTICE_STATUS_LABEL[r.status]} · {r.attempts.length} {r.attempts.length === 1 ? "attempt" : "attempts"} · {when(r.lastAt)}</p>
          {r.sources.length > 0 && <p className="text-[12.5px] text-gray-700">From: {r.sources.slice(0, 3).join(", ")}{r.sources.length > 3 ? ` and ${r.sources.length - 3} more` : ""}</p>}
          {r.competencies.length > 0 && <p className="text-[12.5px] text-gray-700">Competencies: {r.competencies.slice(0, 3).join(", ")}</p>}
          <p className="text-[12px] text-gray-600">{r.reviewLabel}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-[13.5px]">
          {r.replayCaseId && <ReplayCase caseId={r.replayCaseId} title={r.attempts.length ? "Practise again" : "Start"} />}
        </div>
      </div>
      {r.gaps.length > 0 && (
        <div className="mt-1.5 text-[13px]" data-practice-gaps>
          <p className="font-semibold text-gray-900">To revisit</p>
          <ul className="list-disc pl-5 text-gray-800">{r.gaps.slice(0, 3).map(g => <li key={g}>{g}</li>)}</ul>
          {r.revise && (
            <p className="mt-1 flex flex-wrap gap-3">
              {r.revise.materialId && <Link href={`${studyHref("revise")}?material=${r.revise.materialId}`} prefetch={false} className={toneAction.link}>Revise this</Link>}
              {r.revise.chunkId && <Link href={`${studyHref("learn")}?section=${r.revise.chunkId}`} prefetch={false} className={toneAction.link}>Teach me this</Link>}
            </p>
          )}
        </div>
      )}
      {r.attempts.length > 0 && (
        <details className="mt-1" suppressHydrationWarning>
          <summary className={`cursor-pointer text-[12.5px] font-semibold text-gray-700 pointer-coarse:py-3.5 ${focusRing}`}>Attempts and feedback</summary>
          <ul className="mt-1 space-y-0.5 text-[13px]">{r.attempts.map((a, n) => (
            <li key={a.id}><Link href={a.href} prefetch={false} className={toneAction.link}>Attempt {r.attempts.length - n}</Link><span className="text-gray-700"> · {a.status === "completed" ? `finished ${when(a.finishedAt ?? a.startedAt)}` : `in progress, started ${when(a.startedAt)}`}{a.note ? ` · ${a.note}` : ""}</span></li>
          ))}</ul>
        </details>
      )}
    </li>
  );
}

/** What a stored case was written from, how, and what it links to. From the stored record, with no AI. */
export async function CaseProvenance({ admin, userId, sessionId }: { admin: unknown; userId: string; sessionId: string }) {
  const s = await getPrivateCaseSession(admin, userId, sessionId);
  const c = s ? await getPrivateCase(admin, userId, s.session.caseId) : null;
  if (!c) return null;
  const passages = (await Promise.all(c.chunkIds.slice(0, 20).map(id => getPassage(admin, userId, id)))).filter((p): p is NonNullable<typeof p> => !!p);
  const learner = c.competencyIds.length ? await loadLearnerCatalogue(admin, userId) : null;
  const names = learner ? await competencyLabels(admin, learner.competencies, c.competencyIds, new Map()) : new Map();
  return (
    <details className={`cmp-learn-sources cmp-learn-box mb-4 p-3.5`} data-case-provenance suppressHydrationWarning>
      <summary className={`cursor-pointer text-[13.5px] font-semibold text-gray-900 pointer-coarse:py-3.5 ${focusRing}`}>Sources and competency links</summary>
      <LearningSectionHead icon="library" level={3} id="case-sources-h" caps={false} title="Written from" className="mt-2" />
      <ul className="mt-1 space-y-0.5 text-[13px]">{passages.map(p => <li key={p.chunkId}><Link href={sourceHref(p.materialId, p.chunkId)} prefetch={false} className={toneAction.link}>{p.materialTitle}, {citeChunk({ ordinal: p.ordinal, pageFrom: p.pageFrom, pageTo: p.pageTo }, p.unit)}</Link></li>)}</ul>
      {c.competencyIds.length > 0 && <p className="mt-2 text-[13px] text-gray-800"><span className="font-semibold">Competencies it combines: </span>{c.competencyIds.map(id => names.get(id)?.title ?? "A competency").join(", ")}</p>}
      <p className="mt-2 text-[12px] text-gray-600">AI-generated educational example, stored {when(c.createdAt)}. Not clinically approved. Written by {c.model}, version {c.promptVersion}. Private to you. Simulated practice is not verified clinical competence.</p>
    </details>
  );
}
