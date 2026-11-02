// ── SCHOLAR-CE-2026 CE-05: THE EVOLVING SCENARIO FORMAT ── a stem that unfolds over two to four stages ───────────────────
//
// A scenario is a situation from the learner's OWN notes that unfolds in stages. Each stage reveals new information and asks ONE
// question of an existing kind (mcq, mrq, short or cloze). A later stage is revealed only after the current one is answered.
// The stages are weighted; the practice marks are the weighted sum of the stage scores. Formative only: not an assessment.
//
// STORED as the existing `short` kind (migrations 416/710 CHECKs: options [], correct_index null, answer.accepted of 1 to 8
// strings), told apart by answer.format = 'scenario' -- exactly how cloze / true_false / extended are stored. No migration.
//   answer { format: 'scenario', accepted: [each stage's key point], stages: [ { reveal, prompt, kind, options?, correct?, accepted?,
//            weight, keyPoint } ], rubric }
//   stem   the opening situation.
//
// REVEAL IS ENFORCED ON THE SERVER. learnerView() projects the opening and the FIRST stage only. The route (api/.../revision/scenario)
// answers each stage with the next stage's view and a progress token: an HMAC over the learner, the question, its marking guide and the
// stage results so far. A later stage is sent only in reply to a valid answer to the stage before it, and the results a token carries
// cannot be altered by the browser. Nothing here holds the key in a projection a browser receives.
//
// Pure apart from node:crypto (the token). No I/O, no clock of its own (the route passes `now`), no model.

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { SCENARIO_STAGES_MAX, SCENARIO_STAGES_MIN, SCENARIO_WEIGHT_MAX } from "./config";
import { CLOZE_BLANK, markCloze } from "./cloze";
import { markShortAnswer } from "./revision";
import { rubricHash } from "./rubric-snapshot";
import { asksQuestion } from "./question-intel";

export const STAGE_KINDS = ["mcq", "mrq", "short", "cloze"] as const;
export type StageKind = (typeof STAGE_KINDS)[number];

export type ScenarioStage = {
  /** New information revealed at this stage (empty only for the first). */
  reveal: string;
  prompt: string;
  kind: StageKind;
  /** mcq: exactly four. mrq: four to six. Otherwise []. */
  options: string[];
  /** mcq: one index. mrq: the set. Otherwise []. */
  correct: number[];
  /** short and cloze: the answers the notes support. Otherwise []. */
  accepted: string[];
  weight: number;
  /** What this stage teaches, from the notes: shown with the final feedback. */
  keyPoint: string;
  /** The citation: ONE sentence of the cited section (verbatim) that supports this stage's finding and answer. "" on a scenario written before citations. */
  source: string;
  /** The tags of approved references this stage also draws on (mode: your notes + approved references). */
  refs: string[];
};
export type ScenarioSpec = { stages: ScenarioStage[]; totalWeight: number };

const strs = (v: unknown): string[] | null => (Array.isArray(v) && v.every(s => typeof s === "string") ? (v as string[]) : null);
const text = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() && v.trim().length <= max ? v.trim() : null);
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/** Pure. One stored stage read back, or null where it is not sound. */
function stageOf(raw: unknown): ScenarioStage | null {
  const x = (raw ?? {}) as Record<string, unknown>;
  const kind = x.kind as StageKind;
  if (!STAGE_KINDS.includes(kind)) return null;
  const prompt = text(x.prompt, 400), keyPoint = text(x.keyPoint, 300), reveal = typeof x.reveal === "string" ? x.reveal.trim() : "";
  const weight = x.weight;
  if (!prompt || !keyPoint || reveal.length > 600 || !Number.isInteger(weight) || (weight as number) < 1 || (weight as number) > SCENARIO_WEIGHT_MAX) return null;
  const options = strs(x.options) ?? [], accepted = strs(x.accepted) ?? [];
  const correct = Array.isArray(x.correct) && x.correct.every(i => Number.isInteger(i)) ? (x.correct as number[]) : [];
  const source = typeof x.source === "string" ? x.source.trim().slice(0, 500) : "";
  const refs = (strs(x.refs) ?? []).map(t => t.trim()).filter(Boolean).slice(0, 4);
  const base = { reveal, prompt, kind, weight: weight as number, keyPoint, source, refs };
  if (kind === "mcq") return options.length === 4 && correct.length === 1 && correct[0] >= 0 && correct[0] < 4 ? { ...base, options, correct, accepted: [] } : null;
  if (kind === "mrq") {
    const set = [...new Set(correct)].sort();
    return options.length >= 4 && options.length <= 6 && set.length >= 1 && set.length < options.length && set.every(i => i >= 0 && i < options.length) ? { ...base, options, correct: set, accepted: [] } : null;
  }
  return accepted.length >= 1 && accepted.length <= 4 && accepted.every(a => a.trim() && a.length <= 200) ? { ...base, options: [], correct: [], accepted } : null;
}

