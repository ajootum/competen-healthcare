import { EVIDENCE_SOURCE_WORD, LEARNING_EVIDENCE_NOTE, VERIFIED_ONLY_NOTE, type CompetencyThreeViews } from "@/lib/individual/scholar/application-evidence";
import { SELF_CLASS_LABEL } from "@/lib/assessment/adapters/scholar/vocab";
import { Unreadable } from "@/app/individual/_components/chrome";

// SALE-2026-11 R4 / SALE-14 -- THREE SEPARATE VIEWS on My Competencies (behind scholar_competency_evidence_views, default off).
// Presentational. Each view has its own heading, its own source and its own rows, and none is computed from another:
//   1. Self-assessment       what the learner believes they can do (their own submitted self-assessments)
//   2. Learning evidence     traceable activity records with framework version and mapping status; a draft is labelled and never validated
//   3. Verified competence   what an authorised verification process established (the Passport's verifications only)
// Every word comes from application-evidence.ts competencyThreeViews (pure, no AI). No stage is shown or produced here.

const day = (iso: string) => iso.slice(0, 10);
const name = (v: CompetencyThreeViews) => (v.competency.code ? `${v.competency.code} ${v.competency.title}` : v.competency.title);

function View({ id, n, title, note, children }: { id: string; n: number; title: string; note: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={`${id}-h`} className="rounded-2xl border border-gray-200 bg-white" data-view={id}>
      <header className="border-b border-gray-100 px-4 py-3">
        <h3 id={`${id}-h`} className="text-[15px] font-bold text-gray-900"><span className="mr-1.5 text-gray-500">{n}.</span>{title}</h3>
        <p className="mt-0.5 text-[12.5px] text-gray-600">{note}</p>
      </header>
      {children}
    </section>
  );
}

export function CompetencyEvidenceViews({ views, recordsUnreadable }: { views: CompetencyThreeViews[]; recordsUnreadable: boolean }) {
  const rated = views.filter(v => v.self.state === "rated");
  const withRecords = views.filter(v => v.learning.state === "records");
  const verified = views.filter(v => v.verified.state === "verified");
  const verifiedUnreadable = views.some(v => v.verified.state === "unreadable");
  return (
    <div className="space-y-4" data-testid="competency-three-views">
      <p className="text-[13px] text-gray-700">Three separate views. Each comes from its own source, and none of them changes another. Practice results never become verified competence or a competency stage.</p>

      <View id="view-self" n={1} title="Self-assessment: what you believe you can do" note={`${SELF_CLASS_LABEL}. From the self-assessments you submitted.`}>
        {rated.length === 0 ? <p className="px-4 py-3 text-[13.5px] text-gray-700">You have not rated yourself on any competency yet.</p> : (
          <ul className="divide-y divide-gray-100">
            {rated.map(v => (
              <li key={v.competency.id} className="px-4 py-3" data-competency={v.competency.id}>
                <p className="break-words text-[14px] font-semibold text-gray-900">{name(v)}</p>
                <p className="mt-0.5 text-[12.5px] text-gray-700">{v.self.line}</p>
              </li>
            ))}
          </ul>
        )}
      </View>

      <View id="view-learning" n={2} title="Learning evidence: what your learning records show" note={LEARNING_EVIDENCE_NOTE}>
        {recordsUnreadable ? <div className="px-4 py-3"><Unreadable what="your learning records" /></div>
          : withRecords.length === 0 ? <p className="px-4 py-3 text-[13.5px] text-gray-700">No learning activity is linked to a competency yet. Questions, cases and OSCE practice linked to a competency appear here.</p> : (
            <ul className="divide-y divide-gray-100">
              {withRecords.map(v => (
                <li key={v.competency.id} className="px-4 py-3" data-competency={v.competency.id}>
                  <p className="break-words text-[14px] font-semibold text-gray-900">{name(v)}</p>
                  <p className="mt-0.5 text-[12.5px] text-gray-700">{v.learning.line}</p>
                  <ul className="mt-1.5 space-y-1.5">
                    {v.learning.records.map(x => (
                      <li key={`${x.record.id}-${x.link.competencyId}`} className="rounded-xl bg-gray-50 px-3 py-2 text-[12.5px] text-gray-700" data-mapping-status={x.link.mappingStatus ?? "not_recorded"} data-source={x.record.source}>
                        <p className="break-words"><span className="font-semibold text-gray-900">{EVIDENCE_SOURCE_WORD[x.record.source]}</span> · {day(x.record.at)} · {x.outcome}</p>
                        <p className="break-words text-gray-600">{x.record.title}</p>
                        {x.link.objective && <p className="break-words">Learning objective: {x.link.objective}</p>}
                        <p className="break-words">
                          {x.draft && <span className="mr-1 inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-2 py-0 text-[11.5px] font-semibold text-amber-900">Draft mapping</span>}
                          {x.mapping}
                        </p>
                      </li>
                    ))}
                  </ul>
                  {v.learning.total > v.learning.records.length && <p className="mt-1 text-[12px] text-gray-600">The {v.learning.records.length} newest of {v.learning.total} are shown.</p>}
                </li>
              ))}
            </ul>
          )}
      </View>

      <View id="view-verified" n={3} title="Verified competence: what an authorised verification established" note={VERIFIED_ONLY_NOTE}>
        {verifiedUnreadable && verified.length === 0 ? <div className="px-4 py-3"><Unreadable what="verification" /></div>
          : verified.length === 0 ? <p className="px-4 py-3 text-[13.5px] font-semibold text-gray-900" role="status">No competency is verified yet.</p> : (
            <ul className="divide-y divide-gray-100">
              {verified.map(v => (
                <li key={v.competency.id} className="px-4 py-3">
                  <p className="break-words text-[14px] font-semibold text-gray-900">{name(v)}</p>
                  <p className="mt-0.5 text-[12.5px] text-gray-700">{v.verified.line}{v.verified.detail ? ` · ${v.verified.detail}` : ""}</p>
                </li>
              ))}
            </ul>
          )}
      </View>
    </div>
  );
}
