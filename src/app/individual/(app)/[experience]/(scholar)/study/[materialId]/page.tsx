import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { experienceHref } from "@/lib/individual/experiences";
import { countDue, getMaterial, listChunks, listQuestions, readConsent } from "@/lib/individual/scholar/store";
import { citeChunk } from "@/lib/individual/scholar/extract";
import { PageHeader, StatePanel, Unreadable, focusRing, secondaryBtn } from "../../../../../_components/chrome";
import { questionView, scholarPage } from "../_components/scholar-page";
import StudyNav from "../_components/StudyNav";
import { ChunkActions, DeleteMaterial, ExplainPanel, QuestionCard } from "../_components/client";

// ONE MATERIAL -- COMPETEN-IND-004 s2 (Understand) and s3 (Assess).
//
// The extracted text, section by section, each with its citation (page for a PDF, section number for a
// Word file) and an anchor that explanations and feedback link to. Per section: explain it, or write
// practice or case questions from it. Practice questions written from a section are answered under it.
// The material is read by the caller's own id: another person's material id is a 404, not a 403.

export const metadata: Metadata = { title: "Material" };

export default async function MaterialPage({ params }: { params: Promise<{ experience: string; materialId: string }> }) {
  const { experience, materialId } = await params;
  const page = await scholarPage(experience);
  if (!page) return null;
  const { ctx, x } = page;

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

  const [chunks, questions, consent, due] = await Promise.all([
    listChunks(ctx.admin, ctx.userId, m.id),
    listQuestions(ctx.admin, ctx.userId, { materialId: m.id }),
    readConsent(ctx.admin, ctx.userId),
    countDue(ctx.admin, ctx.userId),
  ]);
  const consentOn = consent.ok && consent.data.granted;
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
          AI processing of your material is off, so explaining and question writing are not available. You can turn it on in{" "}
          <Link href={experienceHref("scholar", "study")} className={`font-semibold underline ${focusRing}`}>My Learning</Link>.
        </p>
      )}

      <ExplainPanel materialId={m.id} consent={consentOn} title="Ask about this material" />

      {questions.ok && caseCount > 0 && (
        <p className="mt-4 text-[13.5px] text-gray-700">
          {caseCount} case question{caseCount === 1 ? "" : "s"} from this material {caseCount === 1 ? "is" : "are"} in{" "}
          <Link href={experienceHref("scholar", "study/apply")} className={`font-semibold underline ${focusRing}`} style={{ color: x.accent }}>Apply</Link>.
        </p>
      )}
      {!questions.ok && <div className="mt-4"><Unreadable what="questions for this material" /></div>}

      <section aria-labelledby="sections-h" className="mt-8">
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
    </>
  );
}
