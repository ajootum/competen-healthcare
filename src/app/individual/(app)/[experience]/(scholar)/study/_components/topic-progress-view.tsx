import Link from "next/link";
import { LEVEL_LABEL } from "@/lib/individual/scholar/question-intel";
import { MARKING_LABEL, STATUS_LABEL, type Marking, type StudyNext, type TopicEntry, type TopicProgress, type TopicStatus } from "@/lib/individual/scholar/study-next";
import { listSummary, practisedDetail } from "@/lib/individual/scholar/progress-simplify";
import { LearningSection, LearningSectionHead, SectionCard } from "@/components/ui/scholar-learning";
import { Fold, StateChip, sectionLead, toneAction, type ChipLook } from "./progress-parts";
import { focusRing } from "../../../../../_components/chrome";

// SCHOLAR-COMPANION-01 P1 -- "Study next" and "Learning progress by topic", at the top of Progress.
// Presentational only: every figure and every reason comes from src/lib/individual/scholar/study-next.ts.
//
// ⚠ LEARNING PROGRESS, NOT VERIFIED COMPETENCE. The status words describe recent practice on the learner's own notes.
// The not-competence note is said once, at the top of Progress. Nothing here reaches the Passport.
// ⚠ A status is always a word (never colour alone), and a topic with no answers says "Not started", never 0%.
// DS rollout: Study next in the next tone, practice by topic in the check tone. A status is a word and a shape, never red or a reassuring green.

const CHIP: Record<TopicStatus, ChipLook> = {
  needs_work: { tone: "needs_work", mark: "current" },
  developing: { tone: "developing", mark: "read" },
  secure: { tone: "strong", mark: "checked" },
  not_started: { tone: "neutral", mark: "none" },
};
const MARK_ORDER: Marking[] = ["code", "ai_evaluation", "self"];
const SHOWN = 12;

export function StudyNextCard({ items }: { items: StudyNext[] }) {
  return (
    <section aria-labelledby="study-next-h" className="cmp-learn-next cmp-learn-box mb-6 p-4 sm:p-5">
      <LearningSectionHead icon="target" level={2} id="study-next-h" caps={false} title="Study next" />
      {items.length === 0 ? (
        <p className="mt-2 text-[13.5px] text-gray-800">Nothing stands out yet. Answer some practice questions and Scholar will say where to go next, with the reason.</p>
      ) : (
        <>
          <p className="mt-1.5 text-[13.5px] text-gray-800">Worked out from your own answers, with no AI. Each one says why.</p>
          <ol className="mt-3 space-y-2">
            {items.map((s, i) => (
              <SectionCard key={s.id} as="li" className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between md:gap-4">
                <div className="min-w-0">
                  <p className="text-[14.5px] font-semibold text-gray-900">{s.title}</p>
                  <p className="text-[13.5px] leading-relaxed text-gray-700">{s.reason}</p>
                </div>
                <Link href={s.action.href} className={`${i === 0 ? toneAction.primary : toneAction.secondary} shrink-0`}>{s.action.label}<span className="sr-only">: {s.title}</span></Link>
              </SectionCard>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}

function Chip({ status }: { status: TopicStatus }) {
  return <StateChip {...CHIP[status]}>{STATUS_LABEL[status]}</StateChip>;
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
        <p className="mt-1 text-[13px] text-gray-700">No answers yet.{e.kind === "competency" ? " Your notes are linked to it, but you have not practised them." : ""}</p>
      ) : (
        <p className="mt-1 text-[13px] tabular-nums text-gray-700">
          {e.highestLevel ? `Level reached: ${LEVEL_LABEL[e.highestLevel]}` : "No level shown yet"} · {e.recentAccuracy}% recent accuracy · {e.attempts} answer{e.attempts === 1 ? "" : "s"}
          {e.weakConcepts.length ? ` · ${e.weakConcepts.length} question${e.weakConcepts.length === 1 ? "" : "s"} still going wrong` : ""}
        </p>
      )}
      {e.attempts > 0 && (
        <details className="mt-1">
          <summary className={`cursor-pointer text-[13px] font-semibold text-gray-700 underline-offset-2 hover:underline pointer-coarse:py-3.5 ${focusRing}`}>How this was worked out</summary>
          <p className="mt-1 text-[13px] leading-relaxed text-gray-700">{e.basis}</p>
          <p className="mt-1 text-[13px] text-gray-700">Evidence: {marks}.</p>
        </details>
      )}
    </li>
  );
}

export function TopicProgressSection({ m }: { m: TopicProgress }) {
  const topics = m.topics.slice(0, SHOWN);
  const marks = MARK_ORDER.filter(k => m.byMarking[k] > 0).map(k => `${m.byMarking[k]} ${MARKING_LABEL[k]}`).join(", ");
  return (
    <LearningSection caps={false} tone="check" icon="check" level={2} headingId="topic-progress-h" title="Learning progress by topic" className="mt-6">
      <p className={sectionLead}>
        How your recent practice is going, topic by topic: needs work, developing or going well.
        {m.evidenceCount > 0 ? ` Based on ${m.evidenceCount} answer${m.evidenceCount === 1 ? "" : "s"}: ${marks}. App-marked answers count in full, AI-evaluated and self-rated ones count less.` : ""}
      </p>
      <div className="mt-3 space-y-3">
        {topics.length === 0 ? (
          <p className="rounded-xl border border-dashed border-gray-300 bg-white p-4 text-[14px] text-gray-700">No topics to show yet. Topics appear once Scholar has looked at a material and you have answered questions on it.</p>
        ) : (
          <Fold summary={listSummary({ one: "topic" }, m.topics.length, practisedDetail(m.topics.filter(t => t.attempts > 0).length, m.topics.length))}>
            <ul aria-label="Learning progress by topic" className="divide-y divide-gray-100">
              {topics.map(e => <Row key={e.key} e={e} />)}
            </ul>
            {m.topics.length > SHOWN && <p className="border-t border-gray-100 px-4 py-2 text-[13px] text-gray-700">And {m.topics.length - SHOWN} more topics.</p>}
          </Fold>
        )}
        {m.competencies.length > 0 && (
          <div>
            <h3 className="cmp-learn-ink text-[14px] font-bold">By competency of your programme</h3>
            <p className="mt-0.5 text-[13px] text-gray-700">Only practice on sections you have accepted as linked to the competency counts.</p>
            <div className="mt-2">
              <Fold summary={listSummary({ one: "competency", many: "competencies" }, m.competencies.length, practisedDetail(m.competencies.filter(t => t.attempts > 0).length, m.competencies.length))}>
                <ul aria-label="Learning progress by competency" className="divide-y divide-gray-100">
                  {m.competencies.map(e => <Row key={e.key} e={e} />)}
                </ul>
              </Fold>
            </div>
          </div>
        )}
      </div>
    </LearningSection>
  );
}
