import { notFound } from "next/navigation";
import { experiencePage } from "../../../../../_components/shell-context";
import { EXPERIENCES, SCHOLAR } from "@/lib/individual/experiences";
import { citeChunk } from "@/lib/individual/scholar/extract";
import type { QuestionRow } from "@/lib/individual/scholar/store";
import type { QuestionView } from "./client";

/** A stored question, as the answering card shows it. The correct answer is NOT sent to the browser. */
export function questionView(q: QuestionRow): QuestionView {
  return {
    id: q.id, kind: q.kind, stem: q.stem, options: q.options, materialId: q.materialId, materialTitle: q.materialTitle,
    citation: `${q.materialTitle}, ${q.ordinal !== null ? citeChunk({ ordinal: q.ordinal, pageFrom: q.pageFrom, pageTo: q.pageTo }) : "source section"}`,
    model: q.model, promptVersion: q.promptVersion, latest: q.latest ? { correct: q.latest.correct } : null,
  };
}

// Every My Learning page calls this itself (the shell-context rule: a page never relies on its layout
// having refused). It is the foundation's experiencePage -- gate 3, the experience live, its terms
// accepted -- plus one fact from the registry: the experience must list the "study" module. Only Scholar
// does, so under /individual/professional it does not exist. Null means the experience layout is
// rendering a governed state instead, so render nothing.
export async function scholarPage(param: string) {
  const page = await experiencePage(param);
  if (!page) return null;
  if (!EXPERIENCES[page.experience].modules.some(m => m.segment === "study")) notFound();
  return { ctx: page.ctx, x: SCHOLAR };
}
