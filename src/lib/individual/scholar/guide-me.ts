// SCHOLAR-GUIDE-ME-001 (owner instruction, 6 Nov 2026, P1): GUIDE ME AS A RESPONSIVE EDUCATOR. "Guide Me must guide learning, not merely guide learners through the
// wording of their notes." Pure and client-safe: the route, the prompt and the page read the same rules. Policy scholar_guide_me_adaptive, default off.
//
// THE CYCLE: explain -> question -> the learner's response -> feedback -> adapt -> progress.
//   teach    a step's teaching and ONE meaningful question, in the structured form of deeper-format.ts, so each section says where it comes from and passes the same checks
//   clarify  the EXISTING understanding check judges a real answer: the verdict and feedback are kept as every check is (no second marking path)
//   hint     graduated, and only a hint: never counted as teaching done, never a judgement of anything
//   example  worked reasoning on a parallel case
//   explain  "Just explain it": a substantive explanation of the step; the learner can go back to the question
// A teach, hint, example or explain turn is one saved answer of the existing `explain` kind, under its own prompt version and key, so reopening costs no AI and no migration is needed.
// ⚠ PROGRESS IS WHAT HAPPENED. A step is understood only on an `understood` verdict for an answer the learner wrote. Nothing is judged when there is nothing to judge: a blank answer cannot be
// sent, and "I don't know" is met with help, not a verdict. A hint is not progress. Moving on is the learner's choice and is recorded as what it was.

export const GUIDE_TURNS = ["teach", "hint", "example", "explain"] as const;
export type GuideTurn = (typeof GUIDE_TURNS)[number];
export const GUIDE_STEPS_MAX = 3;
export const GUIDE_HINT_LEVELS = 2;
const QUESTION_MAX = 400;

export type GuideAsk = { turn: GuideTurn; step: number; level: 1 | 2; question: string };

/** Pure. The `guide` field of a request: bounded, or null when it is not a guided request. The route decides how many steps the lesson has. */
export function parseGuideAsk(raw: unknown): GuideAsk | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!(GUIDE_TURNS as readonly unknown[]).includes(r.turn)) return null;
  const step = Number.isInteger(r.step) && Number(r.step) >= 0 && Number(r.step) < GUIDE_STEPS_MAX ? Number(r.step) : 0;
  return { turn: r.turn as GuideTurn, step, level: r.level === 2 ? 2 : 1, question: typeof r.question === "string" ? r.question.trim().slice(0, QUESTION_MAX) : "" };
}

/** Pure. How many steps a lesson has, from its own headings: about three headings a step, at most GUIDE_STEPS_MAX. It is the lesson's size, not a promise of a fixed script. */
export const guideStepCount = (headings: number) => Math.min(GUIDE_STEPS_MAX, Math.max(1, Math.ceil(headings / 3)));

/** Pure. The lesson headings one step covers, in order. */
export function guideGround(headings: readonly string[], step: number, of: number): string[] {
  if (!headings.length) return [];
  const per = headings.length / of;
  return headings.slice(Math.round(step * per), Math.round((step + 1) * per));
}

/** Pure. What makes a guided answer the same request: the same turn on the same step reuses what is saved. A hint keeps its level. */
export const guideKeyContext = (a: Pick<GuideAsk, "turn" | "step" | "level">, of: number) => `guide:${a.turn}:${a.step}:${of}${a.turn === "hint" ? `:${a.level}` : ""}`;

const WORDS: Record<GuideTurn, string> = { teach: "Teach me this step.", hint: "Give me a hint, not the answer.", example: "Show me example reasoning on a similar case.", explain: "Just explain this step to me." };
/** Pure. The request as the model and the grounding check read it. */
export const guidePrompt = (a: GuideAsk) => `${WORDS[a.turn]}${a.question ? `\nThe question I am working on: ${a.question}` : ""}`;

// ── WHAT A RESPONSE MEANS ──

