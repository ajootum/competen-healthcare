// ── THE SIX TEACHING ACTIONS ── SCHOLAR-COMPANION-01 P1 (owner, 31 Oct 2026) ──────────────────────────────────────
//
// Ask me, Guide me, Challenge me, Explain my mistake, Teach back, High-yield. Server side only, on the ONE Learn engine
// (generation.ts runLearn): the step's own passages, [S n] citations, the same grounding check, the same risk gate, the
// same standing / preflight / metering as Teach me. A learner always keeps the direct explanation (teach / explain).
//
// Pure: request parsing, prompt wording, the level ladder, the event and metering maps, markdown tidying. No imports from
// generation.ts (it imports this), so it can be unit tested alone.
//
// NO MIGRATION. learning_event.action has a DB CHECK (migration 414), and the AI engine refuses an activity code it does not
// list, so each teaching action borrows the nearest existing value for BOTH (TEACHING_EVENT_ACTION, TEACHING_AI_ACTIVITY):
//   action         event action   metered as   why
//   ask_me         check          check        a question for the learner to answer (judged by the existing clarify)
//   challenge      check          check        the same, one rung of a ladder
//   guide          explain        explain      a hint is a (partial) explanation
//   mistake        clarify        clarify      a judgement of an answer; NO verdict is produced, so the event carries none
//   teach_back     clarify        clarify      a judgement of an explanation; carries VERDICT (414: a verdict only on clarify)
//   high_yield     summary        summary      a summary of what matters
// 415's CHECK allows only teach..summary as saved artefacts, so NOTHING here is cached (the learner's own text makes the
// others uncacheable anyway); two identical requests are de-duplicated by the metered request id, not by a saved answer.

import { CHECK_VERDICTS, QUESTION_MAX, type CheckVerdict, type ExplanationDepth, type TeachingAction, isTeachingAction } from "./config";
import { FEEDBACK_HEADINGS } from "./config";
import { COGNITIVE_LEVELS, LEVEL_LABEL, isCognitiveLevel, type CognitiveLevel } from "./question-intel";

export { isTeachingAction };

// ── the maps ──

// Defined in config.ts (client-safe) so the Learn page can ask the AI standing about the same activity it is metered as.
export { TEACHING_AI_ACTIVITY, TEACHING_EVENT_ACTION } from "./config";
import { TEACHING_AI_ACTIVITY, TEACHING_EVENT_ACTION } from "./config";

/** The value written to learning_event.action (migration 414's CHECK) for any learn action. */
export const learningEventAction = (action: string): string => (isTeachingAction(action) ? TEACHING_EVENT_ACTION[action] : action);
/** The Holdings activity a learn action is metered as (the engine refuses an unlisted code). */
export const meteredActivity = (action: string): string => (isTeachingAction(action) ? TEACHING_AI_ACTIVITY[action] : action);
/** 414: a verdict is stored only on a clarify event, so only a teach-back (mapped to clarify) may carry one. */
export const eventVerdict = (action: string, verdict: CheckVerdict | null): CheckVerdict | null => (action === "clarify" || action === "teach_back" ? verdict : null);

/** Output budget: short actions are short; high-yield follows the depth mapping Teach me uses. */
export const TEACHING_MAX_TOKENS: Record<Exclude<TeachingAction, "high_yield">, number> = { ask_me: 250, challenge: 250, guide: 400, mistake: 600, teach_back: 600 };
export const teachingMaxTokens = (action: TeachingAction, depth: ExplanationDepth): number =>
  action === "high_yield" ? (depth === "detailed" ? 1100 : 800) : TEACHING_MAX_TOKENS[action];

// ── the challenge ladder ──

/** Pure. The next rung of a Challenge-me ladder: understood goes up one, not yet goes down one, partly (or no verdict) stays. */
export function nextChallengeLevel(level: CognitiveLevel, verdict: CheckVerdict | null | undefined): CognitiveLevel {
  const i = COGNITIVE_LEVELS.indexOf(level);
  if (verdict === "understood") return COGNITIVE_LEVELS[Math.min(COGNITIVE_LEVELS.length - 1, i + 1)];
  if (verdict === "not_yet") return COGNITIVE_LEVELS[Math.max(0, i - 1)];
  return level;
}
/** The rung each possible verdict leads to: the question does not know the answer yet, so the client picks one. */
export const challengeNextLevels = (level: CognitiveLevel): Record<CheckVerdict, CognitiveLevel> =>
  Object.fromEntries(CHECK_VERDICTS.map(v => [v, nextChallengeLevel(level, v)])) as Record<CheckVerdict, CognitiveLevel>;

// ── the request ──

