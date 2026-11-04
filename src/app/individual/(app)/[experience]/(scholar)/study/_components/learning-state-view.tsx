import Link from "next/link";
import { experienceHref } from "@/lib/individual/experiences";
import { EVIDENCE_WORD_LABEL, LEARNING_STATE_NOTE, evidenceLine, type EvidenceWord, type TopicLearningState } from "@/lib/individual/scholar/learning-state";
import { Fold } from "./progress-parts";
import { TopicFix } from "./learning-state-topic-fix";
import { focusRing } from "../../../../../_components/chrome";

// SALE-2026-11 R1 / SALE-04 -- "What your evidence shows, by topic", on Progress beside Learning progress by topic. Presentational:
// every word and every reason comes from src/lib/individual/scholar/learning-state.ts (pure, no AI). The learner sees the evidence
// behind each topic and can correct a section filed under the wrong topic (the existing topic correction, /api/individual/scholar/topics)
// or a competency link (My competencies).
//
// ⚠ WORDS, NEVER A NUMBER THAT LOOKS CALIBRATED; "Not enough evidence" when it is thin; never verified competence, never a stage.

const WORD_CHIP: Record<EvidenceWord, string> = {
  none: "border-gray-300 bg-gray-50 text-gray-700",
  thin: "border-amber-300 bg-amber-50 text-amber-900",
  some: "border-sky-300 bg-sky-50 text-sky-900",
  stronger: "border-green-300 bg-green-50 text-green-900",
};
const SHOWN = 10;

function Word({ w, misconception }: { w: EvidenceWord; misconception?: boolean }) {
  // For misconceptions, more evidence is a reason to act, so the words say so (never colour alone).
  const label = misconception ? ({ none: "None seen", thin: "Not enough to tell", some: "Possible", stronger: "Likely" } as const)[w] : EVIDENCE_WORD_LABEL[w];
  const cls = misconception ? ({ none: WORD_CHIP.none, thin: WORD_CHIP.thin, some: WORD_CHIP.thin, stronger: "border-red-300 bg-red-50 text-red-900" } as const)[w] : WORD_CHIP[w];
  return <span className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-[12px] font-semibold ${cls}`}>{label}</span>;
}

function TopicState({ t, sections }: { t: TopicLearningState; sections: { chunkId: string; label: string; topics: string[] }[] }) {
  return (
    <li className="px-4 py-3" data-learning-state-topic={t.key}>
      {/* The browser may restore a native disclosure's open state before hydration (back / revisit): not a content mismatch. */}
      <details suppressHydrationWarning>
        <summary className={`flex cursor-pointer flex-wrap items-center justify-between gap-2 pointer-coarse:py-2 ${focusRing}`}>
          <span className="min-w-0 text-[14px] font-semibold text-gray-900">{t.label}</span>
          <span className="text-[12px] font-semibold text-gray-600">{t.enough ? "See the evidence" : "Not enough evidence"}</span>
        </summary>
        <p className="mt-1.5 text-[13px] text-gray-800" data-learning-state-headline>{t.headline}</p>
        <dl className="mt-2 divide-y divide-gray-100 rounded-xl border border-gray-200">
          {t.dimensions.map(d => (
            <div key={d.key} className="px-3 py-2" data-dimension={d.key} data-word={d.word}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <dt className="text-[13px] font-semibold text-gray-900">{d.label}</dt>
                {d.key !== "activity" && d.key !== "confidence" && d.key !== "exposure" && <dd><Word w={d.word} misconception={d.key === "misconceptions"} /></dd>}
              </div>
              <dd className="mt-0.5 text-[12.5px] text-gray-700">{d.summary}</dd>
            </div>
          ))}
        </dl>
        {t.evidence.length > 0 && (
          <div className="mt-2">
            <h4 className="text-[12px] font-bold uppercase tracking-[0.1em] text-gray-600">The answers behind it (newest first)</h4>
            <ul className="mt-1 space-y-0.5 text-[12.5px] text-gray-700">{t.evidence.map((e, i) => <li key={i}>{evidenceLine(e)}</li>)}</ul>
          </div>
        )}
        <div className="mt-2 rounded-xl bg-gray-50 px-3 py-2">
          <p className="text-[12.5px] text-gray-700">Is something here filed under the wrong topic? Correct the topics of its section, and the evidence moves with it. A competency link is changed in <Link href={experienceHref("scholar", "my-competencies")} className={`font-semibold underline underline-offset-2 ${focusRing}`}>My competencies</Link>.</p>
          {sections.length > 0 && <TopicFix sections={sections} />}
        </div>
      </details>
    </li>
  );
}

export function LearningStateSection({ states, concepts, materials }: {
  states: TopicLearningState[];
  /** The current topics of each section (Progress read them), for the topic correction. */
  concepts: ReadonlyMap<string, readonly string[]> | null;
  materials: ReadonlyMap<string, string>;
}) {
  const shown = states.slice(0, SHOWN);
  const enough = states.filter(s => s.enough).length;
  return (
    <section aria-labelledby="learning-state-h" className="mt-8">
      <h2 id="learning-state-h" className="text-[13px] font-bold uppercase tracking-[0.14em] text-gray-500">What your evidence shows, by topic</h2>
      <p className="mt-1 text-[13px] text-gray-600">For each topic: what you have met, understood, recalled later and applied, any likely misconception, and how strong the evidence is. Worked out from your own records with stated rules and no AI. {LEARNING_STATE_NOTE}</p>
      <div className="mt-3">
        {states.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-gray-300 bg-white p-5 text-[14px] text-gray-600">No learning recorded on any topic yet, so Scholar draws no conclusion.</p>
        ) : (
          <Fold summary={`${states.length} topic${states.length === 1 ? "" : "s"}, ${enough} with enough evidence to say something`}>
            <ul aria-label="What your evidence shows, by topic" className="divide-y divide-gray-100">
              {shown.map(t => (
                <TopicState key={t.key} t={t} sections={t.chunkIds.slice(0, 3).map((chunkId, i) => ({
                  chunkId, topics: [...(concepts?.get(chunkId) ?? [])],
                  label: `${t.materialId ? materials.get(t.materialId) ?? "Your notes" : "Your notes"}, section ${i + 1}`,
                }))} />
              ))}
            </ul>
            {states.length > SHOWN && <p className="border-t border-gray-100 px-4 py-2 text-[12.5px] text-gray-600">And {states.length - SHOWN} more topics.</p>}
          </Fold>
        )}
      </div>
    </section>
  );
}
