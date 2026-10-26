import Link from "next/link";
import type { Metadata } from "next";
import { SCHOLAR } from "@/lib/individual/experiences";
import { experienceModulePage, gatedMetadata } from "../../../../../_components/shell-context";
import { experienceHref } from "@/lib/individual/experiences";
import { countDue, listQuestions, type QuestionRow } from "@/lib/individual/scholar/store";
import { PageHeader, StatePanel, Unreadable, focusRing, BoundaryNotice } from "../../../../../_components/chrome";
import { questionView } from "../_components/question-view";
import StudyNav from "../_components/StudyNav";
import { ExamPapersSection } from "../_components/papers-section";
import { FORMATIVE_NOTICE, scholarSpace } from "@/lib/individual/scholar/spaces";
import { QuestionCard } from "../_components/client";
import { CasePlayer } from "../_components/competency-client";
import { competencyLabels, loadLearnerCatalogue, type CompetencyLabel } from "@/lib/individual/scholar/competency-view";
import { caseHistory, listMaterials, listPrivateCases, readConsent } from "@/lib/individual/scholar/store";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import { ATTESTATION_TEXT, caseLibraryEnabled, loadCasePolicy } from "@/lib/cases/policy";
import { candidacyStatus, myCaseOffers } from "@/lib/cases/candidates";
import { caseSessionView } from "@/lib/cases/library";
import { consentDocuments, consentStatus } from "@/lib/individual/scholar/consent-gate";
import { activityState, getScholarAiStanding } from "@/lib/individual/scholar/ai-standing";
import { CaseOfferPanel, CaseStart, ReplayCase } from "../_components/case-client";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build
// (a build-time render would fail without the service key, or freeze the gate into static HTML).
export const dynamic = "force-dynamic";

// APPLY -- COMPETEN-IND-004 s5. Case-style questions written from the person's OWN material, answered
// with feedback that cites the source. Written from a section on a material page ("Case question").
//
// ⚠ SHARED CLINICAL CONTENT IS NOT SERVED, AND THE PAGE SAYS WHY. clinical_cases (migration 026) has a
// status and a source reference but no clinical-review record -- no reviewer, no date, no scope
// (COMPETEN-IND-002 s3.3). Scholar serves shared content only once that record exists. So this page
// reads nothing from clinical_cases, and shows the governed state below in its place.

// The title only when Individual is live: with the release gate off, a 404 must not name the route.
export async function generateMetadata(): Promise<Metadata> {
  return gatedMetadata({ title: "Apply" });
}