/** Pure. A stored scenario's stages, or null where the row does not carry a sound one (the question is then not offered). */
export function scenarioSpecOf(answer: unknown): ScenarioSpec | null {
  const a = (answer ?? {}) as Record<string, unknown>;
  if (a.format !== "scenario" || !Array.isArray(a.stages) || a.stages.length < SCENARIO_STAGES_MIN || a.stages.length > SCENARIO_STAGES_MAX) return null;
  const stages = a.stages.map(stageOf);
  if (stages.some(s => !s)) return null;
  // Every stage after the first reveals something: that is what makes it a scenario that unfolds.
  if ((stages as ScenarioStage[]).some((s, i) => i > 0 && !s.reveal)) return null;
  const ok = stages as ScenarioStage[];
  return { stages: ok, totalWeight: ok.reduce((n, s) => n + s.weight, 0) };
}

// ── WHAT A BROWSER SEES ──

/** One stage as the browser sees it: the new information, the question and its options. Never the key, the key point or the accepted answers. */
export type ScenarioStageView = { index: number; reveal: string; prompt: string; kind: StageKind; options: string[]; weight: number };
export type ScenarioLearnerView = { count: number; totalWeight: number; stage: ScenarioStageView };

/** Pure. One stage's learner view, or null past the last. */
export function stageView(spec: ScenarioSpec, index: number): ScenarioStageView | null {
  const s = spec.stages[index];
  return s ? { index, reveal: s.reveal, prompt: s.prompt, kind: s.kind, options: [...s.options], weight: s.weight } : null;
}

/** Pure. The scenario as a session first shows it: the opening is the item's stem; this adds the FIRST stage only. */
export function learnerView(answer: unknown): ScenarioLearnerView | null {
  const spec = scenarioSpecOf(answer);
  const stage = spec ? stageView(spec, 0) : null;
  return spec && stage ? { count: spec.stages.length, totalWeight: spec.totalWeight, stage } : null;
}

// ── AN ANSWER TO ONE STAGE, AND HOW CODE MARKS IT ──

export type StageAnswer = { kind: "choice"; index: number } | { kind: "set"; indexes: number[] } | { kind: "text"; text: string };

/** Pure. The answer a body carries for this stage's kind, bounded, or null. */
export function parseStageAnswer(stage: ScenarioStage, raw: unknown): StageAnswer | null {
  const r = (raw ?? {}) as Record<string, unknown>;
  const n = stage.options.length;
  if (stage.kind === "mcq") return Number.isInteger(r.index) && (r.index as number) >= 0 && (r.index as number) < n ? { kind: "choice", index: r.index as number } : null;
  if (stage.kind === "mrq") {
    const c = Array.isArray(r.indexes) && r.indexes.every(i => Number.isInteger(i)) ? (r.indexes as number[]) : null;
    return c && c.length >= 1 && c.length <= n && c.every(i => i >= 0 && i < n) ? { kind: "set", indexes: [...new Set(c)].sort() } : null;
  }
  return typeof r.text === "string" && r.text.trim() && r.text.length <= (stage.kind === "cloze" ? 200 : 1000) ? { kind: "text", text: r.text.trim() } : null;
}

