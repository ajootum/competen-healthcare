import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { chunksByIds, getLearningSession, isUuid, lessonRelated, materialQualities, sectionLinks } from "@/lib/individual/scholar/store";
import { sectionHeading } from "@/lib/individual/scholar/learn";
import { citeChunk } from "@/lib/individual/scholar/extract";
import { aiReadByMaterial, aiReadMark } from "@/lib/individual/scholar/learn-ai-read";
import { displayTitle } from "@/lib/individual/scholar/learn-search";
import { competencyLines, readerSections, type ReaderInput } from "@/lib/individual/scholar/learn-reader";
import { competencyLabels, loadLearnerCatalogue } from "@/lib/individual/scholar/competency-view";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build.
export const dynamic = "force-dynamic";

// /api/individual/scholar/learn/sessions/[id]/read?step=<n> -- SCHOLAR-INDEPENDENT-LEARNING-01 P0.
//
// GET: ONE LESSON OF THE CALLER'S OWN SESSION AS THEIR OWN NOTES. The lesson's sections with their ORIGINAL text (the
// chunks Stage 1 extracted, read again by the caller's id), each cited, with its heading, its speaker notes apart, and the
// AI-read mark where the text came from a picture; the competencies linked to those sections (accepted apart from proposed,
// a link never being practice or competence); and what already exists for them (flashcards, questions, attempts, the caller's
// own cases and OSCE stations, saved explanations), to be opened directly. No AI, no allowance, no standing read, no
// learning event: reading one's own notes is never metered and is never recorded by itself (the learner's own "Mark as
// read" is, through PATCH sessions/[id] { move: "read" }). Another learner's session answers 404.

export async function GET(req: Request, ctx2: { params: Promise<{ id: string }> }) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const { id } = await ctx2.params;
  if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const stepNo = Number(new URL(req.url).searchParams.get("step"));
  if (!Number.isInteger(stepNo) || stepNo < 0 || stepNo > 10000) return NextResponse.json({ error: "Which lesson?" }, { status: 400 });
  const r = await getLearningSession(ctx.admin, ctx.userId, id);
  if (!r.ok) return NextResponse.json({ error: r.notProvisioned ? "Learning history is not available here." : "Your session could not be read just now." }, { status: r.notProvisioned ? 409 : 503 });
  if (!r.data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const step = r.data.steps.find(s => s.step === stepNo);
  if (!step) return NextResponse.json({ error: "That lesson is not in this session." }, { status: 404 });
  const chunkIds = step.sections.map(s => s.chunkId);
  const materialIds = [...new Set(step.sections.map(s => s.materialId))];
  const [chunks, qualities, links, related, learner] = await Promise.all([
    chunksByIds(ctx.admin, ctx.userId, chunkIds, true),
    materialQualities(ctx.admin, ctx.userId, materialIds),
    sectionLinks(ctx.admin, ctx.userId, chunkIds),
    lessonRelated(ctx.admin, ctx.userId, chunkIds),
    loadLearnerCatalogue(ctx.admin, ctx.userId).catch(() => null),
  ]);
  if (!chunks.ok) return NextResponse.json({ error: "Your notes could not be read just now." }, { status: 503 });
  const aiRead = aiReadByMaterial(qualities);
  const byId = new Map(chunks.data.map(c => [c.id, c]));
  const rows: ReaderInput[] = step.sections.flatMap(ref => {
    const c = byId.get(ref.chunkId);
    if (!c) return [];
    const mark = aiReadMark(aiRead.get(ref.materialId), { materialId: ref.materialId, pageFrom: c.pageFrom, pageTo: c.pageTo, unit: ref.unit });
    return [{
      chunkId: c.id, materialId: ref.materialId, materialTitle: displayTitle(ref.materialTitle), unit: ref.unit, ordinal: c.ordinal, pageFrom: c.pageFrom, pageTo: c.pageTo,
      content: c.content, heading: sectionHeading(c.content), citation: `${displayTitle(ref.materialTitle)}, ${citeChunk(c, ref.unit)}`, aiReadNote: "aiReadNote" in mark ? mark.aiReadNote : null,
    }];
  });
  const labels = await competencyLabels(ctx.admin, learner?.competencies ?? null, [...new Set(links.map(l => l.competencyId))], new Map()).catch(() => new Map());
  return NextResponse.json({
    step: stepNo,
    sections: readerSections(rows),
    missing: chunkIds.length - rows.length,
    competencies: competencyLines(links, labels),
    related,
  });
}
