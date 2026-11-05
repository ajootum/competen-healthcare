import { EVIDENCE_WORD_LABEL } from "@/lib/individual/scholar/learning-state";
import {
  APPLICATION_NOTE, APPLICATION_SKILL_LABEL, EVIDENCE_SOURCE_WORD, mappingLine, outcomeWord, isDraft,
  type EvidenceRecord, type SkillSummary,
} from "@/lib/individual/scholar/application-evidence";
import { LearningSectionHead } from "@/components/ui/scholar-learning";
import { EVIDENCE_WORD_LOOK, Fold, StateChip, sectionLead } from "./progress-parts";
import { Unreadable } from "../../../../../_components/chrome";

// SALE-2026-11 R4 / SALE-13 -- "Applying what you learned", on Progress (behind scholar_application_evidence, default off).
// Presentational: every word, rule and link comes from src/lib/individual/scholar/application-evidence.ts (pure, no AI).
// ⚠ WORDS, NEVER A SCORE; a draft mapping always says it is not validated evidence; never verified competence, never a stage.
// DS rollout: the practice tone, as Apply. Each word has a shape.

const SHOWN = 12;
const day = (iso: string) => iso.slice(0, 10);

export function ApplicationRecordItem({ r, competencyTitle }: { r: EvidenceRecord; competencyTitle: (id: string) => string }) {
  return (
    <li className="px-4 py-3" data-application-record={r.source}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="min-w-0 break-words text-[14px] font-semibold text-gray-900">{r.title}</p>
        <p className="text-[13px] text-gray-700">{EVIDENCE_SOURCE_WORD[r.source]} · {day(r.at)}</p>
      </div>
      <p className="mt-0.5 text-[13px] leading-relaxed text-gray-700">
        Overall: {outcomeWord(r.outcome)}
        {r.skills.length > 0 && <> · {r.skills.map(s => `${APPLICATION_SKILL_LABEL[s.skill]}: ${outcomeWord(s.outcome)}`).join("; ")}</>}
        {r.safetyBroken > 0 && <> · {r.safetyBroken} safety point{r.safetyBroken === 1 ? "" : "s"} missed</>}
      </p>
      {r.competencies.length === 0
        ? <p className="mt-1 text-[13px] text-gray-700">Not linked to a competency of your programme.</p>
        : (
          <ul className="mt-1 space-y-0.5 text-[13px] leading-relaxed text-gray-700" aria-label="Linked competencies">
            {r.competencies.map(l => (
              <li key={l.competencyId} data-mapping-status={l.mappingStatus ?? "not_recorded"} className="break-words">
                <span className="font-semibold text-gray-900">{competencyTitle(l.competencyId)}</span>
                {l.objective && <> · objective: {l.objective}</>}
                {" · "}{mappingLine(l)}
                {isDraft(l) && <> <StateChip tone="developing" mark="none">Draft mapping</StateChip></>}
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
    <section aria-labelledby="application-h" className="cmp-learn-practice cmp-learn-box mt-6 p-4 sm:p-5" data-testid="application-evidence">
      <LearningSectionHead icon="compass" level={2} id="application-h" caps={false} title="Applying what you learned" />
      <p className={sectionLead}>Your clinical cases and OSCE practice, by the skill each part exercised, and the competency each was made for. {APPLICATION_NOTE}</p>
      <div className="mt-3 space-y-3">
        {records === null ? <Unreadable what="your case and OSCE practice" />
          : records.length === 0 ? (
            <p className="rounded-xl border border-dashed border-gray-300 bg-white p-4 text-[14px] text-gray-700">No completed case or OSCE practice yet, so there is no application evidence to show.</p>
          ) : (
            <>
              <dl className="divide-y divide-gray-100 rounded-xl bg-white ring-1 ring-[var(--learn-border)]">
                {skills.map(s => (
                  <div key={s.skill} className="px-4 py-3" data-skill={s.skill} data-word={s.word}>
                    <dt className="flex flex-wrap items-center justify-between gap-2 text-[14px] font-semibold text-gray-900">
                      <span>{s.label}</span>
                      <StateChip {...EVIDENCE_WORD_LOOK[s.word]}>{EVIDENCE_WORD_LABEL[s.word]}</StateChip>
                    </dt>
                    <dd className="mt-0.5 text-[13px] leading-relaxed text-gray-700">{s.summary}{s.lastAt ? ` Latest on ${day(s.lastAt)}.` : ""}</dd>
                  </div>
                ))}
              </dl>
              <Fold summary={`${records.length} case and OSCE record${records.length === 1 ? "" : "s"}, newest first`} label="Show the records">
                <ul className="divide-y divide-gray-100">
                  {records.slice(0, SHOWN).map(r => <ApplicationRecordItem key={r.id} r={r} competencyTitle={competencyTitle} />)}
                </ul>
                {records.length > SHOWN && <p className="px-4 pb-3 text-[13px] text-gray-700">The {SHOWN} newest are shown.</p>}
              </Fold>
            </>
          )}
      </div>
    </section>
  );
}
