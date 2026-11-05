import Link from "next/link";
import { experienceHref } from "@/lib/individual/experiences";
import { EVIDENCE_WORD_LABEL, LEARNING_STATE_NOTE, evidenceLine, type EvidenceWord, type TopicLearningState } from "@/lib/individual/scholar/learning-state";
import { LearningSection } from "@/components/ui/scholar-learning";
import { EVIDENCE_WORD_LOOK, Fold, StateChip, sectionLead, type ChipLook } from "./progress-parts";
import { TopicFix } from "./learning-state-topic-fix";
import { focusRing } from "../../../../../_components/chrome";
import { TransferOffer } from "./transfer-offer";
import type { RetentionView } from "@/lib/individual/scholar/retention-data";

/** SALE-2026-11 R2: what the retention rules say about one topic (each only while its HQ key is on). */
type TopicRetention = { prerequisite: NonNullable<RetentionView["prerequisites"]>[number] | null; transfer: { reason: string } | null; due: string | null };
const normKey = (t: string) => t.trim().toLowerCase().replace(/s+/g, " ");

// SALE-2026-11 R1 / SALE-04 -- "What your evidence shows, by topic", on Progress beside Learning progress by topic. Presentational:
// every word and every reason comes from src/lib/individual/scholar/learning-state.ts (pure, no AI). The learner sees the evidence
// behind each topic and can correct a section filed under the wrong topic (the existing topic correction, /api/individual/scholar/topics)
// or a competency link (My competencies).
//
// ⚠ WORDS, NEVER A NUMBER THAT LOOKS CALIBRATED; "Not enough evidence" when it is thin; never verified competence, never a stage.
// DS rollout: the record tone. Each word has a shape, and a likely misconception is the calm revision amber, never red.

const MISCONCEPTION_LOOK: Record<EvidenceWord, ChipLook> = {
  none: { tone: "neutral", mark: "none" },
  thin: { tone: "developing", mark: "none" },
  some: { tone: "developing", mark: "read" },
  stronger: { tone: "needs_work", mark: "current" },
};
const SHOWN = 10;

function Word({ w, misconception }: { w: EvidenceWord; misconception?: boolean }) {
  // For misconceptions, more evidence is a reason to act, so the words say so (never colour alone).
  const label = misconception ? ({ none: "None seen", thin: "Not enough to tell", some: "Possible", stronger: "Likely" } as const)[w] : EVIDENCE_WORD_LABEL[w];
  return <StateChip {...(misconception ? MISCONCEPTION_LOOK : EVIDENCE_WORD_LOOK)[w]}>{label}</StateChip>;
}

function TopicState({ t, sections, extra, accent }: { t: TopicLearningState; sections: { chunkId: string; label: string; topics: string[] }[]; extra: TopicRetention | null; accent: string }) {
  return (
    <li className="px-4 py-3" data-learning-state-topic={t.key}>
      {/* The browser may restore a native disclosure's open state before hydration (back / revisit): not a content mismatch. */}
      <details suppressHydrationWarning>
        <summary className={`flex cursor-pointer flex-wrap items-center justify-between gap-2 pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`}>
          <span className="min-w-0 text-[14px] font-semibold text-gray-900">{t.label}</span>
          <span className="text-[12.5px] font-semibold text-gray-700">{t.enough ? "See the evidence" : "Not enough evidence"}</span>
        </summary>
        <p className="mt-1.5 text-[13px] text-gray-800" data-learning-state-headline>{t.headline}</p>
        <dl className="mt-2 divide-y divide-gray-100 rounded-xl border border-gray-200">
          {t.dimensions.map(d => (
            <div key={d.key} className="px-3 py-2" data-dimension={d.key} data-word={d.word}>
              <dt className="flex flex-wrap items-center justify-between gap-2 text-[13px] font-semibold text-gray-900">
                <span>{d.label}</span>
                {d.key !== "activity" && d.key !== "confidence" && d.key !== "exposure" && <Word w={d.word} misconception={d.key === "misconceptions"} />}
              </dt>
              <dd className="mt-0.5 text-[13px] leading-relaxed text-gray-700">{d.summary}</dd>
            </div>
          ))}
        </dl>
        {extra?.due && <p className="mt-2 text-[13px] text-gray-800" data-topic-retrieval>Due for retrieval: {extra.due}</p>}
        {extra?.prerequisite && (
          <div className="cmp-learn-next cmp-learn-box mt-2 px-3 py-2" data-topic-prerequisite={extra.prerequisite.prerequisite.id}>
            <p className="text-[13px] font-semibold text-gray-900">A foundation to review first: {extra.prerequisite.prerequisite.title}</p>
            <p className="mt-0.5 text-[13px] leading-relaxed text-gray-800">{extra.prerequisite.reason}</p>
            <Link href={extra.prerequisite.href} className={`mt-1 inline-flex min-h-[44px] items-center text-[13.5px] font-semibold underline underline-offset-2 pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`}>{extra.prerequisite.section ? `Review your notes: ${extra.prerequisite.section.label}` : `Learn "${extra.prerequisite.prerequisite.title}"`}</Link>
          </div>
        )}
        {extra?.transfer && (
          <div className="cmp-learn-practice cmp-learn-box mt-2 px-3 py-2" data-topic-transfer>
            <p className="text-[13px] leading-relaxed text-gray-800">{extra.transfer.reason}</p>
            <TransferOffer topic={t.label} accent={accent} />
          </div>
        )}
        {t.evidence.length > 0 && (
          <div className="mt-2">
            <h4 className="text-[12px] font-bold uppercase tracking-[0.08em] text-gray-700">The answers behind it (newest first)</h4>
            <ul className="mt-1 space-y-0.5 text-[13px] text-gray-700">{t.evidence.map((e, i) => <li key={i}>{evidenceLine(e)}</li>)}</ul>
          </div>
        )}
        <div className="mt-2 rounded-xl bg-gray-50 px-3 py-2">
          <p className="text-[13px] leading-relaxed text-gray-700">Is something here filed under the wrong topic? Correct the topics of its section, and the evidence moves with it. A competency link is changed in <Link href={experienceHref("scholar", "my-competencies")} className={`font-semibold underline underline-offset-2 ${focusRing}`}>My competencies</Link>.</p>
          {sections.length > 0 && <TopicFix sections={sections} />}
        </div>
      </details>
    </li>
  );
}