export const TEACHING_LIMITS = { attempt: 1500, mistakeQuestion: 600, learnerAnswer: 1500, explanation: 3000, guideQuestion: QUESTION_MAX } as const;
export type HintLevel = 1 | 2 | 3;
export type TeachingRequest =
  | { action: "ask_me" | "challenge"; level: CognitiveLevel }
  | { action: "guide"; hintLevel: HintLevel; attempt: string; question: string }
  | { action: "mistake"; question: string; learnerAnswer: string }
  | { action: "teach_back"; explanation: string }
  | { action: "high_yield" };

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** Pure. The body of a teaching action: bounded, never stored. */
export function parseTeachingRequest(action: TeachingAction, body: unknown): { ok: true; value: TeachingRequest } | { ok: false; error: string } {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const L = TEACHING_LIMITS;
  switch (action) {
    case "ask_me":
    case "challenge": {
      if (b.level !== undefined && b.level !== null && !isCognitiveLevel(b.level)) return { ok: false, error: `Choose a level: ${COGNITIVE_LEVELS.join(", ")}.` };
      return { ok: true, value: { action, level: isCognitiveLevel(b.level) ? b.level : "understanding" } };
    }
    case "guide": {
      const hintLevel = b.hintLevel;
      if (hintLevel !== 1 && hintLevel !== 2 && hintLevel !== 3) return { ok: false, error: "Choose a hint level: 1, 2 or 3." };
      const attempt = str(b.attempt), question = str(b.question);
      if (attempt.length > L.attempt) return { ok: false, error: `Keep your attempt to ${L.attempt} characters.` };
      if (question.length > L.guideQuestion) return { ok: false, error: `Keep the question to ${L.guideQuestion} characters.` };
      return { ok: true, value: { action, hintLevel, attempt, question } };
    }
    case "mistake": {
      const question = str(b.question), learnerAnswer = str(b.learnerAnswer);
      if (!question || !learnerAnswer) return { ok: false, error: "Give the question and your answer." };
      if (question.length > L.mistakeQuestion) return { ok: false, error: `Keep the question to ${L.mistakeQuestion} characters.` };
      if (learnerAnswer.length > L.learnerAnswer) return { ok: false, error: `Keep your answer to ${L.learnerAnswer} characters.` };
      return { ok: true, value: { action, question, learnerAnswer } };
    }
    case "teach_back": {
      const explanation = str(b.explanation);
      if (!explanation) return { ok: false, error: "Explain the idea in your own words first." };
      if (explanation.length > L.explanation) return { ok: false, error: `Keep your explanation to ${L.explanation} characters.` };
      return { ok: true, value: { action, explanation } };
    }
    case "high_yield":
      return { ok: true, value: { action } };
  }
}

/** Pure. Every text the learner typed in the request: screened for patient identifiers and classified for risk. */
export const teachingTexts = (r: TeachingRequest): string[] =>
  r.action === "guide" ? [r.attempt, r.question] : r.action === "mistake" ? [r.question, r.learnerAnswer] : r.action === "teach_back" ? [r.explanation] : [];

/** What was computed (no AI) from the learner's own past papers. Passed to the prompt only when `questions` > 0. */
export type ExamEvidence = { papers: number; questions: number };

/** Pure. The user-side request text. Everything the learner typed is in it, so the risk gate reads it and the grounding check allows it. */
export function teachingPrompt(r: TeachingRequest, examEvidence: ExamEvidence | null = null): string {
  switch (r.action) {
    case "ask_me": return `Ask me one question about this, at the ${LEVEL_LABEL[r.level]} level.`;
    case "challenge": return `Challenge me: ask one question about this, on the ${LEVEL_LABEL[r.level]} rung.`;
    case "guide":
      return `Give me a hint at rung ${r.hintLevel} of 3, not the answer. ${r.question ? `I am working on: ${r.question}` : "I want to work out the main idea of this step myself."}`
        + `${r.attempt ? `\nMy attempt so far: ${r.attempt}` : "\nI have not tried yet."}`;
    case "mistake": return `Explain my mistake.\nThe question was: ${r.question}\nMy answer: ${r.learnerAnswer}`;
    case "teach_back": return `Here is my explanation, in my own words:\n${r.explanation}\nHow well did I explain it?`;
    case "high_yield":
      return `What are the most important things to learn from this?${examEvidence && examEvidence.questions > 0
        ? `\n(Counted by the app from my own uploaded past papers, not by AI: ${examEvidence.questions} of my past-paper questions, in ${examEvidence.papers} of my papers, share key terms with these passages.)` : ""}`;
  }
}

// ── the system prompt ──

const FORMAT = [
  "FORMAT. Write markdown using ONLY: '## ' and '### ' headings, '- ' bullet lists, **bold**, pipe tables (a header row, a separator row, then rows) and callouts: a line '> [!KEY]', '> [!CAUTION]', '> [!SUMMARY]', '> [!MEMORY]' or '> [!EXAMPLE]' followed by lines that each start '> '.",
  "Never number list items and write no digit anywhere except inside a [S n] tag (every digit is checked against the passages). No code blocks, HTML, images, links or emoji. Cite with the passage tags exactly as the rules above say.",
].join("\n");

