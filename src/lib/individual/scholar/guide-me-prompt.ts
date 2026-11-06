// SCHOLAR-GUIDE-ME-001: what the model is asked to write for one Guide Me turn. Pure, no I/O. One model call a turn. The reply is in the structured form of
// deeper-format.ts and is checked by generation.ts checkDeeperAnswer, so its sections say where they come from and answer to the same rules as a Go Deeper round.

import type { ExplanationDepth } from "./config";
import { DEEPER_LABEL } from "./deeper-format";
import { sourceRules } from "./deeper-prompt";
import type { GuideTurn } from "./guide-me";

export const GUIDE_MAX_TOKENS: Record<GuideTurn, number> = { teach: 1100, hint: 380, example: 650, explain: 1900 };
const TEACH_WORDS: Record<ExplanationDepth, number> = { brief: 170, standard: 240, detailed: 320 };
const EXPLAIN_WORDS: Record<ExplanationDepth, number> = { brief: 300, standard: 430, detailed: 560 };

const WRITE = [
  "WRITE ABOUT THE SUBJECT, never about the material: no 'slide', 'page', 'the notes list' or 'your notes say'. A passage with no teaching content (a bare heading, a test line) is ignored, not discussed. Do not tell the student how to use this page: never mention buttons, hints or what to click.",
  "Short paragraphs of at most three sentences. One idea at a time. Explain each technical term in the sentence that first uses it. Keep apart what is established, what is uncertain and what is your own educational inference. No recommendation about any particular patient. No firm conclusion from one isolated finding.",
];
const SECTION = `${DEEPER_LABEL.section} kind | source | heading, then its text on the lines below. kinds: principle, science, compare (a table, each row starting and ending with '|'), application, misconception, memory. Use 'memory' ONLY for real memory support: an analogy, a comparison, a mnemonic or a retrieval cue, and never for an instruction.`;

/** Pure. The instruction for one turn. `ground`: the lesson headings this step covers. */
export function guideInstruction(opts: { turn: GuideTurn; step: number; of: number; ground: readonly string[]; depth: ExplanationDepth; scholar: boolean; taught: boolean; level: 1 | 2 }): string {
  const where = `This is step ${opts.step + 1} of ${opts.of} of a guided lesson${opts.ground.length ? `. This step's ground: ${opts.ground.join("; ")}` : ""}.`;
  const sources = sourceRules(opts.scholar);
  switch (opts.turn) {
    case "teach":
      return [
        `MODE: GUIDE ME, one step. You are a responsive educator: teach first, then ask. ${where}`,
        "Teach ONE concept: a concise but substantive explanation of how and why it works, with its mechanism, a relationship or an example. Do not walk through the notes. A question must follow something worth thinking about.",
        ...(opts.taught ? ["TAUGHT SO FAR says what has been taught and how the student answered. Do not repeat it. Build on what they have shown, and go back to what they have not."] : []),
        ...sources,
        ...WRITE,
        "Reply in exactly these labelled lines, each label at the start of its own line, with no markdown headings or bold:",
        `${DEEPER_LABEL.focus} a short heading in plain words for this step's concept. No citation.`,
        `${SECTION} One to three sections.`,
        `${DEEPER_LABEL.check} exactly ONE question on a line starting '- ': it asks the student to explain, compare, interpret or apply what you have just taught. Never ask them to find, repeat, list or recall wording, never several questions in one, never for a number or how many. It ends with '?' and then the [S n] of the passage it rests on.`,
        `Keep the whole step under ${TEACH_WORDS[opts.depth]} words. Write nothing else.`,
      ].join("\n");
    case "hint":
      return [
        `MODE: GUIDE ME, a hint. ${where} The student is working on the question they name and has not answered yet. You have not seen an answer, so do not judge, praise or correct anything.`,
        opts.level === 1
          ? "A nudge: what to think about, in one or two sentences. Do not name the answer."
          : "A bigger hint: the idea to start from and the first step of the reasoning, in two or three sentences. Leave the final step for the student. Do not state the answer.",
        ...sources,
        ...WRITE,
        "Reply in exactly these labelled lines, with no markdown:",
        `${DEEPER_LABEL.focus} the idea this hint is about, in a few plain words.`,
        `${DEEPER_LABEL.section} principle | ${opts.scholar ? "scholar" : "notes"} | a short heading on that line, then the hint on the next line. ONE section only, under ${opts.level === 1 ? 45 : 80} words. Do not explain the science here: a hint points, it does not teach.`,
        "No question, no takeaways. Write nothing else.",
      ].join("\n");
    case "example":
      return [
        `MODE: GUIDE ME, worked reasoning. ${where} Show how to reason, on a PARALLEL case or idea, not the question the student is working on: leave that one for them. You have not seen an answer, so do not judge anything.`,
        "Set out the steps of the reasoning: what you notice, what it depends on, what you conclude and why. No invented figures, ages or findings. Do not give advice about any patient.",
        ...sources,
        ...WRITE,
        "Reply in exactly these labelled lines, with no markdown:",
        `${DEEPER_LABEL.focus} what this example shows, in a few plain words.`,
        `${DEEPER_LABEL.section} application | ${opts.scholar ? "scholar" : "notes"} | a short heading on that line, then the reasoning on the next. ONE section only, under 130 words.`,
        "No question, no takeaways. Write nothing else.",
      ].join("\n");
    case "explain":
      return [
        `MODE: GUIDE ME, the student chose to have this explained. ${where} Give a substantive explanation, not a restatement of the notes: how it works, why, how the ideas relate, what it means in practice, and where a student commonly goes wrong. If they name a question, the explanation answers it.`,
        ...(opts.taught ? ["TAUGHT SO FAR says what has been taught. Do not repeat it beyond what this explanation needs."] : []),
        ...sources,
        ...WRITE,
        "Reply in exactly these labelled lines, each label at the start of its own line, with no markdown headings or bold:",
        `${DEEPER_LABEL.focus} a short heading in plain words for what this explains. No citation.`,
        `${SECTION} Two to four sections, at least one of them from the notes.`,
        `No question. Keep it under ${EXPLAIN_WORDS[opts.depth]} words. Write nothing else.`,
      ].join("\n");
  }
}

/** What Guide Me adds to the existing clarify: its verdict and parts are unchanged, and kept as every check is. */
export const GUIDED_CLARIFY = "This answer comes from Guide Me. TAUGHT SO FAR holds what was just taught: judge the student's understanding and reasoning of that teaching and of the passages, never whether they used the notes' wording. A correct idea in their own words is correct. Sound general science the passages do not cover is not a mistake: credit it under what they got right, saying it goes beyond these passages, and never list it as a misconception. Answer what they actually wrote; if it is off the question, say so plainly. In NEXT: when the verdict is not_yet, write one new short question, ending with '?', that lets them apply the corrected idea; otherwise one short thing to think about next. Never write about buttons or what to click.";