/**
 * Pure. A stage marked by code: its score 0 to 1, or null where code cannot tell (a short answer that matches no accepted answer --
 * it is then judged by AI or by the learner, as a short answer always is). mcq right or wrong; mrq fractional as revision.ts marks it;
 * cloze a normalised match either way.
 */
export function markStageByCode(stage: ScenarioStage, a: StageAnswer): { score: number } | null {
  if (stage.kind === "mcq" && a.kind === "choice") return { score: a.index === stage.correct[0] ? 1 : 0 };
  if (stage.kind === "mrq" && a.kind === "set") {
    const hits = a.indexes.filter(i => stage.correct.includes(i)).length, wrong = a.indexes.length - hits;
    return { score: Math.max(0, (hits - wrong) / stage.correct.length) };
  }
  if (stage.kind === "cloze" && a.kind === "text") return { score: markCloze(a.text, stage.accepted) ? 1 : 0 };
  if (stage.kind === "short" && a.kind === "text") return markShortAnswer(a.text, stage.accepted) ? { score: 1 } : null;
  return null;
}

/** Pure. A stage's marks from an evaluation verdict: all, half, or none -- the same rule as a structured part (revision.ts partMarks). */
export const verdictScore = (verdict: "correct" | "partly" | "incorrect"): number => (verdict === "correct" ? 1 : verdict === "partly" ? 0.5 : 0);

/** Pure. The answer in words, for the record and the feedback (bounded). */
export function answerSummary(stage: ScenarioStage, a: StageAnswer): string {
  const cut = (s: string) => (s.length > 200 ? s.slice(0, 200) : s);
  if (a.kind === "choice") return cut(stage.options[a.index] ?? "");
  if (a.kind === "set") return cut(a.indexes.map(i => stage.options[i]).filter(Boolean).join("; "));
  return cut(a.text);
}

/** Pure. A stage's key in words. */
export function stageKeyText(stage: ScenarioStage): string {
  return stage.kind === "mcq" || stage.kind === "mrq" ? stage.correct.map(i => stage.options[i]).join("; ") : stage.accepted[0];
}

// ── THE MARKS: stage scores summed with the stage weights ──

export type StageResult = { score: number; by: "code" | "ai" | "self"; answer: string; feedback?: string | null };

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Pure. Practice marks: the weighted sum of the stage scores, out of the sum of the weights; the attempt score is that share. */
export function scenarioMarks(spec: ScenarioSpec, results: readonly Pick<StageResult, "score">[]): { awarded: number; total: number; score: number; correct: boolean } {
  const awarded = round2(spec.stages.reduce((n, s, i) => n + s.weight * Math.max(0, Math.min(1, results[i]?.score ?? 0)), 0));
  const total = spec.totalWeight;
  return { awarded, total, score: total ? Math.max(0, Math.min(1, awarded / total)) : 0, correct: total > 0 && results.length === spec.stages.length && results.every(r => r.score === 1) };
}

/** Pure. How the whole attempt was marked: the learner's own judgement if any stage was, else AI evaluation if any was, else code. */
export function scenarioMarking(results: readonly Pick<StageResult, "by">[]): "deterministic" | "self_graded" | "ai_evaluation" {
  return results.some(r => r.by === "self") ? "self_graded" : results.some(r => r.by === "ai") ? "ai_evaluation" : "deterministic";
}

/** Pure. The response stored with the attempt (migration 416 `response`): what was answered and scored at each stage, and how. */
export function storedStages(results: readonly StageResult[]): Record<string, unknown> {
  return { kind: "scenario", stages: results.map(r => ({ a: r.answer.slice(0, 200), s: round2(r.score), by: r.by })) };
}

/** Pure. The stage results read back from a stored attempt response (answer text, score, how marked), or null. */
export function storedStageResults(response: unknown, count: number): StageResult[] | null {
  if (!response || typeof response !== "object") return null;
  const st = (response as Record<string, unknown>).stages;
  if (!Array.isArray(st) || st.length !== count) return null;
  const out: StageResult[] = [];
  for (const x of st) {
    const o = (x ?? {}) as Record<string, unknown>;
    if (typeof o.s !== "number" || !(o.s >= 0 && o.s <= 1) || (o.by !== "code" && o.by !== "ai" && o.by !== "self") || typeof o.a !== "string") return null;
    out.push({ score: o.s, by: o.by, answer: o.a.slice(0, 200) });
  }
  return out;
}

