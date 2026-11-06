import Link from "next/link";
import type { Metadata } from "next";
import { SCHOLAR, experienceHref } from "@/lib/individual/experiences";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import { describeNotes, relatedToNote } from "@/lib/individual/scholar/personal-notebook-data";
import { noteLinkOptions } from "@/lib/individual/scholar/personal-notebook-options";
import { getNotebookNote, notebookOffered, notebookSchema } from "@/lib/individual/scholar/personal-notebook-store";
import { listMaterials } from "@/lib/individual/scholar/store";
import { experienceModulePage, gatedMetadata } from "../../../../../../_components/shell-context";
import { PageHeader, StatePanel, Unreadable, focusRing } from "../../../../../../_components/chrome";
import { FullNote } from "../../_components/note-editor";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build.
export const dynamic = "force-dynamic";

// COMPETEN-NOTEBOOK-001 P1: one note, whole. Editing, title, tags, pin, links, related, the way back to its lesson, removal. Keyed on the caller: another
// learner's id is simply not found. Database reads only. NO AI until the learner presses Ask themselves.

export async function generateMetadata(): Promise<Metadata> {
  return gatedMetadata({ title: "My note" });
}

export default async function NotePage({ params }: { params: Promise<{ experience: string; noteId: string }> }) {
  const { experience, noteId } = await params;
  const page = await experienceModulePage(experience, "study");
  if (!page) return null;
  const { ctx } = page;
  const policy = await loadIndividualPolicy(ctx.admin);
  const back = <p className="mb-3"><Link href={experienceHref("scholar", "study/notebook")} className={`inline-flex min-h-[40px] items-center gap-1.5 text-[13.5px] font-semibold text-gray-800 underline underline-offset-2 pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`}><span aria-hidden>←</span> My Notebook</Link></p>;
  const header = <>{back}<PageHeader accent={SCHOLAR.accent} eyebrow="Private to you" title="My note" /></>;
  if (!notebookOffered(policy, await notebookSchema(ctx.admin))) return <>{header}<StatePanel title="My Notebook is not available here yet"><p>Your notes and highlights are still in your learning library.</p></StatePanel></>;
  const r = await getNotebookNote(ctx.admin, ctx.userId, noteId);
  if (!r.ok) return <>{header}<Unreadable what="this note" /></>;
  if (!r.data) return <>{header}<StatePanel title="That note could not be found"><p>It may have been removed.</p></StatePanel></>;
  const materialsR = await listMaterials(ctx.admin, ctx.userId);
  const materials = (materialsR.ok ? materialsR.data : []).map(m => ({ id: m.id, title: m.title, mime: m.mimeType }));
  const [where, related, options] = await Promise.all([describeNotes(ctx.admin, ctx.userId, [r.data], materials), relatedToNote(ctx.admin, ctx.userId, r.data, materials), noteLinkOptions(ctx.admin, ctx.userId)]);
  return <>{header}<FullNote userId={ctx.userId} note={r.data} where={where.get(r.data.id)!} options={options} related={related} /></>;
}
