import { EVIDENCE_WORD_LABEL, type EvidenceWord } from "@/lib/individual/scholar/learning-state";
import {
  APPLICATION_NOTE, APPLICATION_SKILL_LABEL, EVIDENCE_SOURCE_WORD, mappingLine, outcomeWord, isDraft,
  type EvidenceRecord, type SkillSummary,
} from "@/lib/individual/scholar/application-evidence";
import { Fold } from "./progress-parts";
import { Unreadable } from "../../../../../_components/chrome";

// SALE-2026-11 R4 / SALE-13 -- "Applying what you learned", on Progress (behind scholar_application_evidence, default off).
// Presentational: every word, rule and link comes from src/lib/individual/scholar/application-evidence.ts (pure, no AI).
// ⚠ WORDS, NEVER A SCORE; a draft mapping always says it is not validated evidence; never verified competence, never a stage.

const WORD_CHIP: Record<EvidenceWord, string> = {
  none: "border-gray-300 bg-gray-50 text-gray-700",
  thin: "border-amber-300 bg-amber-50 text-amber-900",
  some: "border-sky-300 bg-sky-50 text-sky-900",
  stronger: "border-green-300 bg-green-50 text-green-900",
};
const SHOWN = 12;
const day = (iso: string) => iso.slice(0, 10);

export function ApplicationRecordItem({ r, competencyTitle }: { r: EvidenceRecord; competencyTitle: (id: string) => string }) {
  return (
    <li className="px-4 py-3" data-application-record={r.source}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="min-w-0 break-words text-[14px] font-semibold text-gray-900">{r.title}</p>
        <p className="text-[12.5px] text-gray-600">{EVIDENCE_SOURCE_WORD[r.source]} · {day(r.at)}</p>
      </div>
      <p className="mt-0.5 text-[12.5px] text-gray-700">
        Overall: {outcomeWord(r.outcome)}
        {r.skills.length > 0 && <> · {r.skills.map(s => `${APPLICATION_SKILL_LABEL[s.skill]}: ${outcomeWord(s.outcome)}`).join("; ")}</>}
        {r.safetyBroken > 0 && <> · {r.safetyBroken} safety point{r.safetyBroken === 1 ? "" : "s"} missed</>}
      </p>
      {r.competencies.length === 0
        ? <p className="mt-1 text-[12.5px] text-gray-600">Not linked to a competency of your programme.</p>
        : (
          <ul className="mt-1 space-y-0.5 text-[12.5px] text-gray-700" aria-label="Linked competencies">
            {r.competencies.map(l => (
              <li key={l.competencyId} data-mapping-status={l.mappingStatus ?? "not_recorded"} className="break-words">
                <span className="font-semibold text-gray-900">{competencyTitle(l.competencyId)}</span>
                {l.objective && <> · objective: {l.objective}</>}
                {" · "}{mappingLine(l)}
                {isDraft(l) && <span className="ml-1 inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-2 py-0 text-[11.5px] font-semibold text-amber-900">Draft mapping</span>}
              </li>
            ))}
          </ul>
        )}
    </li>
  );
}

export function ApplicationEvidenceSection({ records, skills, competencyTitle }: {
  /** null: the read failed (said as such, never shown as none). */
  records: EvidenceRecord[] | null;
  skills: SkillSummary[];
  competencyTitle: (id: string) => string;
}) {
  return (
    <section aria-labelledby="application-h" className="mt-8" data-testid="application-evidence">
      <h2 id="application-h" className="text-[13px] font-bold uppercase tracking-[0.14em] text-gray-500">Applying what you learned</h2>
      <p className="mt-1 text-[13px] text-gray-600">Your clinical cases and OSCE practice, by the skill each part exercised, and the competency each was made for. {APPLICATION_NOTE}</p>
      <div className="mt-3 space-y-3">
        {records === null ? <Unreadable what="your case and OSCE practice" />
          : records.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-gray-300 bg-white p-5 text-[14px] text-gray-600">No completed case or OSCE practice yet, so there is no application evidence to show.</p>
          ) : (
            <>
              <dl className="divide-y divide-gray-100 rounded-2xl border border-gray-200 bg-white">
                {skills.map(s => (
                  <div key={s.skill} className="px-4 py-3" data-skill={s.skill} data-word={s.word}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <dt className="text-[14px] font-semibold text-gray-900">{s.label}</dt>
                      <dd><span className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-[12px] font-semibold ${WORD_CHIP[s.word]}`}>{EVIDENCE_WORD_LABEL[s.word]}</span></dd>
                    </div>
                    <dd className="mt-0.5 text-[12.5px] text-gray-700">{s.summary}{s.lastAt ? ` Latest on ${day(s.lastAt)}.` : ""}</dd>
                  </div>
                ))}
              </dl>
              <Fold summary={`${records.length} case and OSCE record${records.length === 1 ? "" : "s"}, newest first`} label="Show the records">
                <ul className="divide-y divide-gray-100">
                  {records.slice(0, SHOWN).map(r => <ApplicationRecordItem key={r.id} r={r} competencyTitle={competencyTitle} />)}
                </ul>
                {records.length > SHOWN && <p className="px-4 pb-3 text-[12.5px] text-gray-600">The {SHOWN} newest are shown.</p>}
              </Fold>
            </>
          )}
      </div>
    </section>
  );
}