export default async function Apply({ params, searchParams }: { params: Promise<{ experience: string }>; searchParams: Promise<{ section?: string; from?: string }> }) {
  const page = await experienceModulePage((await params).experience, "study");
  if (!page) return null;
  const { ctx } = page;
  const x = SCHOLAR;
  const sp = await searchParams;
  const [questions, due] = await Promise.all([listQuestions(ctx.admin, ctx.userId, { kind: "case" }), countDue(ctx.admin, ctx.userId)]);
  // ── CLINICAL REASONING (CLINICAL-REASONING-01): starting a case, the student's own cases, history, and the library ──
  const [policy, materials, learner, privateCases, history, libraryOn, consent] = await Promise.all([
    loadIndividualPolicy(ctx.admin), listMaterials(ctx.admin, ctx.userId), loadLearnerCatalogue(ctx.admin, ctx.userId),
    listPrivateCases(ctx.admin, ctx.userId), caseHistory(ctx.admin, ctx.userId, 10), caseLibraryEnabled(ctx.admin), readConsent(ctx.admin, ctx.userId),
  ]);
  const consentOn = consent.ok && consentStatus(consent.data, consentDocuments().published) === "on";
  const standing = activityState(await getScholarAiStanding(ctx.admin, ctx.userId), "case_steps");
  // Where the case library is OFF nothing here names it: the student's own stored cases are what stays playable.
  const stored = libraryOn ? "Your stored cases and library cases are still playable." : "Your stored cases are still playable.";
  const aiNote = policy.scholarCaseGeneration === "stored_only" ? `New cases are not written here: play your stored cases${libraryOn ? " or a library case" : ""}.`
    : !consentOn ? `AI help is off, so new cases are not written. ${stored}`
      : !standing.available ? `${standing.message ?? "New AI help is limited right now."} ${stored}` : null;
  const [candidacy, offers, casePolicy] = libraryOn ? await Promise.all([candidacyStatus(ctx.admin, ctx.userId), myCaseOffers(ctx.admin, ctx.userId), loadCasePolicy(ctx.admin)]) : [null, null, null];
  // A library play's title from the student's own learner-facing view (library.ts caseSessionView), never the blueprint.
  const libTitles = new Map<string, string>();
  for (const h of history.ok ? history.data.filter(r => r.kind === "library") : []) {
    const v = await caseSessionView(ctx.admin, ctx.userId, h.id);
    if (v) libTitles.set(h.id, v.view.title);
  }
  const preset = sp.section && /^[0-9a-f-]{36}$/i.test(sp.section) ? { chunkId: sp.section, from: sp.from === "revision" ? "revision" as const : "teach" as const } : null;

  // COMPETEN-SCHOLAR-01 S4: steps of one case play together, in order. Where 388 is absent no question has
  // a case_id, and the page is the MVP page.
  const cases = new Map<string, QuestionRow[]>();
  const singles: QuestionRow[] = [];
  if (questions.ok) {
    for (const q of questions.data) {
      if (q.caseId) cases.set(q.caseId, [...(cases.get(q.caseId) ?? []), q]);
      else singles.push(q);
    }
  }
  const caseList = [...cases.values()].map(steps => steps.sort((a, b) => (a.caseStep ?? 0) - (b.caseStep ?? 0)));
  const competencyIds = caseList.map(s => s[0].competencyId).filter((x): x is string => !!x);
  const labels = competencyIds.length
    ? await competencyLabels(ctx.admin, (await loadLearnerCatalogue(ctx.admin, ctx.userId)).competencies, competencyIds, new Map())
    : new Map<string, CompetencyLabel>();

  return (
    <>
      <PageHeader accent={x.accent} eyebrow={scholarSpace("apply").eyebrow} title="Apply" intro={scholarSpace("apply").intro} />
      <StudyNav dueCount={due} />
      <BoundaryNotice notice={FORMATIVE_NOTICE} detail="Practice cases are formative simulation, not assessment." />
      <ExamPapersSection admin={ctx.admin} userId={ctx.userId} variant="apply" />

      <div className="mb-8 grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-5">
          <CaseStart entries={policy.scholarCaseEntries} contexts={policy.scholarCaseContexts} mode={policy.scholarCaseMode} libraryOn={libraryOn}
            materials={(materials.ok ? materials.data : []).filter(m => m.chunkCount > 0).map(m => ({ id: m.id, title: m.title }))}
            competencies={(learner.competencies ?? []).map(c => ({ id: c.id, title: c.title }))} aiNote={aiNote} preset={preset} />
          {libraryOn && candidacy && casePolicy && (
            <CaseOfferPanel libraryOn={libraryOn} granted={candidacy.granted && candidacy.current} attestationVersion={casePolicy.attestationVersion}
              text={ATTESTATION_TEXT[casePolicy.attestationVersion] ?? null} cases={privateCases.ok ? privateCases.data.map(c => ({ id: c.id, title: c.title })) : []}
              offers={(offers ?? []).map(o => ({ sourceKey: o.sourceKey, status: o.status, reasons: o.reasons }))} />
          )}
        </div>
        <aside aria-labelledby="case-history-h" className="space-y-4">
          <section className="rounded-2xl border border-gray-200 bg-white p-4">
            <h2 id="case-history-h" className="text-[14px] font-bold text-gray-900">Your cases</h2>
            <p className="text-[12px] text-gray-600">Formative simulation: never an assessment, never evidence of competence. Stored cases replay with no AI.</p>
            {!history.ok ? <p className="mt-2 text-[13px] text-gray-600">Clinical reasoning history is not available here yet.</p>
              : history.data.length === 0 ? <p className="mt-2 text-[13px] text-gray-600">None yet.</p> : (
                <ul className="mt-2 space-y-1.5">{history.data.map(h => (
                  <li key={`${h.kind}${h.id}`} className="text-[13.5px]">
                    <Link href={`${experienceHref("scholar", "study/apply/case")}?kind=${h.kind}&session=${h.id}`} className={`font-semibold underline underline-offset-2 ${focusRing}`}>{h.title ?? libTitles.get(h.id) ?? "Library case"}</Link>
                    <span className="text-[12px] text-gray-500"> · {h.kind === "library" ? "library" : "your case"} · {h.status === "completed" ? "finished" : "in progress"}</span>
                  </li>
                ))}</ul>
              )}
            {privateCases.ok && privateCases.data.length > 0 && (
              <>
                <h3 className="mt-3 text-[13px] font-bold text-gray-800">Play one of your stored cases again</h3>
                <ul className="mt-1 space-y-1">{privateCases.data.slice(0, 8).map(c => <li key={c.id}><ReplayCase caseId={c.id} title={c.title} /></li>)}</ul>
              </>
            )}
          </section>
        </aside>
      </div>

      <section aria-labelledby="own-cases-h">
        <h2 id="own-cases-h" className="text-[13px] font-bold uppercase tracking-[0.14em] text-gray-500">Your practice scenarios</h2>
        <p className="mt-1 text-[13px] text-gray-600">Written by AI from your own notes. They are practice, not clinically reviewed cases, and each one says so.</p>
        <div className="mt-3">
          {!questions.ok ? (questions.notProvisioned
            ? <StatePanel title="Case practice is not set up here yet"><p>The study store it needs has not been installed here.</p></StatePanel>
            : <Unreadable what="case questions" />)
            : questions.data.length === 0 ? (
              <StatePanel title="No case questions yet">
                <p>Open one of your materials and choose <span className="font-semibold">Step-by-step case</span> or <span className="font-semibold">Case question</span> on a section that describes a condition, an assessment or its management.</p>
                <p><Link href={experienceHref("scholar", "study")} className={`font-semibold underline ${focusRing}`} style={{ color: x.accent }}>Go to your materials</Link></p>
              </StatePanel>
            ) : (
              <div className="space-y-4">
                {caseList.map(steps => {
                  const l = steps[0].competencyId ? labels.get(steps[0].competencyId) : undefined;
                  return (
                    <CasePlayer key={steps[0].caseId} title={steps[0].caseTitle ?? "Practice case"}
                      competency={l ? { title: `${l.code ? `${l.code} ` : ""}${l.title}`, layer: l.layer, contentStatus: l.contentStatus ?? null } : null}
                      steps={steps.map(q => ({ q: questionView(q), chunkId: q.chunkId, answered: q.latest !== null }))} />
                  );
                })}
                {singles.map((q, i) => <QuestionCard key={q.id} q={questionView(q)} index={i + 1} chunkId={q.chunkId} />)}
              </div>
            )}
        </div>
      </section>

      <section aria-labelledby="shared-h" className="mt-10">
        <h2 id="shared-h" className="text-[13px] font-bold uppercase tracking-[0.14em] text-gray-500">Clinically approved cases</h2>
        <div className="mt-3 rounded-2xl border border-gray-200 bg-white p-5 sm:p-6">
          {libraryOn ? (
            <p className="text-[14px] leading-relaxed text-gray-700">
              The case library holds cases an independent clinical reviewer approved, each for its exact version. Choose <span className="font-semibold">Choose an existing case</span> above to play one: it uses no AI.
              Cases written from your notes are practice, not clinically reviewed, and each one says so.
            </p>
          ) : (
            <>
              <p className="text-[15px] font-semibold text-gray-900">Not available yet</p>
              <p className="mt-1 text-[14px] leading-relaxed text-gray-700">The case library is not switched on yet. Your own cases are practice, not clinically reviewed, and are labelled as such.</p>
            </>
          )}
        </div>
      </section>
    </>
  );
}
