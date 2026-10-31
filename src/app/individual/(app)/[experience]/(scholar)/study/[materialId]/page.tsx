import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { SCHOLAR } from "@/lib/individual/experiences";
import { experienceModulePage, gatedMetadata } from "../../../../../_components/shell-context";
import { experienceHref } from "@/lib/individual/experiences";
import { FORMAT_LABEL, FORMAT_OF, NO_APPROVED_COMPETENCIES, PPTX_MIME, UNIT_OF } from "@/lib/individual/scholar/config";
import { analysedProgrammes, analysisStatus, countDue, getMaterial, listChunks, listCollections, listMappings, listProgrammes, listQuestions, materialExtras, readConsent } from "@/lib/individual/scholar/store";
import { contextHistory, contextStamp } from "@/lib/individual/scholar/context";
import { competencyAbsence, competencyLabels, loadLearnerCatalogue, type CompetencyLabel } from "@/lib/individual/scholar/competency-view";
import { AnalysePanel, PictureSlides, SectionTopics, type CompetencyOption, type MappingView } from "../_components/competency-client";
import { OrganiseMaterial } from "../_components/library-client";
import { aiReadSlides, citeChunk, qualitySummary } from "@/lib/individual/scholar/extract";
import { MAX_AI_SLIDES_PER_MATERIAL, planPictureSlides } from "@/lib/individual/scholar/slide-images";
import { PageHeader, StatePanel, Unreadable, focusRing, secondaryBtn } from "../../../../../_components/chrome";
import { questionView } from "../_components/question-view";
import StudyNav from "../_components/StudyNav";
import { ChunkActions, DeleteMaterial, ExplainPanel, QuestionCard } from "../_components/client";
import { aiOffMessage, consentDocuments, consentStatus } from "@/lib/individual/scholar/consent-gate";
import { getExamPaper } from "@/lib/individual/scholar/exam-store";
import { EXAM_ATTESTATION, LIVE_EXAM_NOTICE } from "@/lib/individual/scholar/exam-service";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import { StudyAsPaper } from "../_components/paper-client";
import { FoundInMaterial } from "../_components/classify-client";
import { competenciesFound, relinkTargets, topicsOf } from "@/lib/individual/scholar/classify-view";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build
// (a build-time render would fail without the service key, or freeze the gate into static HTML).
export const dynamic = "force-dynamic";

// ONE MATERIAL -- COMPETEN-IND-004 s2 (Understand) and s3 (Assess).
//
// The extracted text, section by section, each with its citation (page for a PDF, section number for a
// Word file) and an anchor that explanations and feedback link to. Per section: explain it, or write
// practice or case questions from it. Practice questions written from a section are answered under it.
// The material is read by the caller's own id: another person's material id is a 404, not a 403.

// The title only when Individual is live: with the release gate off, a 404 must not name the route.
export async function generateMetadata(): Promise<Metadata> {
  return gatedMetadata({ title: "Material" });
}

