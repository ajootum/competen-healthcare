import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import { audit } from "@/lib/individual/scholar/http";
import { notesToMarkdown } from "@/lib/individual/scholar/personal-notebook";
import { allNotebookNotes, listMaterials, notebookOffered, notebookSchema, sessionsByIds } from "@/lib/individual/scholar/store";
import { displaySessionTitle } from "@/lib/individual/scholar/learn-search";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build.
export const dynamic = "force-dynamic";

// GET /api/individual/scholar/notebook/export -- COMPETEN-NOTEBOOK-001 P1: the learner's own notes as one Markdown file, words exactly as written.
// Their own rows only. No AI. The audit row holds a count, never a note's words.

export async function GET() {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const policy = await loadIndividualPolicy(ctx.admin);
  if (!notebookOffered(policy, await notebookSchema(ctx.admin))) return NextResponse.json({ error: "My Notebook is not offered here." }, { status: 403 });
  const r = await allNotebookNotes(ctx.admin, ctx.userId);
  if (!r.ok) return NextResponse.json({ error: "Your notes could not be read just now." }, { status: 503 });
  const [materials, sessions] = await Promise.all([listMaterials(ctx.admin, ctx.userId), sessionsByIds(ctx.admin, ctx.userId, r.data.flatMap(n => (n.sessionId ? [n.sessionId] : [])))]);
  const titles = new Map((materials.ok ? materials.data : []).map(m => [m.id, m.title]));
  const lessons = new Map(sessions.map(s => [s.id, displaySessionTitle(s.title)]));
  const now = new Date().toISOString();
  const text = notesToMarkdown(r.data.map(n => ({
    title: n.title, body: n.body, quote: n.quote, tags: n.tags, createdAt: n.createdAt, updatedAt: n.updatedAt,
    where: [n.sessionId ? lessons.get(n.sessionId) ?? null : n.materialId ? titles.get(n.materialId) ?? null : null, n.step !== null ? `lesson ${n.step + 1}` : null, n.sectionLabel].filter(Boolean).join(", ") || null,
  })), now);
  await audit(ctx, "individual_scholar_notebook_exported", "individual_scholar_note", null, { count: r.data.length });
  return new NextResponse(text, { headers: { "Content-Type": "text/markdown; charset=utf-8", "Content-Disposition": `attachment; filename="my-notebook-${now.slice(0, 10)}.md"`, "Cache-Control": "private, no-store" } });
}
