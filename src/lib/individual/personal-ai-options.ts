// SCHOLAR-PAI-EXPERIENCE-01 (owner, 31 Oct 2026): THE SCHOLAR PERSONAL AI'S REQUEST OPTIONS AND ITS STREAM CONTRACT.
//
// Pure, and imports NOTHING: the browser (AssistantPanel, Learn) reads it as well as the two routes. What it holds:
//   - depth (quick | standard | deep): how long an answer may be. It never changes the risk tier, the model's
//     eligibility or any safeguard -- only the words asked for and the output ceiling, which the published policy's
//     activity maxOutputTokens still caps.
//   - follow-ups (simplify | expand | practise) on an answer already shown, without retyping. The kind maps to a FIXED
//     server instruction; the learner sends no free text with it. The previous answer is model text the browser held,
//     so it is untrusted: truncated, quoted, screened for identifiers, and never what the risk is classified on.
//   - the NDJSON events a streamed answer is sent as, and the browser's reader for them.

export const DEPTHS = ["quick", "standard", "deep"] as const;
export type PersonalAiDepth = (typeof DEPTHS)[number];
export const DEPTH_LABEL: Record<PersonalAiDepth, string> = { quick: "Quick", standard: "Standard", deep: "Deep" };
/** The output ceiling each depth asks for. The published activity's maxOutputTokens caps it (personal-ai.ts). */
export const DEPTH_MAX_TOKENS: Record<PersonalAiDepth, number> = { quick: 450, standard: 1100, deep: 1600 };

export const FOLLOW_UPS = ["simplify", "expand", "practise"] as const;
export type FollowUpKind = (typeof FOLLOW_UPS)[number];
export const FOLLOW_UP_LABEL: Record<FollowUpKind, string> = { simplify: "Simplify", expand: "Go deeper", practise: "Practise" };
/** The depth each follow-up runs at: simplify is a quick plain re-explanation, expand is deep, practise is short. */
export const FOLLOW_UP_DEPTH: Record<FollowUpKind, PersonalAiDepth> = { simplify: "quick", expand: "deep", practise: "quick" };
export const PREVIOUS_ANSWER_MAX = 6000;
const PREVIOUS_QUESTION_MAX = 1000; // = QUESTION_MAX (assistant-limits.ts); restated so this file imports nothing.

export type FollowUp = { kind: FollowUpKind; previousQuestion: string; previousAnswer: string };

/** Pure. The request's depth: absent is standard; anything else unknown is refused (null), never guessed. */
export function parseDepth(body: unknown): PersonalAiDepth | null {
  const v = (body as { depth?: unknown } | null)?.depth;
  if (v === undefined || v === null || v === "") return "standard";
  return (DEPTHS as readonly unknown[]).includes(v) ? v as PersonalAiDepth : null;
}

/**
 * Pure. A follow-up: absent is `undefined`; a malformed one is `null` (refused). The previous question is held to the
 * question limit; the previous answer is truncated to PREVIOUS_ANSWER_MAX characters (it is model text, not the
 * learner's, so it is cut rather than refused).
 */
export function parseFollowUp(body: unknown): FollowUp | null | undefined {
  const f = (body as { followUp?: unknown } | null)?.followUp;
  if (f === undefined || f === null) return undefined;
  if (typeof f !== "object" || Array.isArray(f)) return null;
  const { kind, previousQuestion, previousAnswer } = f as Record<string, unknown>;
  if (!(FOLLOW_UPS as readonly unknown[]).includes(kind)) return null;
  if (typeof previousQuestion !== "string" || typeof previousAnswer !== "string") return null;
  const q = previousQuestion.trim(), a = previousAnswer.trim();
  if (!q || q.length > PREVIOUS_QUESTION_MAX || !a) return null;
  return { kind: kind as FollowUpKind, previousQuestion: q, previousAnswer: a.slice(0, PREVIOUS_ANSWER_MAX) };
}

// ── THE STREAM ───────────────────────────────────────────────────────────────────────────────────────────────

export const NDJSON_TYPE = "text/x-ndjson";
/** SCHOLAR-PAI-RESEARCH-01: a numbered note the answer may cite as [S n] (Learn-step route only). */
export type PersonalAiSourceRef = { tag: string; materialTitle: string; citation: string };
/** Whole milliseconds per stage, never text: gate (guard, quota, screen, risk, routing, reservation), context (the
 *  learner's own data loaded), ttft (request start to the first answer text, null when none was sent), total. */
export type PersonalAiTiming = { gate: number; context: number; ttft: number | null; total: number };
export type StreamEvent =
  | { type: "delta"; text: string }
  | { type: "done"; mode: string; label?: string; timing: PersonalAiTiming; sources?: PersonalAiSourceRef[]; notCovered?: string[] }
  | { type: "error"; code: string; message: string };

export type ReadOutcome =
  /** A streamed answer: the full text, and how it ended. On `error` the text so far is NOT an answer and is not shown. */
  | { kind: "stream"; text: string; done: Extract<StreamEvent, { type: "done" }> | null; error: Extract<StreamEvent, { type: "error" }> | null }
  /** Not a stream (a refusal, a clarify question, an error, or a server that answered whole): the JSON, as before. */
  | { kind: "json"; ok: boolean; status: number; json: Record<string, unknown> };

const INTERRUPTED = "The answer was interrupted. Try again.";

/**
 * The browser's reader. An NDJSON response is read progressively, `onText` receiving the answer so far after each
 * piece; anything else is read as JSON, exactly as the panels read it before streaming.
 */
export async function readPersonalAi(res: Response, onText: (soFar: string) => void): Promise<ReadOutcome> {
  if (!(res.headers.get("content-type") ?? "").includes("ndjson") || !res.body) {
    const json = await res.json().catch(() => ({})) as Record<string, unknown>;
    return { kind: "json", ok: res.ok, status: res.status, json };
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "", text = "";
  let done: Extract<StreamEvent, { type: "done" }> | null = null, error: Extract<StreamEvent, { type: "error" }> | null = null;
  const take = (line: string) => {
    if (!line.trim()) return;
    let e: StreamEvent;
    try { e = JSON.parse(line) as StreamEvent; } catch { return; }
    if (e.type === "delta" && typeof e.text === "string") { text += e.text; onText(text); }
    else if (e.type === "done") done = e;
    else if (e.type === "error") error = { type: "error", code: String(e.code ?? "failed"), message: String(e.message ?? INTERRUPTED) };
  };
  try {
    for (;;) {
      const { value, done: end } = await reader.read();
      if (end) break;
      buf += dec.decode(value, { stream: true });
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) { take(buf.slice(0, i)); buf = buf.slice(i + 1); }
    }
    take(buf + dec.decode());
  } catch {
    if (!done && !error) error = { type: "error", code: "interrupted", message: INTERRUPTED };
  }
  if (!done && !error) error = { type: "error", code: "interrupted", message: INTERRUPTED };
  return { kind: "stream", text, done, error };
}
