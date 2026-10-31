import Link from "next/link";
import { LEVEL_LABEL } from "@/lib/individual/scholar/question-intel";
import { MARKING_LABEL, STATUS_LABEL, type Marking, type StudyNext, type TopicEntry, type TopicProgress, type TopicStatus } from "@/lib/individual/scholar/study-next";
import { NOT_COMPETENCE_LABEL } from "@/lib/individual/scholar/config";
import { focusRing } from "../../../../../_components/chrome";

// SCHOLAR-COMPANION-01 P1 -- "Study next" and "Learning progress by topic", at the top of Progress.
// Presentational only: every figure and every reason comes from src/lib/individual/scholar/study-next.ts.
//
// ⚠ LEARNING PROGRESS, NOT VERIFIED COMPETENCE. The status words describe recent practice on the learner's own notes.
// Competency rows carry NOT_COMPETENCE_LABEL. Nothing here reaches the Passport.
// ⚠ A status is always a word (never colour alone), and a topic with no answers says "Not started", never 0%.

const CHIP: Record<TopicStatus, string> = {
  needs_work: "border-red-300 bg-red-50 text-red-900",
  developing: "border-amber-300 bg-amber-50 text-amber-900",
  secure: "border-green-300 bg-green-50 text-green-900",
  not_started: "border-gray-300 bg-gray-50 text-gray-700",
};
const MARK_ORDER: Marking[] = ["code", "ai_evaluation", "self"];
const SHOWN = 12;

const button = `inline-flex min-h-[44px] shrink-0 items-center justify-center rounded-xl px-4 py-2 text-[13.5px] font-semibold text-white pointer-coarse:min-h-[48px] ${focusRing}`;

export function StudyNextCard({ items, accent }: { items: StudyNext[]; accent: string }) {
  return (
    <section aria-labelledby="study-next-h" className="mb-6 rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
      <h2 id="study-next-h" className="text-[15px] font-bold text-gray-900">Study next</h2>
      {items.length === 0 ? (
        <p className="mt-2 text-[13.5px] text-gray-700">Nothing stands out yet. Answer some practice questions and Scholar will say where to go next, with the reason.</p>
      ) : (
        <>
          <p className="mt-0.5 text-[12.5px] text-gray-600">Worked out from your own answers, with no AI. Each one says why.</p>
          <ol className="mt-3 divide-y divide-gray-100">
            {items.map(s => (
              <li key={s.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 md:flex-row md:items-center md:justify-between md:gap-4">
                <div className="min-w-0">
                  <p className="text-[14.5px] font-semibold text-gray-900">{s.title}</p>
                  <p className="text-[13px] text-gray-700">{s.reason}</p>
                </div>
                <Link href={s.action.href} className={button} style={{ background: accent }}>{s.action.label}<span className="sr-only">: {s.title}</span></Link>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}

function Chip({ status }: { status: TopicStatus }) {
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[12px] font-semibold ${CHIP[status]}`}>{STATUS_LABEL[status]}</span>;
}

function Row({ e }: { e: TopicEntry }) {
  const marks = MARK_ORDER.filter(m => e.byMarking[m] > 0).map(m => `${e.byMarking[m]} ${MARKING_LABEL[m]}`).join(", ");
  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0 text-[14px] font-semibold text-gray-900">{e.label}</span>
        <Chip status={e.status} />
      </div>
      {e.attempts === 0 ? (
        <p className="mt-1 text-[12.5px] text-gray-600">No answers yet.{e.kind === "competency" ? " Your notes are linked to it, but you have not practised them." : ""}</p>
      ) : (
        <p className="mt-1 text-[12.5px] tabular-nums text-gray-700">
          {e.highestLevel ? `Level reached: ${LEVEL_LABEL[e.highestLevel]}` : "No level shown yet"} · {e.recentAccuracy}% recent accuracy · {e.attempts} answer{e.attempts === 1 ? "" : "s"}
          {e.weakConcepts.length ? ` · ${e.weakConcepts.length} question${e.weakConcepts.length === 1 ? "" : "s"} still going wrong` : ""}
        </p>
      )}
      {e.kind === "competency" && <p className="mt-0.5 text-[12px] text-gray-600">{NOT_COMPETENCE_LABEL}</p>}
      {e.attempts > 0 && (
        <details className="mt-1">
          <summary className={`cursor-pointer text-[12.5px] font-semibold text-gray-700 underline-offset-2 hover:underline pointer-coarse:py-2 ${focusRing}`}>How this was worked out</summary>
          <p className="mt-1 text-[12.5px] text-gray-700">{e.basis}</p>
          <p className="mt-1 text-[12.5px] text-gray-600">Evidence: {marks}.</p>
        </details>
      )}
    </li>
  );
}

export function TopicProgressSection({ m }: { m: TopicProgress }) {
  const topics = m.topics.slice(0, SHOWN);
  const marks = MARK_ORDER.filter(k => m.byMarking[k] > 0).map(k => `${m.byMarking[k]} ${MARKING_LABEL[k]}`).join(", ");
  return (
    <section aria-labelledby="topic-progress-h" className="mt-8">
      <h2 id="topic-progress-h" className="text-[13px] font-bold uppercase tracking-[0.14em] text-gray-500">Learning progress by topic</h2>
      <p className="mt-1 text-[13px] text-gray-600">
        How your recent practice is going, topic by topic: needs work, developing or going well. This is learning progress on your own notes, not verified competence.
        {m.evidenceCount > 0 ? ` Based on ${m.evidenceCount} answer${m.evidenceCount === 1 ? "" : "s"}: ${marks}. App-marked answers count in full, AI-evaluated and self-rated ones count less.` : ""}
      </p>
      <div className="mt-3 space-y-3">
        {topics.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-gray-300 bg-white p-5 text-[14px] text-gray-600">No topics to show yet. Topics appear once Scholar has looked at a material and you have answered questions on it.</p>
        ) : (
          <ul aria-label="Learning progress by topic" className="divide-y divide-gray-100 rounded-2xl border border-gray-200 bg-white">
            {topics.map(e => <Row key={e.key} e={e} />)}
          </ul>
        )}
        {m.topics.length > SHOWN && <p className="text-[12.5px] text-gray-600">And {m.topics.length - SHOWN} more topics.</p>}
        {m.competencies.length > 0 && (
          <div>
            <h3 className="text-[14px] font-bold text-gray-900">By competency of your programme</h3>
            <p className="mt-0.5 text-[12.5px] text-gray-600">Only practice on sections you have accepted as linked to the competency counts. {NOT_COMPETENCE_LABEL}</p>
            <ul aria-label="Learning progress by competency" className="mt-2 divide-y divide-gray-100 rounded-2xl border border-gray-200 bg-white">
              {m.competencies.map(e => <Row key={e.key} e={e} />)}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
