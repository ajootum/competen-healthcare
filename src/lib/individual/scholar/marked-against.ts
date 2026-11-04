// ── SCHOLAR-CE-2026 CE-05: THE "MARKED AGAINST" LINE ── one short provenance line on every format's result ────────────────
//
// What an answer was marked against, in one sentence, for every format: its answer key, its key points, its parts or stages, the Competen
// library answer, or the learner's own self-check. It reads only what is really known:
//   - the marking (code, the learner's own judgement, or AI evaluation) -- what MARKING_LABEL already says, never contradicted;
//   - the question's format (the registry);
//   - the rubric snapshot kept on the attempt (rubric-snapshot.ts) and the attempt snapshot (791), for the guide's short fingerprint
//     and the key points / parts / stages it held. Where the attempt kept neither, the line says only what is certain: "Marked by its
//     answer key." It never invents a version, a count or a guide.
//
// Pure: no I/O, no clock, no model.

import type { Marking } from "./config";
import { FORMAT_ROW, type QuestionFormat } from "./question-formats";

export type MarkedAgainstInput = {
  /** The format the learner saw (revision.ts effectiveKind): mcq, case, mrq, short, cloze, true_false, extended, flashcard, match, sequence, structured, scenario. */
  format: string;
  marking: Marking;
  /** A governed Competen library question: its version number. */
  libraryVersion?: number | null;
  /** The guide's fingerprint as kept on the attempt (rubric snapshot hash, else the 791 snapshot's), or null when the attempt kept none. */
  guide?: string | null;
  /** How many key points the guide held (the snapshot's, or the question's at the time), or 0. */
  keyPoints?: number;
  /** structured: how many parts. scenario: the stage weights in order. */
  parts?: number;
  weights?: readonly number[];
};

const short = (h: string | null | undefined) => (h ? h.slice(0, 8) : null);
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/**
 * Pure. The line. Honest by construction: a count or a guide fingerprint appears only when the attempt kept it; otherwise the line is
 * the plain statement ("Marked by its answer key.") and nothing more.
 */
export function markedAgainstLine(i: MarkedAgainstInput): string {
  const guide = short(i.guide);
  const tail = guide ? ` (the guide as saved when you answered, ${guide})` : "";
  if (i.libraryVersion) {
    const base = i.marking === "ai_evaluation" ? `Judged by AI against the Competen library answer and its rubric, version ${i.libraryVersion}`
      : i.marking === "self_graded" ? `Marked by you against the Competen library answer, version ${i.libraryVersion}`
        : `Marked by code against the Competen library answer, version ${i.libraryVersion}`;
    return `${base}.`;
  }
  const f = (i.format in FORMAT_ROW ? i.format : "mcq") as QuestionFormat;
  switch (f) {
    case "flashcard": return "Your own self-check: you graded your recall against the back of the card.";
    case "extended": {
      const kp = i.keyPoints ? plural(i.keyPoints, "key point") : "its key points";
      if (i.marking === "ai_evaluation") return `Marked by AI against ${kp} from your notes${tail}.`;
      if (i.marking === "self_graded") return `Marked by you against ${kp} and the model answer${tail}.`;
      return `Marked against ${kp}${tail}.`;
    }
    case "structured": {
      const p = i.parts ? plural(i.parts, "part") : "each part";
      const how = i.marking === "ai_evaluation" ? "by code where it matched, otherwise by AI" : i.marking === "self_graded" ? "by code where it matched, otherwise by you" : "by code";
      return `Marked part by part (${p}) against each part's accepted answers, ${how}${tail}.`;
    }
    case "scenario": {
      const n = i.weights?.length ?? 0;
      const w = n ? `${plural(n, "stage")}, weighted ${i.weights!.join(" / ")}` : "each stage";
      const how = i.marking === "ai_evaluation" ? "by code where it matched, otherwise by AI" : i.marking === "self_graded" ? "by code where it matched, otherwise by you" : "by code";
      return `Marked stage by stage (${w}) against each stage's key, ${how}${tail}.`;
    }
    // SQIE-CLOSE-2026-11 WS-A: a calculation is marked by code only, against its number, its unit and its tolerance.
    case "calculation": return `Marked by code against the answer's number, its unit and the tolerance allowed${tail}.`;
    case "short": {
      if (i.marking === "ai_evaluation") {
        const kp = i.keyPoints ? ` and ${plural(i.keyPoints, "key point")}` : "";
        return `Judged by AI against your notes, the accepted answers${kp}${tail}.`;
      }
      if (i.marking === "self_graded") return `Marked by you against the accepted answers${tail}.`;
      return `Marked by code against the accepted answers${tail}.`;
    }
    default:
      // mcq, case, mrq, match, sequence, cloze, true_false: marked by code against the answer key. A snapshot adds the fingerprint; none adds nothing.
      return `Marked by its answer key${tail}.`;
  }
}