// ── THE PROGRESS TOKEN: what makes "answer one to see the next" a server rule ──

export const TOKEN_TTL_MS = 6 * 60 * 60 * 1000;
export type Progress = { next: number; results: StageResult[]; evaluator: { model: string; promptVersion: string } | null };
type Claims = { u: string; q: string; h: string; t: number; n: number; r: { s: number; b: StageResult["by"]; a: string; f?: string }[]; e: Progress["evaluator"] };

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");
const mac = (secret: string, body: string) => createHmac("sha256", secret).update(body).digest("base64url");

/** Pure. A key for the token from a server-only secret (the caller supplies it; tests supply their own). */
export const tokenKey = (secret: string): string => createHash("sha256").update(`scholar-scenario-v1:${secret}`).digest("hex");

/** Pure. The token for the progress so far: bound to the learner, the question and its marking guide, and signed. */
export function signProgress(key: string, who: { userId: string; questionId: string; answer: unknown }, p: Progress, now: number): string {
  const claims: Claims = {
    u: who.userId, q: who.questionId, h: rubricHash(who.answer), t: now, n: p.next,
    r: p.results.map(x => ({ s: round2(x.score), b: x.by, a: x.answer.slice(0, 200), ...(x.feedback ? { f: x.feedback.slice(0, 600) } : {}) })), e: p.evaluator,
  };
  const body = b64(JSON.stringify(claims));
  return `${body}.${mac(key, body)}`;
}

/**
 * Pure. The progress a token carries, or null where it is not this learner's, this question's, this marking guide's, is expired, has
 * been altered, or does not stand at the stage the caller expects (a token for stage 2 cannot answer stage 3).
 */
export function readProgress(key: string, token: unknown, who: { userId: string; questionId: string; answer: unknown }, now: number): Progress | null {
  if (typeof token !== "string" || token.length > 12000) return null;
  const [body, sig, extra] = token.split(".");
  if (!body || !sig || extra !== undefined) return null;
  const want = Buffer.from(mac(key, body)), got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  let c: Claims;
  try { c = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Claims; } catch { return null; }
  if (c.u !== who.userId || c.q !== who.questionId || c.h !== rubricHash(who.answer) || !Number.isFinite(c.t) || now - c.t > TOKEN_TTL_MS || now < c.t - 60_000) return null;
  if (!Number.isInteger(c.n) || c.n < 1 || !Array.isArray(c.r) || c.r.length !== c.n) return null;
  return { next: c.n, results: c.r.map(x => ({ score: x.s, by: x.b, answer: x.a, feedback: x.f ?? null })), evaluator: c.e ?? null };
}

// ── NEW SCENARIOS FROM A PASSAGE ──

export type ScenarioRaw = { situation: string; stages: ScenarioStage[] };

/** Pure. A deterministic shuffle by seed (mcq/mrq options are stored shuffled so the key is not always first). */
function order(n: number, seed: string): number[] {
  const idx = [...Array(n).keys()];
  const h = createHash("sha256").update(seed).digest();
  for (let i = n - 1; i > 0; i--) { const j = h[i % h.length] % (i + 1); [idx[i], idx[j]] = [idx[j], idx[i]]; }
  return n >= 3 && idx.every((v, i) => v === i) ? [...idx.slice(1), idx[0]] : idx;
}

/**
 * Pure. The fields of a generated scenario, or null where it is not well formed: a situation, two to four stages, each of a known
 * kind with its own key, every stage after the first revealing something, no two stages asking the same thing. An mcq or mrq stage
 * is stored in a seeded shuffle with the key remapped; a cloze stage's prompt must hold the blank.
 */