export default async function MaterialPage({ params }: { params: Promise<{ experience: string; materialId: string }> }) {
  const { experience, materialId } = await params;
  const page = await experienceModulePage(experience, "study");
  if (!page) return null;
  const { ctx } = page;
  const x = SCHOLAR;

  const material = await getMaterial(ctx.admin, ctx.userId, materialId);
  if (!material.ok) {
    return (
      <>
        <PageHeader accent={x.accent} eyebrow="My Learning" title="Material" />
        <StatePanel title="This material could not be read just now"><p>This is not the same as it being gone. Try again shortly.</p></StatePanel>
      </>
    );
  }
  if (!material.data) notFound();
  const m = material.data;

  const [stampHistory, stampProgrammes] = await Promise.all([contextHistory(ctx.admin, ctx.userId), listProgrammes(ctx.admin)]);
  // Stage 2: the educational context this material was uploaded in (402 history by its created_at).
  const stamp = stampHistory.ok
    ? contextStamp(stampHistory.periods, m.createdAt, new Map((stampProgrammes.ok ? stampProgrammes.data : []).map(p => [p.code, p.label])))
    : null;
  const [extras, collections] = await Promise.all([materialExtras(ctx.admin, ctx.userId, [m.id]), listCollections(ctx.admin, ctx.userId)]);
  const unit = UNIT_OF(m.mimeType);
  const quality = extras.qualityOn ? qualitySummary(extras.byId.get(m.id)?.quality ?? null) : null;
  const [chunks, questions, consent, due, analysis, mapped, learner] = await Promise.all([
    listChunks(ctx.admin, ctx.userId, m.id),
    listQuestions(ctx.admin, ctx.userId, { materialId: m.id }),
    readConsent(ctx.admin, ctx.userId),
    countDue(ctx.admin, ctx.userId),
    analysisStatus(ctx.admin, ctx.userId, m.id),
    listMappings(ctx.admin, ctx.userId, m.id),
    loadLearnerCatalogue(ctx.admin, ctx.userId),
  ]);
  // COMPETEN-SCHOLAR-01 S2. Absent where 387/388 are not applied (fail closed): the page is the MVP page.
  const competenciesOn = analysis.ok && mapped.ok && learner.provisioned;
  const labels = mapped.ok
    ? await competencyLabels(ctx.admin, learner.competencies, mapped.data.mappings.map(r => r.competencyId), new Map(mapped.data.mappings.map(r => [r.competencyId, r.layer])))
    : new Map<string, CompetencyLabel>();
  const mappingsByChunk = new Map<string, MappingView[]>();
  if (mapped.ok) {
    for (const r of mapped.data.mappings) {
      const l = labels.get(r.competencyId);
      const list = mappingsByChunk.get(r.chunkId) ?? [];
      list.push({
        id: r.id, competencyId: r.competencyId, title: l?.title ?? "Competency", code: l?.code ?? null, layer: r.layer, catalogue: l?.catalogue ?? null, structure: l?.structure ?? null, contentStatus: l?.contentStatus ?? null,
        source: r.source, confidence: r.confidence, rationale: r.rationale, state: r.state, decidedBy: r.decidedBy, decisions: r.decisions,
        outcome: r.outcome, catalogueVersion: r.catalogueVersion,
      });
      mappingsByChunk.set(r.chunkId, list);
    }
    for (const list of mappingsByChunk.values()) list.sort((a, b) => (b.confidence ?? 1) - (a.confidence ?? 1));
  }
  const options: CompetencyOption[] = (learner.competencies ?? []).map(c => ({ id: c.id, title: c.title, code: c.code, layer: c.layer, outcomes: c.outcomes.slice(0, 6) }));
  // R1 (Stage 1 close-out, fixed in UPLOAD-01): no programme, or a programme with no usable catalogue, is SAID.
  // P6: with no programme offered at all (production today) the student is not told to choose one.
  const absence = competencyAbsence(learner, stampProgrammes.ok ? stampProgrammes.data.length : null);
  // P6 Option A: what Classify found, summarised on the material itself (no separate Classify screen).
  const chunkOrder = chunks.ok ? chunks.data.map(ch => ch.id) : [];
  const foundTopics = mapped.ok ? topicsOf(mapped.data.concepts, chunkOrder).map(t => ({ name: t.name, sections: t.chunkIds.length, firstChunkId: t.chunkIds[0] })) : [];
  const foundCompetencies = competenciesFound([...mappingsByChunk.entries()].flatMap(([chunkId, list]) => list.map(v => ({ ...v, chunkId }))))
    .map(f => ({ ...f, sections: f.chunkIds.length, firstChunkId: f.chunkIds.sort((a, b) => chunkOrder.indexOf(a) - chunkOrder.indexOf(b))[0] }));
  const status = consent.ok ? consentStatus(consent.data, consentDocuments().published) : null;
  const consentOn = status === "on";
  // SCHOLAR-UPLOAD-FIX: sections analysed against no programme (or another one) while the learner now has one with a
  // usable catalogue -- offered for re-linking. Unreadable: nothing is offered.
  const relinkCodes = learner.programme && learner.competencies?.length ? await analysedProgrammes(ctx.admin, ctx.userId, m.id) : null;
  const relinkable = relinkCodes?.ok && learner.programme ? relinkTargets(chunkOrder, relinkCodes.data, learner.programme.code).length : 0;
  const [paper, policy] = await Promise.all([getExamPaper(ctx.admin, ctx.userId, m.id), loadIndividualPolicy(ctx.admin)]);
  const paperOn = policy.scholarExams.enabled && paper.ok;
  // SCHOLAR-UPLOAD-FIX: picture-only slides -- offered for an AI reading where policy allows it (slide-reading.ts), and
  // every section such a reading added is labelled. Labelled from the stored quality record, whatever the policy is now.
  const rawQuality = extras.qualityOn ? extras.byId.get(m.id)?.quality ?? null : null;
  const aiRead = aiReadSlides(rawQuality);
  const pictures = policy.scholarMaterialImageSlides === "ai_transcription" && m.mimeType === PPTX_MIME && rawQuality?.unit === "slide" && chunks.ok
    ? planPictureSlides({ emptyUnits: rawQuality.emptyUnits, triedUnits: rawQuality.aiTriedUnits, slidesWithSections: chunks.data.map(c => c.pageFrom ?? 0), cap: MAX_AI_SLIDES_PER_MATERIAL })
    : null;
  const offMessage = status ? aiOffMessage(status) : "Your AI help setting could not be read just now, so explanations and practice questions are not available. Try again shortly.";
  const byChunk = new Map<string, ReturnType<typeof questionView>[]>();
  let caseCount = 0;
  if (questions.ok) {
    for (const q of [...questions.data].reverse()) {
      if (q.kind === "case") { caseCount++; continue; }
      const list = byChunk.get(q.chunkId) ?? [];
      list.push(questionView(q));
      byChunk.set(q.chunkId, list);
    }
  }

  return (
    <>
      <p className="mb-2 text-[13px]"><Link href={experienceHref("scholar", "study")} className={`font-semibold underline-offset-2 hover:underline ${focusRing}`} style={{ color: x.accent }}>← My Learning</Link></p>
      <PageHeader accent={x.accent} eyebrow="Your material" title={m.title}
        intro={`${unit === "section" ? (m.mimeType === "text/plain" ? "Text (cited by section)" : "Word document (cited by section, because a Word file has no fixed pages)") : `${FORMAT_LABEL[FORMAT_OF[m.mimeType]]}, ${m.pageCount} ${unit}${m.pageCount === 1 ? "" : "s"}`} · ${m.chunkCount} section${m.chunkCount === 1 ? "" : "s"} · ${m.fileName}${stamp ? ` · uploaded while studying ${stamp}` : ""}`} />
      <StudyNav dueCount={due} />
      {quality && (
        <p className={`mb-4 rounded-xl px-4 py-2.5 text-[13.5px] ${quality.partial ? "border border-amber-300 bg-amber-50 text-amber-950" : "border border-gray-200 bg-white text-gray-700"}`}>{quality.text}</p>
      )}
      {pictures && (
        <PictureSlides materialId={m.id} slides={pictures.slides.length} beyondCap={pictures.beyondCap} consent={consentOn} />
      )}

      <div className="mb-6 flex flex-wrap items-start gap-3">
        <Link href={experienceHref("scholar", `study/learn?material=${m.id}`)} className={secondaryBtn}>Teach me this material</Link>
        <a href={`/api/individual/scholar/materials/${m.id}`} className={secondaryBtn}>Download original</a>
        <DeleteMaterial id={m.id} title={m.title} />
      </div>
      {/* COMPETEN-SCHOLAR-EXAM-PAPERS-01: a past or practice paper is studied question by question in Apply. Absent
          where 570 is not applied, or where policy does not offer it. */}
      {paperOn && (
        <section aria-labelledby="paper-h" className="mb-6 rounded-2xl border border-gray-200 bg-white p-4">
          <h2 id="paper-h" className="text-[15px] font-bold text-gray-900">Examination paper</h2>
          {paper.ok && paper.data ? (
            <p className="mt-1 text-[14px] text-gray-700">You are studying this as an examination paper ({paper.data.questionCount} question{paper.data.questionCount === 1 ? "" : "s"} found).{" "}
              <Link href={experienceHref("scholar", `study/apply/papers/${m.id}`)} className={`font-semibold underline underline-offset-2 ${focusRing}`} style={{ color: x.accent }}>Open the paper →</Link></p>
          ) : (
            <>
              <p className="mt-1 text-[14px] text-gray-600">Is this a past or practice paper? Study it question by question: attempt each one, then reveal a suggested answer with its evidence. {LIVE_EXAM_NOTICE}</p>
              <div className="mt-3"><StudyAsPaper materialId={m.id} attestation={EXAM_ATTESTATION.text}
                transcribable={policy.scholarExams.scannedPages === "ai_transcription" && m.mimeType === "application/pdf" && !!quality?.partial} /></div>
            </>
          )}
        </section>
      )}
      <div className="mb-6 rounded-2xl border border-gray-200 bg-white p-4">
        <OrganiseMaterial id={m.id} title={m.title} collectionId={extras.byId.get(m.id)?.collectionId ?? null}
          collections={extras.collectionsOn && collections.ok ? collections.data.map(c => ({ id: c.id, name: c.name })) : null} />
      </div>

      {!consentOn && (
        <p className="mb-6 rounded-xl border border-gray-200 bg-white px-4 py-3 text-[13.5px] text-gray-700">
          {offMessage}{" "}
          <Link href={experienceHref("scholar", "study")} className={`font-semibold underline ${focusRing}`}>Go to My Learning</Link>.
        </p>
      )}

      {/* Owner review P1.6: on a wide screen the sections read on the left while the question box stays in
          view on the right. One column below lg, in the same order. */}
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start lg:gap-6">
      <div className="lg:order-2 lg:sticky lg:top-20">
        <ExplainPanel materialId={m.id} consent={consentOn} offMessage={offMessage ?? undefined} title="Ask about this material" />
      </div>
      <div className="lg:order-1">

      {competenciesOn && analysis.ok && (
        <FoundInMaterial topics={foundTopics} competencies={foundCompetencies} analysed={analysis.data.analysed} sections={analysis.data.sections}
          absence={absence} consent={consentOn} />
      )}
      {competenciesOn && analysis.ok && (
        <AnalysePanel materialId={m.id} consent={consentOn} sections={analysis.data.sections} analysed={analysis.data.analysed}
          programmeLabel={learner.programme?.label ?? null} absence={absence} relinkable={relinkable} />
      )}
      {/* Owner ruling 2026-10-24: content held back by the status floor is SAID, never silently missing. */}
      {competenciesOn && learner.programme && learner.belowFloor > 0 && (
        <p className="mb-6 rounded-xl border border-gray-200 bg-white px-4 py-3 text-[13.5px] text-gray-700">
          {learner.competencies?.length ? "" : `${NO_APPROVED_COMPETENCIES} `}{learner.belowFloor} competenc{learner.belowFloor === 1 ? "y" : "ies"} in your programme {learner.belowFloor === 1 ? "is" : "are"} not offered here because only {learner.minStatus === "approved" ? "clinically approved" : "reviewed"} content is used for suggestions.
        </p>
      )}
      {competenciesOn && learner.programme && learner.competencies === null && (
        <p className="mb-6 rounded-xl border border-gray-200 bg-white px-4 py-3 text-[13.5px] text-gray-700">The competencies of your programme could not be read just now, so suggested links are shown without their full names. Try again shortly.</p>
      )}

      {questions.ok && caseCount > 0 && (
        <p className="mt-4 mb-4 text-[13.5px] text-gray-700">
          {caseCount} case question{caseCount === 1 ? "" : "s"} from this material {caseCount === 1 ? "is" : "are"} in{" "}
          <Link href={experienceHref("scholar", "study/apply")} className={`font-semibold underline ${focusRing}`} style={{ color: x.accent }}>Apply</Link>.
        </p>
      )}
      {!questions.ok && <div className="mt-4"><Unreadable what="questions for this material" /></div>}

      <section aria-labelledby="sections-h" className="mt-8 lg:mt-0">
        <h2 id="sections-h" className="text-[13px] font-bold uppercase tracking-[0.14em] text-gray-500">Sections</h2>
        {!chunks.ok ? <div className="mt-3"><Unreadable what="material text" /></div> : (
          <ol className="mt-3 space-y-4">
            {chunks.data.map(c => {
              const qs = byChunk.get(c.id) ?? [];
              return (
                <li key={c.id} id={`c-${c.id}`} className="scroll-mt-20 rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
                  <p className="text-[12px] font-bold uppercase tracking-[0.12em]" style={{ color: x.accent }}>
                    {citeChunk(c, unit).replace(/^./, s => s.toUpperCase())}{c.pageFrom !== null ? ` · section ${c.ordinal}` : ""}
                  </p>
                  {c.pageFrom !== null && aiRead.has(c.pageFrom) && (
                    <p className="mt-1 inline-flex rounded-md border border-amber-300 bg-amber-50 px-2 py-0.5 text-[12.5px] font-semibold text-amber-950">
                      Read by AI from a picture on slide {c.pageFrom} — check it against the slide
                    </p>
                  )}
                  <details className="mt-1 group">
                    <summary className={`cursor-pointer list-none text-[14px] leading-relaxed text-gray-800 ${focusRing}`}>
                      <span className="group-open:hidden">{c.content.length > 280 ? `${c.content.slice(0, 280).trim()}…` : c.content}</span>
                      <span className="hidden group-open:inline text-[12.5px] font-semibold text-gray-500">Hide full text</span>
                      {c.content.length > 280 && <span className="ml-1 text-[12.5px] font-semibold group-open:hidden" style={{ color: x.accent }}>Read all</span>}
                    </summary>
                    <p className="mt-2 whitespace-pre-wrap text-[14px] leading-relaxed text-gray-800">{c.content}</p>
                  </details>
                  {competenciesOn && mapped.ok && (mapped.data.concepts.has(c.id) || mappingsByChunk.has(c.id)) && (
                    <SectionTopics chunkId={c.id} concepts={mapped.data.concepts.get(c.id) ?? []} mappings={mappingsByChunk.get(c.id) ?? []}
                      options={learner.programme ? options : []} corrected={mapped.data.corrected.has(c.id)} correction={mapped.data.correctionsOn} />
                  )}
                  <ChunkActions chunkId={c.id} consent={consentOn}
                    linked={(mappingsByChunk.get(c.id) ?? []).filter(x => x.state === "accepted").map(x => ({ title: x.title, contentStatus: x.contentStatus ?? null }))} />
                  {qs.length > 0 && (
                    <div className="mt-4 space-y-3">
                      <p className="text-[13px] font-bold text-gray-700">Practice questions from this section</p>
                      {qs.map((q, i) => <QuestionCard key={q.id} q={q} index={i + 1} chunkId={c.id} />)}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </section>
      </div>
      </div>
    </>
  );
}
