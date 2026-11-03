// ── SCHOLAR-INDEPENDENT-LEARNING-01 P0: THE INDEPENDENT LESSON READER (pure, client-safe) ───────────────────────────────
//
// Owner instruction 3 Nov 2026: Scholar's core learning activities work without generative AI, and AI stays an
// enhancement. A lesson of the Learn workspace (learn.ts planSteps: a few of the learner's own sections, no AI) can be READ
// as the learner's own notes before, beside or instead of any AI teaching. This file is the pure model of that reader:
//
//   1. readerSections   the lesson's sections as they are shown: citation, heading (the section's first line, learn.ts
//                       sectionHeading), the original text, a stable anchor id (`s<ordinal>`, a 790 card id part, so the
//                       reading place inside the ORIGINAL text is saved and found on another device), and whether the text
//                       was read by AI from a picture (said every time, never folded into "your notes").
//   2. competencyLines  the competencies linked to the lesson's sections, ACCEPTED apart from merely PROPOSED. A link is a
//                       link to notes: never practice, never competence, and the words say so.
//   3. relatedWords     what already exists for these sections (flashcards, questions, attempts, cases, OSCE stations) in
//                       words, or the honest "nothing yet" with the alternatives. Existing resources are opened directly,
//                       never regenerated.
//   4. readerOpenByDefault / independentNotice   the reader opens by itself where there is nothing taught or AI is not
//                       available, and the one notice that says what works without AI (the shared ai-availability copy
//                       stays the reason).
//
// ⚠ A read mark is the learner's own statement. It is a learning record for the learner, never assessment evidence.

import type { AiReasonCopy } from "../ai-availability";

export const READ_ANCHOR = /^s\d{1,5}$/;
/** The anchor part of a 790 card id for a section of the original text: `lesson-<step>:s<ordinal>`. */
export const readAnchor = (ordinal: number) => `s${Math.max(0, Math.floor(ordinal))}`;

export type ReaderSection = {
  chunkId: string; materialId: string; materialTitle: string; unit: "page" | "slide" | "section";
  ordinal: number; pageFrom: number | null; pageTo: number | null;
  /** "Essential Nursing Care, slide 14" */
  citation: string;
  /** The section's own first line where it is a heading (learn.ts sectionHeading), else null. */
  heading: string | null;
  /** The original text, the heading line removed where it is shown apart. */
  body: string;
  /** Speaker notes (a PowerPoint), shown apart from the slide's text. */
  notes: string | null;
  /** The text was read by AI from the slide or page picture (extract.ts aiReadLabel): said with the section. */
  aiReadNote: string | null;
  anchor: string;
};

const NOTES_MARKER = /\n*Speaker notes:\n*/i;

/** Pure. One section's text as the reader shows it: the heading apart (when shown once), the slide text, the speaker notes apart. */
export function splitSectionText(content: string, heading: string | null): { body: string; notes: string | null } {
  const [main, ...rest] = content.split(NOTES_MARKER);
  const notes = rest.join("\n").trim() || null;
  let body = (main ?? "").trim();
  if (heading) {
    const first = body.split("\n").find(l => l.trim()) ?? "";
    // The heading was made from this first line (cleaned): shown once, as the heading, not again as text.
    if (first.trim().replace(/\s+/g, " ").startsWith(heading.slice(0, Math.min(heading.length, 12)))) body = body.slice(body.indexOf(first) + first.length).trim();
  }
  return { body, notes };
}

export type ReaderInput = {
  chunkId: string; materialId: string; materialTitle: string; unit: "page" | "slide" | "section"; ordinal: number; pageFrom: number | null; pageTo: number | null;
  content: string; heading: string | null; citation: string; aiReadNote: string | null;
};