export function parseScenarioRaw(r: Record<string, unknown>): ScenarioRaw | null {
  const situation = text(r.situation ?? r.stem, 800);
  const raw = Array.isArray(r.stages) ? r.stages : null;
  if (!situation || !raw || raw.length < SCENARIO_STAGES_MIN || raw.length > SCENARIO_STAGES_MAX) return null;
  const stages: ScenarioStage[] = [];
  for (let i = 0; i < raw.length; i++) {
    const x = (raw[i] ?? {}) as Record<string, unknown>;
    const weight = x.weight === undefined ? 1 : x.weight;
    const prompt = text(x.prompt, 400);
    const correctRaw = Number.isInteger(x.correct) ? [x.correct as number] : x.correct;
    if (!prompt) return null;
    const s = stageOf({
      reveal: typeof x.reveal === "string" ? x.reveal : "", prompt, kind: x.kind, options: strs(x.options)?.map(o => o.trim()), correct: correctRaw, accepted: strs(x.accepted)?.map(a => a.trim()).filter(Boolean), weight, keyPoint: x.keyPoint,
      source: x.source, refs: strs(x.references)?.map(t => t.replace(/[[\]\s]/g, "").toUpperCase()),
    });
    if (!s) return null;
    if (s.kind === "cloze" ? !s.prompt.includes(CLOZE_BLANK) : !asksQuestion(s.prompt)) return null;
    if (s.options.length && new Set(s.options.map(norm)).size !== s.options.length) return null;
    if (s.kind === "mcq" || s.kind === "mrq") {
      const shown = order(s.options.length, `${situation}:${i}:${s.options.join("|")}`);
      s.options = shown.map(k => s.options[k]);
      // correct (old indexes) -> where each now sits
      const old = (x.options as string[]).map(o => o.trim());
      s.correct = (correctRaw as number[]).map(k => s.options.indexOf(old[k])).sort((a, b) => a - b);
      if (s.correct.some(k => k < 0)) return null;
    }
    stages.push(s);
  }
  if (stages.some((s, i) => i > 0 && !s.reveal)) return null;
  if (new Set(stages.map(s => norm(s.prompt))).size !== stages.length) return null;
  return { situation, stages };
}

// ── THE DRAFT'S TWO CONTENT RULES: it is a clinical scenario, and nothing gives a stage's answer away earlier ──

const STOP = new Set(["a", "an", "the", "of", "to", "in", "on", "at", "is", "are", "was", "were", "and", "or", "for", "with", "by", "as", "it", "its", "this", "that", "be", "from", "than", "then"]);
/** Pure. Lower case, letters and digits only, one space between words. */
const words = (t: string): string[] => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);
/** Pure. The content words of an answer (articles and the like dropped). Synonyms are NOT considered: only the words themselves. */
const contentWords = (t: string): string[] => words(t).filter(w => !STOP.has(w));

/** Pure. Whether the words of `answer` appear, in order and all together, in `text`. */
function containsAnswer(text: string, answer: string): boolean {
  const need = contentWords(answer);
  if (need.length < 2) return false; // a single word is not held to this rule
  const have = contentWords(text);
  for (let i = 0; i + need.length <= have.length; i++) if (need.every((w, k) => have[i + k] === w)) return true;
  return false;
}

/** Pure. The answers a stage is marked against, as text: the correct option(s) of a choice, or the accepted answers. */
export const stageAnswers = (st: ScenarioStage): string[] => (st.kind === "mcq" || st.kind === "mrq" ? st.correct.map(i => st.options[i]) : st.accepted);

/** Words that make a stem talk about the notes or a student revising rather than present a situation in practice. */
const META = /\b(?:the|your|their|these|my) notes\b|\b(?:student|learner)s?\b[^.?!]{0,40}\brevis(?:e|es|ing)\b|\baccording to (?:the|your) (?:notes|passage|text)\b|\bthe passage\b/i;

/**
 * Pure. What is wrong with a well-formed scenario, or null (the same screen as the opening line of the draft check; see also citationFlaw):
 *   "not_a_scenario"  its situation, a reveal or a question talks about "the notes", "your notes" or a student revising: it must present a
 *                     person or a situation in practice;
 *   "answer_leaked"   a stage's answer (the correct option, or an accepted answer of two or more content words, normalised, no synonyms)
 *                     already appears in the opening or in an EARLIER stage's new information or question.
 */