export function LearningStateSection({ states, concepts, materials, retention = null, accent }: {
  states: TopicLearningState[];
  /** The current topics of each section (Progress read them), for the topic correction. */
  concepts: ReadonlyMap<string, readonly string[]> | null;
  materials: ReadonlyMap<string, string>;
  /** SALE-2026-11 R2: due retrieval, prerequisite reviews and transfer offers, where their keys are on. */
  retention?: RetentionView | null;
  accent: string;
}) {
  const extraOf = (t: TopicLearningState): TopicRetention | null => {
    if (!retention) return null;
    const due = retention.schedule?.due.find(i => i.topicKey === t.key) ?? retention.schedule?.upcoming.find(i => i.topicKey === t.key) ?? null;
    return {
      prerequisite: retention.prerequisites?.find(p => p.topicKey === t.key) ?? null,
      transfer: retention.transfer?.find(x => normKey(x.topic) === t.key) ?? null,
      due: due ? `${due.state === "due" ? (due.overdueDays ? `since ${due.dueOn}` : "today") : due.dueOn}. ${due.reasons[0]}` : null,
    };
  };
  const shown = states.slice(0, SHOWN);
  const enough = states.filter(s => s.enough).length;
  return (
    <LearningSection caps={false} tone="record" icon="record" level={2} headingId="learning-state-h" title="What your evidence shows, by topic" className="mt-6">
      <p className={sectionLead}>For each topic: what you have met, understood, recalled later and applied, any likely misconception, and how strong the evidence is. Worked out from your own records with stated rules and no AI. {LEARNING_STATE_NOTE}</p>
      <div className="mt-3">
        {states.length === 0 ? (
          <p className="rounded-xl border border-dashed border-gray-300 bg-white p-4 text-[14px] text-gray-700">No learning recorded on any topic yet, so Scholar draws no conclusion.</p>
        ) : (
          <Fold summary={`${states.length} topic${states.length === 1 ? "" : "s"}, ${enough} with enough evidence to say something`}>
            <ul aria-label="What your evidence shows, by topic" className="divide-y divide-gray-100">
              {shown.map(t => (
                <TopicState key={t.key} t={t} extra={extraOf(t)} accent={accent} sections={t.chunkIds.slice(0, 3).map((chunkId, i) => ({
                  chunkId, topics: [...(concepts?.get(chunkId) ?? [])],
                  label: `${t.materialId ? materials.get(t.materialId) ?? "Your notes" : "Your notes"}, section ${i + 1}`,
                }))} />
              ))}
            </ul>
            {states.length > SHOWN && <p className="border-t border-gray-100 px-4 py-2 text-[13px] text-gray-700">And {states.length - SHOWN} more topics.</p>}
          </Fold>
        )}
      </div>
    </LearningSection>
  );
}
