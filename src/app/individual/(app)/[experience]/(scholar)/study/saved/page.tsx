import Link from "next/link";
import type { Metadata } from "next";
import { SCHOLAR, experienceHref } from "@/lib/individual/experiences";
import { experienceModulePage, gatedMetadata } from "../../../../../_components/shell-context";
import { countDue, listArtefacts, listLearningSessions, listMaterials, listQuestions, type ArtefactRow } from "@/lib/individual/scholar/store";
import { AI_LABEL, LEARN_ACTION_LABEL, SOURCE_KIND_LABEL, SUPPLEMENTARY_LABEL, type LearnAction } from "@/lib/individual/scholar/config";
import { PageHeader, StatePanel, Unreadable, focusRing } from "../../../../../_components/chrome";
import StudyNav from "../_components/StudyNav";
import { loadStudy } from "@/lib/individual/scholar/study-context";
import { sourceHref } from "../_components/question-view";
import { AiFlagList, GovernedReferenceList } from "../_components/learn-kinds";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import { loadLearnerCatalogue } from "@/lib/individual/scholar/competency-view";
import { referenceSource, relabelReferences } from "@/lib/individual/scholar/learn";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build
// (a build-time render would fail without the service key, or freeze the gate into static HTML).
export const dynamic = "force-dynamic";

// SAVED LEARNING -- COMPETEN-AI-FAIR-USE-01 s8 (the Learning Artefact Library) and s7 (Learning Continuity).
//
// Everything a student's study has produced, in one place, readable whatever their AI standing: the explanations and
// summaries the Learn actions saved (migration 415), and -- already stored by Scholar -- their practice questions and
// cases (marked by their own answer keys, no AI), their revision cards, and their learning plans (sessions, 414).
// Every AI artefact says what it is: private, formative, AI-generated from their notes, not clinically reviewed.

export async function generateMetadata(): Promise<Metadata> {
  return gatedMetadata({ title: "Saved learning" });
}