export function scenarioFlaw(sc: ScenarioRaw): "not_a_scenario" | "answer_leaked" | "repeated_stage" | null {
  if ([sc.situation, ...sc.stages.flatMap(s => [s.reveal, s.prompt])].some(t => META.test(t))) return "not_a_scenario";
  for (let i = 0; i < sc.stages.length; i++) {
    const before = [sc.situation, ...sc.stages.slice(0, i).flatMap(s => [s.reveal, s.prompt])].join(" ");
    if (stageAnswers(sc.stages[i]).some(a => containsAnswer(before, a))) return "answer_leaked";
  }
  // A later stage asks about the NEW information, never what an earlier stage already asked: two stages with the same answer repeat each other.
  const keys = sc.stages.map(s => stageAnswers(s).map(a => contentWords(a).sort().join(" ")).filter(Boolean).sort().join("|"));
  if (new Set(keys).size !== keys.length) return "repeated_stage";
  return null;
}

/** Pure. The stored answer of a checked scenario (the 416 `short` shape: accepted holds the key points). */
export const scenarioAnswer = (stages: readonly ScenarioStage[]): Record<string, unknown> => ({
  format: "scenario", accepted: [...new Set(stages.map(s => s.keyPoint))].slice(0, 8), stages: stages.map(s => ({
    reveal: s.reveal, prompt: s.prompt, kind: s.kind, weight: s.weight, keyPoint: s.keyPoint, source: s.source, ...(s.refs.length ? { refs: s.refs } : {}),
    ...(s.options.length ? { options: s.options, correct: s.correct } : { accepted: s.accepted }),
  })),
});

/** Pure. Every word of a scenario's stages, for the identifier and grounding screens. */
export const scenarioTexts = (stages: readonly ScenarioStage[]): string[] => stages.flatMap(s => [s.reveal, s.prompt, ...s.options, ...s.accepted, s.keyPoint].filter(Boolean));

// ── THE CITATION RULE: no finding and no expected action without a cited section ──

/** What a learner is told when their notes cannot carry a scenario (the existing source-sufficiency path decides: sufficiency.ts caseReadiness). */
export const SCENARIO_INSUFFICIENT_NOTE = "Your notes don't have enough clinical detail for an evolving scenario on this topic.";

/** What the generator is told about the learner's scope when the study record gives no level: a neutral pre-registration scope. */
export const SCENARIO_SCOPE_LINE = "SCOPE. Each decision is one that someone at MY LEVEL would properly make at that point: notice, interpret, monitor, escalate, report or carry out what the passage says. Do not ask for a decision beyond that scope. If no level is given, assume a pre-registration healthcare student.";

/**
 * Pure. Whether every stage is CITED, or the first thing that is not: "uncited_stage".
 *   - each stage carries a `source`: one sentence found in the cited section (`passageText`), or a tag of an approved reference that was
 *     provided (`references`: tag -> its text); a source quoted from nowhere, or a tag never given, is no citation;
 *   - the stage's KEY (its correct option or accepted answers) and its KEY POINT are supported by that source: all but at most two of their
 *     content words appear in it (the existing term-support rule, question-quality.ts unsupportedTerms, passed in as `unsupported`).
 * The stage's new information is held to the whole cited section by the grounding screen every revision item already passes.
 */
export function citationFlaw(
  stages: readonly ScenarioStage[], passageText: string, references: ReadonlyMap<string, string>, unsupported: (text: string, source: string) => string[],
): "uncited_stage" | null {
  const flat = (t: string) => words(t).join(" ");
  const have = flat(passageText);
  for (const st of stages) {
    const quoted = st.source && have.includes(flat(st.source)) ? st.source : "";
    const refTexts = st.refs.map(t => references.get(t)).filter((t): t is string => !!t);
    if (st.refs.length && refTexts.length !== st.refs.length) return "uncited_stage";
    if (!quoted && !refTexts.length) return "uncited_stage";
    const cited = [quoted, ...refTexts].filter(Boolean).join(" ");
    if (unsupported([...stageAnswers(st), st.keyPoint].join(" "), cited).length > 2) return "uncited_stage";
  }
  return null;
}