/** Pure. "I don't know" and its kin: a real and useful response, met with help. Never sent for judging, so it is never told it was wrong. */
export function isUncertainAnswer(text: string): boolean {
  const t = text.trim().toLowerCase().replace(/[.!?…]+$/, "").trim();
  if (!text.trim()) return false;
  if (!t) return true; // only punctuation: "?" says the same
  if (t.length > 60) return false;
  return /^(?:i\s+)?(?:really\s+)?(?:don['’]?t|do not|dont)\s+(?:really\s+)?(?:know|understand|remember|get it)\b|^(?:i['’]?m\s+|i am\s+)?(?:not sure|unsure|lost|confused|stuck)\b|^(?:no idea|no clue|idk|dunno|pass|help|\?+|not really)$|^(?:i\s+)?(?:can['’]?t|cannot)\s+(?:answer|remember|say|explain)\b/.test(t);
}

export type StepStatus = "open" | "understood" | "attempted" | "explained" | "skipped";
export type GuideMove = { primary: "next" | "retry" | "new_question"; status: StepStatus };

/** Pure. What a verdict means for the step. Correct: advance. Partial: another go at the same question. A misconception: a new chance to apply the correction, where feedback offered one. */
export function moveAfterVerdict(verdict: string | null | undefined, followUp: string | null): GuideMove {
  if (verdict === "understood") return { primary: "next", status: "understood" };
  if (verdict === "not_yet" && followUp) return { primary: "new_question", status: "attempted" };
  return { primary: "retry", status: "attempted" };
}

/** Pure. A follow-up question out of the feedback's NEXT line: its last sentence ending in '?', without citations. Null when NEXT holds no question. */
export function followUpOf(next: string | null | undefined): string | null {
  if (!next) return null;
  const plain = next.replace(/\s*\[[SRE]\d+\]/g, "").trim();
  const m = /([^.!?]*\?)\s*$/.exec(plain);
  const q = m?.[1].trim();
  return q && q.length >= 8 ? q : null;
}

/** Pure. A later status never undoes understanding, and moving on never counts as understanding. */
export function mergeStatus(was: StepStatus, now: StepStatus): StepStatus {
  if (was === "understood") return "understood";
  return now;
}

/** Pure. Which step to come back to: the first not yet understood, explained or skipped. Past the end means the lesson is finished. */
export function resumeStep(status: readonly StepStatus[]): number {
  const i = status.findIndex(s => s === "open" || s === "attempted");
  return i < 0 ? status.length : i;
}

export const STATUS_WORDS: Record<StepStatus, string> = { open: "Not started", understood: "Understood", attempted: "Answered, not yet understood", explained: "Explained to you", skipped: "Moved on" };

/** Pure. The progress line, in words: only what happened. Nothing is said to be done that was only shown. */
export function progressWords(status: readonly StepStatus[]): string {
  const n = (s: StepStatus) => status.filter(x => x === s).length;
  const bits = [n("understood") ? `${n("understood")} understood` : null, n("attempted") ? `${n("attempted")} answered, not yet understood` : null, n("explained") ? `${n("explained")} explained to you` : null, n("skipped") ? `${n("skipped")} moved on` : null].filter(Boolean);
  return bits.length ? bits.join(" · ") : "Nothing answered yet";
}

export const GUIDE_COPY = {
  card: "Guide Me",
  think: "Think about this",
  placeholder: "Explain your reasoning in your own words…",
  check: "Check my reasoning",
  example: "Show example reasoning",
  hint: "Give me a hint",
  biggerHint: "A bigger hint",
  explain: "Just explain it",
  back: "Back to the question",
  next: "Next step",
  finish: "Finish",
  retry: "Try again",
  newQuestion: "Try this one",
  moveOn: "Move on without answering",
  start: "Start guided learning",
  blank: "Write what you think first, even a rough idea. Or ask for a hint, an example or an explanation. Nothing is judged until you answer.",
  uncertain: "That is fine: nothing has been marked. A hint or a worked example may help, or Scholar can simply explain it.",
  hintNote: "A hint, not an answer. It does not count as a step done.",
  fallbackQuestion: "In your own words, why does this happen, and what would it change in practice?",
  finished: "You have reached the end of this guided lesson.",
  notSaved: "Your answer was not judged, so nothing was recorded.",
} as const;