export default async function SavedPage({ params, searchParams }: { params: Promise<{ experience: string }>; searchParams: Promise<{ study?: string | string[] }> }) {
  const page = await experienceModulePage((await params).experience, "study");
  if (!page) return null;
  const { ctx } = page;
  const x = SCHOLAR;
  // SCHOLAR-SESSION-AI-02: with a valid ?study= the session bar is shown (database reads only; not a stage, so last_space is untouched).
  const study = await loadStudy(ctx.admin, ctx.userId, (await searchParams).study, null);
  const [artefacts, materials, questions, due, sessions] = await Promise.all([
    listArtefacts(ctx.admin, ctx.userId), listMaterials(ctx.admin, ctx.userId), listQuestions(ctx.admin, ctx.userId),
    countDue(ctx.admin, ctx.userId), listLearningSessions(ctx.admin, ctx.userId, 10),
  ]);
  // Stage 3 acceptance items 3 and 5: a saved answer's references are labelled by the reference source as it is now,
  // never by the label saved with them. Read only when there is something to label.
  const refSource = artefacts.ok && artefacts.data.some(a => a.refs.length)
    ? await referenceSource(ctx.admin, await loadIndividualPolicy(ctx.admin), (await loadLearnerCatalogue(ctx.admin, ctx.userId)).competencies)
    : { collections: true as const, catalogue: [] };
  const titles = new Map((materials.ok ? materials.data : []).map(m => [m.id, m.title]));
  const byMaterial = new Map<string, ArtefactRow[]>();
  for (const a of artefacts.ok ? artefacts.data : []) byMaterial.set(a.materialId, [...(byMaterial.get(a.materialId) ?? []), a]);
  const qs = questions.ok ? questions.data : [];
  const caseCount = qs.filter(q => q.kind === "case").length, practiceCount = qs.length - caseCount;

  return (
    <>
      <PageHeader accent={x.accent} eyebrow="Kept for you" title="Saved learning"
        intro="Everything your study has produced, kept for you. Opening it never uses AI, so it is always available." />
      <StudyNav dueCount={due} study={study?.bar ?? null} />

      <section aria-labelledby="kept-h" className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <h2 id="kept-h" className="sr-only">What is kept</h2>
        {[
          { label: "Practice questions", value: questions.ok ? String(practiceCount) : "Could not be read", href: experienceHref("scholar", "study"), note: "Marked by their own answer keys" },
          { label: "Cases", value: questions.ok ? String(caseCount) : "Could not be read", href: experienceHref("scholar", "study/apply"), note: "Marked by their own answer keys" },
          { label: "Revision cards due", value: due === null ? "Could not be read" : String(due), href: experienceHref("scholar", "study/revise"), note: "Scheduled from your answers" },
          { label: "Learning sessions", value: sessions.ok ? String(sessions.data.length) : "Not kept here", href: experienceHref("scholar", "study/learn"), note: "Resume where you left off" },
        ].map(t => (
          <Link key={t.label} href={t.href} className={`rounded-2xl border border-gray-200 bg-white p-4 hover:bg-gray-50 ${focusRing}`}>
            <span className="block text-[12px] font-bold uppercase tracking-[0.1em] text-gray-500">{t.label}</span>
            <span className="mt-1 block text-[20px] font-bold text-gray-900 tabular-nums">{t.value}</span>
            <span className="block text-[12px] text-gray-600">{t.note}</span>
          </Link>
        ))}
      </section>

      <section aria-labelledby="explanations-h">
        <h2 id="explanations-h" className="text-[13px] font-bold uppercase tracking-[0.14em] text-gray-500">Saved explanations and summaries</h2>
        <p className="mt-1 text-[13px] text-gray-600">{AI_LABEL}. Private to you and for your own study: never an assessment, never evidence of competence.</p>
        {!artefacts.ok ? (artefacts.notProvisioned
          ? <div className="mt-3"><StatePanel title="Saving explanations is not available here yet"><p>Explanations are still given in Learn; they are not kept here.</p></StatePanel></div>
          : <div className="mt-3"><Unreadable what="saved explanations" /></div>)
          : byMaterial.size === 0 ? <p className="mt-3 rounded-2xl border border-dashed border-gray-300 bg-white p-5 text-[14px] text-gray-600">Nothing saved yet. Explanations you get in Learn are kept here.</p>
            : (
              <div className="mt-3 space-y-4">
                {[...byMaterial.entries()].map(([materialId, list]) => (
                  <section key={materialId} aria-labelledby={`m-${materialId}`} className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
                    <h3 id={`m-${materialId}`} className="text-[15px] font-bold text-gray-900">
                      <Link href={experienceHref("scholar", `study/${materialId}`)} className={`underline-offset-2 hover:underline ${focusRing}`}>{titles.get(materialId) ?? "Your material"}</Link>
                    </h3>
                    <ul className="mt-2 space-y-2">
                      {list.map(a => (
                        <li key={a.id}>
                          <details className="rounded-xl border border-gray-200">
                            <summary className={`cursor-pointer list-none px-3 py-2 text-[13.5px] ${focusRing}`}>
                              <span className="font-semibold text-gray-900">{LEARN_ACTION_LABEL[a.action as LearnAction] ?? a.action}</span>
                              <span className="text-gray-600"> · {a.depth} · {new Date(a.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })} · {a.sources.length} section{a.sources.length === 1 ? "" : "s"}</span>
                            </summary>
                            <div className="border-t border-gray-100 px-3 py-3">
                              <p className="text-[11.5px] font-bold uppercase tracking-[0.1em] text-gray-500">{SOURCE_KIND_LABEL.notes}</p>
                              <div className="mt-1 whitespace-pre-wrap text-[14px] leading-relaxed text-gray-800">{a.content}</div>
                              <ul className="mt-2 space-y-0.5">
                                {a.sources.map((chunkId, i) => (
                                  <li key={chunkId} className="text-[12.5px]"><span className="font-mono font-bold" style={{ color: x.accent }}>[S{i + 1}]</span>{" "}
                                    <Link href={sourceHref(a.materialId, chunkId)} className={`underline underline-offset-2 ${focusRing}`}>the section in your notes</Link></li>
                                ))}
                              </ul>
                              {a.refs.length > 0 && <GovernedReferenceList refs={relabelReferences(a.refs, refSource)} />}
                              {a.background && (
                                <div className="mt-2 rounded-lg border border-sky-200 bg-sky-50/60 px-3 py-2 text-[13px] text-gray-800">
                                  <p className="text-[11.5px] font-bold uppercase tracking-[0.1em] text-sky-900">{SUPPLEMENTARY_LABEL}</p>
                                  <p className="mt-1">{a.background}</p>
                                </div>
                              )}
                              {a.flags.length > 0 && <AiFlagList flags={a.flags} />}
                              <p className="mt-2 text-[11px] text-gray-400">Private, formative · model {a.model} · prompt {a.promptVersion}</p>
                            </div>
                          </details>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            )}
      </section>
    </>
  );
}