const LEVEL_ASKS: Record<CognitiveLevel, string> = {
  recall: "the student recalls something the passages state, in their own words",
  understanding: "the student explains an idea of the passages in their own words",
  application: "the student applies an idea of the passages to a short, fictional, generic situation (a patient or the person caring for them: no names, ages, numbers or findings the passages do not contain), which you describe in the question using only what the passages say",
  reasoning: "the student reasons about why, or what follows, linking at least two ideas of the passages",
};

const ONE_QUESTION = "Reply with exactly: a line '### Question', then one line holding the question, which ends with '?' and then the tag of the passage that answers it, for example 'Why is this done? [S2]'. Nothing else: no answer, no hint, no part of the answer. Ask a question the passages answer in a sentence or two, and never ask how many of anything or for a number.";

/** Pure. High-yield's exam wording: with evidence the ONE allowed sentence and its number, otherwise none at all. */
export function highYieldExamRule(e: ExamEvidence | null): string {
  return e && e.questions > 0
    ? `EXAM FREQUENCY. The app counted that key terms of these passages appear in ${e.questions} of the student's own past-paper questions. You may say exactly once, in a '> [!KEY]' callout under the first heading, "Appears in ${e.questions} of your past-paper questions." and nothing more: do not say or imply that anything is frequently examined, commonly tested, likely to come up, or similar, and do not mention the papers' number, marks or years. Call the first heading '## High-yield concepts'.`
    : "EXAM FREQUENCY. You have NO information about what is examined or tested. Call the first heading '## Key concepts'. Never say or imply that anything is high-yield, frequently examined, commonly tested, likely to come up, an exam favourite, or appears in past papers or exams, and never use the words exam, exams or past paper.";
}

/** Pure. The instruction for one teaching action (the 'MODE:' paragraph). */
export function teachingInstruction(action: TeachingAction, opts: { level?: CognitiveLevel; hintLevel?: HintLevel; examEvidence?: ExamEvidence | null; depthWords?: number }): string {
  const level = opts.level ?? "understanding";
  switch (action) {
    case "ask_me":
      return `MODE: ASK ME. Ask the student ONE question about the passages, at the ${LEVEL_LABEL[level]} level: ${LEVEL_ASKS[level]}. ${ONE_QUESTION}`;
    case "challenge":
      return `MODE: CHALLENGE ME. The student is climbing a ladder of questions (recall, understanding, application, reasoning) and is on the ${LEVEL_LABEL[level]} rung. Ask ONE question about the passages that really sits on that rung: ${LEVEL_ASKS[level]}. ${ONE_QUESTION}`;
    case "guide": {
      const n = opts.hintLevel ?? 1;
      const rung = n === 1 ? "RUNG 1, a nudge: ask ONE guiding question back, or name what to think about, without naming the answer."
        : n === 2 ? "RUNG 2, a pointer: point to the passage and the concept that matter and what to look for in it, without stating the answer."
          : "RUNG 3, a near-complete scaffold: set out the outline of the reasoning from the passages and leave the final key step for the student to complete, for example 'so the last step is: ...'.";
      return [
        `MODE: GUIDE ME. The student wants to work something out for themselves. Give ONLY a hint, at rung ${n} of 3. NEVER give the full answer or state in full the conclusion they should reach, even if their attempt is wrong or they ask for it.`,
        rung,
        "If an attempt is given, say in a few words what is on track, then give the hint. Cite at least one passage tag for the passage the hint rests on.",
        `Reply: a line '### Hint', then the hint (under ${n === 3 ? 110 : 70} words), then a last line in a '> [!MEMORY]' callout telling the student they can choose "Explain it directly" instead.`,
      ].join("\n");
    }
    case "mistake":
      return [
        "MODE: EXPLAIN MY MISTAKE. The student answered a question and wants to understand what went wrong. Judge their answer ONLY against the passages, kindly and specifically. Reply in exactly these parts:",
        `### ${FEEDBACK_HEADINGS.right}: bullets, each cited. If nothing was right, say so gently in one line.`,
        `### ${FEEDBACK_HEADINGS.misconceptions}: bullets naming each mistaken idea and WHY it is a natural mistake, corrected from the passages, cited. If the answer was fully right, write 'Nothing to correct.'`,
        `### ${FEEDBACK_HEADINGS.why}: the correct idea, from the passages, cited.`,
        "### Quick check: ONE new short question the student can answer from the passages, ending with '?' and then the tag of the passage that answers it.",
        "Do not judge anything the passages do not cover. Under 220 words.",
      ].join("\n");
    case "teach_back":
      return [
        "MODE: TEACH BACK. The student explained the idea to you in their own words. Judge the explanation ONLY against the passages, as a kind and curious listener. Reply in exactly these parts:",
        `### ${FEEDBACK_HEADINGS.right}: bullets, each cited.`,
        `### ${FEEDBACK_HEADINGS.missing}: bullets of important ideas in the passages the explanation left out, cited. If none, write 'Nothing important missing.'`,
        `### ${FEEDBACK_HEADINGS.misconceptions}: bullets of any mistaken idea, corrected from the passages, cited. If none, write 'None spotted.'`,
        `### ${FEEDBACK_HEADINGS.next}: one short suggestion of what to revise or try next, from the passages, cited.`,
        "Then, as the very last line and alone, exactly one of 'VERDICT: understood', 'VERDICT: partly' or 'VERDICT: not_yet'. Use understood only when the main idea is right with nothing important wrong or missing. Under 250 words.",
      ].join("\n");
    case "high_yield":
      return [
        `MODE: HIGH-YIELD. Pick out what matters most in the passages for a student learning them. Reply in exactly these parts, in this order (leave a part out only where its own rule says):`,
        "## the first heading, named by the EXAM FREQUENCY rule below, then bullets: the essential concepts, each explained in a line and cited.",
        "### Important distinctions: a pipe table (| Idea | What sets it apart |) of things the passages distinguish, each row cited. Leave this part out if the passages distinguish nothing.",
        "### Common misconceptions: bullets, each a mistaken idea the passages themselves make clear, corrected from the passages and cited. Leave this part out if there is none.",
        "### Key recall questions: bullets of short questions the passages answer, each ending with '?'. Then a '> [!SUMMARY]' callout whose lines '> - ' give the answers in the same order, each cited.",
        "### Apply it: a '> [!EXAMPLE]' callout with ONE short, fictional, generic application about 'a patient' or 'the person caring for them', using only what the passages say, cited. No names, ages, numbers or findings the passages do not contain. Leave this part out if the passages describe no situation.",
        highYieldExamRule(opts.examEvidence ?? null),
        `Keep it under ${opts.depthWords ?? 330} words.`,
      ].join("\n");
  }
}