/** Pure. The lesson's sections in their order, as the reader shows them. */
export function readerSections(rows: readonly ReaderInput[]): ReaderSection[] {
  return rows.slice().sort((a, b) => (a.materialId === b.materialId ? a.ordinal - b.ordinal : 0)).map(r => {
    const { body, notes } = splitSectionText(r.content, r.heading);
    return { chunkId: r.chunkId, materialId: r.materialId, materialTitle: r.materialTitle, unit: r.unit, ordinal: r.ordinal, pageFrom: r.pageFrom, pageTo: r.pageTo,
      citation: r.citation, heading: r.heading, body, notes, aiReadNote: r.aiReadNote, anchor: readAnchor(r.ordinal) };
  });
}

// ── competencies linked to the lesson's sections ──
export type ReaderCompetency = { id: string; title: string; code: string | null; accepted: boolean; sections: number };
export const LINK_NOT_COMPETENCE = "A link says this part of your notes is about the competency. It is not practice and not evidence of competence.";
export const PROPOSED_NOT_LINK = "Suggested by AI and not accepted by you: a suggestion is not a link.";

/** Pure. Accepted links first (by title), then proposed; each with how many of the lesson's sections carry it. */
export function competencyLines(links: readonly { chunkId: string; competencyId: string; accepted: boolean }[], labels: ReadonlyMap<string, { title: string; code: string | null }>): ReaderCompetency[] {
  const by = new Map<string, ReaderCompetency>();
  for (const l of links) {
    const label = labels.get(l.competencyId) ?? { title: "A competency no longer in your programme", code: null };
    const cur = by.get(l.competencyId) ?? { id: l.competencyId, title: label.title, code: label.code, accepted: false, sections: 0 };
    cur.sections++; cur.accepted = cur.accepted || l.accepted;
    by.set(l.competencyId, cur);
  }
  return [...by.values()].sort((a, b) => Number(b.accepted) - Number(a.accepted) || a.title.localeCompare(b.title));
}

// ── what already exists for these sections (P1: opened directly, never regenerated) ──
export type RelatedCounts = { cards: number; questions: number; attempts: number; cases: number; stations: number; savedLessons: number };
export const RELATED_NONE = "Nothing has been made for these sections yet.";

/** Pure. "3 flashcards · 5 questions (2 attempted) · 1 case", or null when nothing exists. */
export function relatedWords(c: RelatedCounts): string | null {
  const n = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;
  const parts = [
    c.cards ? n(c.cards, "flashcard") : null,
    c.questions ? `${n(c.questions, "question")}${c.attempts ? ` (${c.attempts} attempted)` : ""}` : null,
    c.cases ? n(c.cases, "case") : null,
    c.stations ? n(c.stations, "OSCE station") : null,
    c.savedLessons ? n(c.savedLessons, "saved explanation") : null,
  ].filter((x): x is string => !!x);
  return parts.length ? parts.join(" · ") : null;
}

/** Pure. What the learner can still do when nothing exists, without AI first. */
export function relatedAlternatives(aiAvailable: boolean): string {
  return aiAvailable
    ? "Write your own flashcard below, or ask Scholar to write questions or cards from this lesson."
    : "Write your own flashcard below. Scholar can write questions or cards from this lesson when AI help is available.";
}

// ── the reader's default state and the one notice ──
/** Pure. The original text opens by itself when nothing is taught on the page, or when AI cannot teach now. */
export const readerOpenByDefault = (o: { hasLesson: boolean; aiAvailable: boolean }) => !o.hasLesson || !o.aiAvailable;

export const WORKS_WITHOUT_AI = "Your notes, saved lessons, flashcards, questions, cases, plan and progress all work without AI.";
/** Pure. The notice above a session when new AI help is not available: what works, then the reason (the shared copy), then its next step. */
export function independentNotice(reason: AiReasonCopy | null): { text: string; next: AiReasonCopy["next"] } {
  return { text: reason ? `${WORKS_WITHOUT_AI} New AI explanations are off: ${reason.text}` : WORKS_WITHOUT_AI, next: reason?.next ?? null };
}

/** The words of a lesson's "Mark as read" control. */
export const READ_MARK = { label: "Mark as read", done: "Read", note: "Your own mark that you read this lesson. A learning record for you, not an assessment." } as const;
