import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { SCHOLAR } from "@/lib/individual/experiences";
import { experienceModulePage, gatedMetadata } from "../../../../../_components/shell-context";
import { experienceHref } from "@/lib/individual/experiences";
import { analysisStatus, countDue, getMaterial, listChunks, listMappings, listQuestions, readConsent } from "@/lib/individual/scholar/store";
import { competencyLabels, loadLearnerCatalogue, type CompetencyLabel } from "@/lib/individual/scholar/competency-view";
import { AnalysePanel, SectionTopics, type CompetencyOption, type MappingView } from "../_components/competency-client";
import { citeChunk } from "@/lib/individual/scholar/extract";
import { PageHeader, StatePanel, Unreadable, focusRing, secondaryBtn } from "../../../../../_components/chrome";
import { questionView } from "../_components/question-view";
import StudyNav from "../_components/StudyNav";
import { ChunkActions, DeleteMaterial, ExplainPanel, QuestionCard } from "../_components/client";
import { aiOffMessage, consentDocuments, consentStatus } from "@/lib/individual/scholar/consent-gate";

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
        id: r.id, competencyId: r.competencyId, title: l?.title ?? "Competency", code: l?.code ?? null, layer: r.layer, catalogue: l?.catalogue ?? null,
        source: r.source, confidence: r.confidence, rationale: r.rationale, state: r.state, decidedBy: r.decidedBy, decisions: r.decisions,
      });
      mappingsByChunk.set(r.chunkId, list);
    }
    for (const list of mappingsByChunk.values()) list.sort((a, b) => (b.confidence ?? 1) - (a.confidence ?? 1));
  }
  const options: CompetencyOption[] = (learner.competencies ?? []).map(c => ({ id: c.id, title: c.title, code: c.code, layer: c.layer }));
  const status = consent.ok ? consentStatus(consent.data, consentDocuments().published) : null;
  const consentOn = status === "on";
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
        intro={`${m.mimeType === "application/pdf" ? `PDF, ${m.pageCount} page${m.pageCount === 1 ? "" : "s"}` : "Word document (cited by section, because a Word file has no fixed pages)"} · ${m.chunkCount} section${m.chunkCount === 1 ? "" : "s"} · ${m.fileName}`} />
      <StudyNav dueCount={due} />

      <div className="mb-6 flex flex-wrap items-start gap-3">
        <a href={`/api/individual/scholar/materials/${m.id}`} className={secondaryBtn}>Download original</a>
        <DeleteMaterial id={m.id} title={m.title} />
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
        <AnalysePanel materialId={m.id} consent={consentOn} sections={analysis.data.sections} analysed={analysis.data.analysed}
          programmeLabel={learner.programme?.label ?? null} />
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
                    {citeChunk(c).replace(/^./, s => s.toUpperCase())}{c.pageFrom !== null ? ` · section ${c.ordinal}` : ""}
                  </p>
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
                      options={learner.programme ? options : []} />
                  )}
                  <ChunkActions chunkId={c.id} consent={consentOn} />
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