/** Pure. The shared base for a teaching action: EXPLAIN_SYSTEM without its plain-text rule (5) and word cap, plus the markdown subset. */
export function teachingBase(explainSystem: string): string {
  return [...explainSystem.split("\n").filter(l => !/^5\. /.test(l) && !/^Keep it under \d+ words\.$/.test(l)), FORMAT].join("\n");
}

/** High-yield is longer than the others: Teach me's depth words, half as many again. */
export const highYieldWords = (depthWords: number) => Math.round(depthWords * 1.5);

// ── the answer ──

/** Pure. Numbered list markers become bullets before the grounding check, which treats every digit as a claim. */
export const normaliseTeachingMarkdown = (text: string): string => text.replace(/^(\s*(?:>\s*)*)\d{1,2}[.)]\s+/gm, "$1- ").trim();

/** Pure. The single question of an Ask me / Challenge me answer (no tags, no markup), or null when there is not exactly one. */
export function extractQuestion(answer: string): string | null {
  const lines = answer.split("\n").map(l => l.replace(/\[[A-Z]\d+\]/g, "").replace(/\s+/g, " ").trim().replace(/^[>#*_-]+\s*/, "").replace(/[*_]+$/g, "").trim()).filter(Boolean);
  const body = lines.filter(l => !/^question:?$/i.test(l));
  if (body.join(" ").split("?").length !== 2) return null;
  const q = body.find(l => l.includes("?"))?.trim() ?? "";
  return q.endsWith("?") && q.length >= 8 && q.length <= 400 ? q : null;
}

const EXAM_CLAIM = /\bexams?\b|past[- ]papers?|\bhigh[- ]yield\b|\b(?:frequently|commonly|often|regularly|typically|usually|repeatedly)\s+(?:be\s+)?(?:examined|tested|asked|set)\b|\b(?:examined|tested)\s+(?:frequently|often|commonly|regularly)\b|\b(?:come|comes|coming)\s+up\s+in\b|\bmost\s+(?:examined|tested)\b/i;

/** Pure. Exam-frequency language in a high-yield answer that the evidence does not allow. Empty when it is clean. */
export function examClaimViolations(text: string, e: ExamEvidence | null): string[] {
  const allowed = e && e.questions > 0 ? new RegExp(`\\bappears? in ${e.questions} of your past[- ]paper questions\\b`, "gi") : null;
  let rest = text.replace(/\[[A-Z]\d+\]/g, " ");
  if (allowed) rest = rest.replace(allowed, " ").replace(/\bhigh[- ]yield\b/gi, " ");
  return rest.split(/(?<=[.!?])\s+|\n+/).map(s => s.trim()).filter(s => s && EXAM_CLAIM.test(s));
}
