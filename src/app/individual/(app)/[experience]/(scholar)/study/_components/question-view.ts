// My Learning pages take their context from experienceModulePage(param, "study") in
// src/app/individual/_components/shell-context.ts (release gate, gate 3, live, D2 terms, and the registry,
// so /individual/professional/study is 404). This file only shapes data for the browser.
import { experienceHref } from "@/lib/individual/experiences";
import { citeChunk } from "@/lib/individual/scholar/extract";
import type { QuestionRow } from "@/lib/individual/scholar/store";
import type { QuestionView } from "./client";

/** A stored question, as the answering card shows it. The correct answer is NOT sent to the browser. */
export function questionView(q: QuestionRow): QuestionView {
  return {
    id: q.id, kind: q.kind, stem: q.stem, options: q.options, materialId: q.materialId, materialTitle: q.materialTitle,
    citation: `${q.materialTitle}, ${q.ordinal !== null ? citeChunk({ ordinal: q.ordinal, pageFrom: q.pageFrom, pageTo: q.pageTo }, q.unit) : "source section"}`,
    model: q.model, promptVersion: q.promptVersion, latest: q.latest ? { correct: q.latest.correct } : null,
  };
}

/** A My Learning URL. Plain functions here, not in client.tsx, so server pages can call them too. */
export const studyHref = (seg = "") => experienceHref("scholar", seg ? `study/${seg}` : "study");

/** UPLOAD-01 U5: "Your notes are ready", for the materials just uploaded. */
export const readyHref = (ids: readonly string[]) => `${studyHref("ready")}?ids=${ids.join(",")}`;

/** The link to one section of a material, which explanations, feedback and cards cite. */
export function sourceHref(materialId: string, chunkId: string) {
  return `${studyHref(materialId)}#c-${chunkId}`;
}
