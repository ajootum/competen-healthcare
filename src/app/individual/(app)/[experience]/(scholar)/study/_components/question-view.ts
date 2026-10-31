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
    // listQuestions gives these surfaces mcq and case only (REVISION-01's kinds are Revision's).
    id: q.id, kind: q.kind === "case" ? "case" : "mcq", stem: q.stem, options: q.options, materialId: q.materialId, materialTitle: q.materialTitle,
    citation: `${q.materialTitle}, ${q.ordinal !== null ? citeChunk({ ordinal: q.ordinal, pageFrom: q.pageFrom, pageTo: q.pageTo }, q.unit) : "source section"}`,
    model: q.model, promptVersion: q.promptVersion, latest: q.latest ? { correct: q.latest.correct } : null,
  };
}

/** A My Learning URL. Plain functions here, not in client.tsx, so server pages can call them too. */
export const studyHref = (seg = "") => experienceHref("scholar", seg ? `study/${seg}` : "study");
/** EVALUATION-01: the Evaluate workspace, or one kept evaluation. Shared by server pages and client components. */
export const evaluationHref = (id?: string) => (id ? studyHref(`evaluate/${id}`) : studyHref("evaluate"));

/** An adaptive exam (its report or the runner), or the set-up page. Here, not in adaptive-client.tsx: a "use client"
 * module's exports are client references on the server, and calling one from a Server Component throws (D2, 31 Oct 2026). */
export const adaptiveHref = (sessionId?: string | null) => `${studyHref("revise/adaptive")}${sessionId ? `?session=${sessionId}` : ""}`;

/** UPLOAD-01 U5: "Your notes are ready", for the materials just uploaded. */
export const readyHref = (ids: readonly string[]) => `${studyHref("ready")}?ids=${ids.join(",")}`;

/** The link to one section of a material, which explanations, feedback and cards cite. */
export function sourceHref(materialId: string, chunkId: string) {
  return `${studyHref(materialId)}#c-${chunkId}`;
}
