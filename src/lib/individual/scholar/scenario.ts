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
import { PROMPT_VERSIONS, SCENARIO_STAGES_MAX, SCENARIO_STAGES_MIN, SCENARIO_WEIGHT_MAX } from "./config";
import { CLOZE_BLANK, markCloze } from "./cloze";
import { markShortAnswer } from "./revision";
import { rubricHash } from "./rubric-snapshot";
import { asksQuestion } from "./question-intel";
import { unsupportedTerms } from "./question-quality";
import { textGroundingViolations } from "@/lib/ai/grounding";
import { CAPS_DEFAULT, capForSafety, matchUnsafe, safetyMarkersOf, safetyRecord, worstOutcome, type CapPolicy, type SafetyOutcome, type SafetyRecord } from "./scoring-rules";

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
  /** SQIE-CLOSE-2026-11 WS-B (scoring-rules.ts): the stage must not be missed, and the answers (or option texts) that would be unsafe. */
  safetyCritical?: boolean;
  unsafe?: string[];
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
  const markers = safetyMarkersOf(x);
  const base = { reveal, prompt, kind, weight: weight as number, keyPoint, source, refs, ...(markers.safetyCritical ? { safetyCritical: true } : {}), ...(markers.unsafe.length ? { unsafe: markers.unsafe } : {}) };
  if (kind === "mcq") return options.length === 4 && correct.length === 1 && correct[0] >= 0 && correct[0] < 4 ? { ...base, options, correct, accepted: [] } : null;
  if (kind === "mrq") {
    const set = [...new Set(correct)].sort();
    return options.length >= 4 && options.length <= 6 && set.length >= 1 && set.length < options.length && set.every(i => i >= 0 && i < options.length) ? { ...base, options, correct: set, accepted: [] } : null;
  }
  return accepted.length >= 1 && accepted.length <= 6 && accepted.every(a => a.trim() && a.length <= 200) ? { ...base, options: [], correct: [], accepted } : null;
}

/** Pure. In words, what is wrong with a stage that stageOf refused (for the probe and the audit detail: field names only, never learner text). */
export function stageWhy(raw: unknown): string {
  const x = (raw ?? {}) as Record<string, unknown>;
  if (!STAGE_KINDS.includes(x.kind as StageKind)) return `kind "${String(x.kind)}" is not one of mcq, mrq, short, cloze`;
  if (!text(x.prompt, 400)) return "prompt missing or over 400 characters";
  if (!text(x.keyPoint, 300)) return "keyPoint missing or over 300 characters";
  if (typeof x.reveal === "string" && x.reveal.trim().length > 600) return "reveal over 600 characters";
  if (!Number.isInteger(x.weight) || (x.weight as number) < 1 || (x.weight as number) > SCENARIO_WEIGHT_MAX) return `weight ${JSON.stringify(x.weight)} is not a whole number from 1 to ${SCENARIO_WEIGHT_MAX}`;
  const options = strs(x.options) ?? [], accepted = strs(x.accepted) ?? [];
  const correct = Array.isArray(x.correct) && x.correct.every(i => Number.isInteger(i)) ? (x.correct as number[]) : [];
  if (x.kind === "mcq") return options.length !== 4 ? `mcq needs exactly 4 options, has ${options.length}` : correct.length !== 1 ? `mcq needs exactly one correct index, has ${correct.length}` : "correct index out of range";
  if (x.kind === "mrq") {
    const set = [...new Set(correct)];
    return options.length < 4 || options.length > 6 ? `mrq needs 4 to 6 options, has ${options.length}` : !set.length ? "mrq has no correct index" : set.length >= options.length ? "mrq marks EVERY option correct (at least one must be wrong)" : "correct index out of range";
  }
  return accepted.length < 1 || accepted.length > 6 ? `${String(x.kind)} needs 1 to 6 accepted answers, has ${accepted.length}` : "an accepted answer is empty or over 200 characters";
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
export function markStageByCode(stage: ScenarioStage, a: StageAnswer): { score: number; unsafe?: string } | null {
  // WS-B (rules v2): an answer (or a chosen option) the stage names as unsafe is recognised by code first, and scores nothing.
  const unsafe = stage.unsafe?.length ? matchUnsafe(a.kind === "text" ? a.text : a.kind === "choice" ? stage.options[a.index] ?? "" : "", stage.unsafe)
    ?? (a.kind === "set" ? a.indexes.map(i => matchUnsafe(stage.options[i] ?? "", stage.unsafe!)).find(Boolean) ?? null : null) : null;
  if (unsafe) return { score: 0, unsafe };
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

export type StageResult = { score: number; by: "code" | "ai" | "self"; answer: string; feedback?: string | null; unsafe?: string | null };

/** Pure (WS-B). One stage's own safety outcome: unsafe where its answer was; critical_missed where the stage is safety-critical and did
 * not score in full (a stage the learner marked themselves is their own judgement, never counted here); else safe. */
export function stageOutcome(stage: ScenarioStage, r: StageResult | undefined): SafetyOutcome {
  if (r?.unsafe) return "unsafe";
  return stage.safetyCritical && r && r.by !== "self" && r.score < 1 ? "critical_missed" : "safe";
}

/**
 * Pure (WS-B, rules v3). The stage results with the caps applied AT EACH STAGE (the rubric's scope) -- an unsafe stage keeps at most half
 * its score, a safety-critical failure none -- never to the other stages. Only where the caps are active; the outcome is always detected.
 * The record names the worst outcome, the first unsafe statement and the key points of the stages missed.
 */
export function capScenario(spec: ScenarioSpec, results: readonly StageResult[], policy: CapPolicy = CAPS_DEFAULT): { results: StageResult[]; safety: SafetyRecord | null } {
  const outcomes = spec.stages.map((st, i) => stageOutcome(st, results[i]));
  const capped = results.map((r, i) => ({ ...r, score: capForSafety({ correct: r.score === 1, score: r.score }, outcomes[i] ?? "safe", policy).score }));
  const worst = outcomes.reduce<SafetyOutcome>((w, o) => worstOutcome(w, o), "safe");
  const u = outcomes.indexOf("unsafe");
  const by: "code" | "ai" = outcomes.some((o, i) => o !== "safe" && results[i]?.by === "ai") ? "ai" : "code";
  return {
    results: capped,
    safety: safetyRecord(worst, { statement: u >= 0 ? results[u].unsafe ?? null : null, missed: spec.stages.filter((_, i) => outcomes[i] === "critical_missed").map(st => st.keyPoint), by, capped: policy.capsActive }),
  };
}

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
type Claims = { u: string; q: string; h: string; t: number; n: number; r: { s: number; b: StageResult["by"]; a: string; f?: string; x?: string }[]; e: Progress["evaluator"] };

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");
const mac = (secret: string, body: string) => createHmac("sha256", secret).update(body).digest("base64url");

/** Pure. A key for the token from a server-only secret (the caller supplies it; tests supply their own). */
export const tokenKey = (secret: string): string => createHash("sha256").update(`scholar-scenario-v1:${secret}`).digest("hex");

/** Pure. The token for the progress so far: bound to the learner, the question and its marking guide, and signed. */
export function signProgress(key: string, who: { userId: string; questionId: string; answer: unknown }, p: Progress, now: number): string {
  const claims: Claims = {
    u: who.userId, q: who.questionId, h: rubricHash(who.answer), t: now, n: p.next,
    r: p.results.map(x => ({ s: round2(x.score), b: x.by, a: x.answer.slice(0, 200), ...(x.feedback ? { f: x.feedback.slice(0, 600) } : {}), ...(x.unsafe ? { x: x.unsafe.slice(0, 300) } : {}) })), e: p.evaluator,
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
  return { next: c.n, results: c.r.map(x => ({ score: x.s, by: x.b, answer: x.a, feedback: x.f ?? null, ...(typeof x.x === "string" && x.x ? { unsafe: x.x } : {}) })), evaluator: c.e ?? null };
}

// ── NEW SCENARIOS FROM A PASSAGE ──

export type ScenarioRaw = { situation: string; stages: ScenarioStage[] };
/** Why a generated scenario was not well formed (codes only: they are counted in the audit). */
export type ScenarioParseWhy = "scenario_opening" | "scenario_stage_count" | "scenario_stage_shape" | "scenario_prompt" | "scenario_options" | "scenario_no_reveal" | "scenario_duplicate_stage";

/** Pure. A deterministic shuffle by seed (mcq/mrq options are stored shuffled so the key is not always first). */
function order(n: number, seed: string): number[] {
  const idx = [...Array(n).keys()];
  const h = createHash("sha256").update(seed).digest();
  for (let i = n - 1; i > 0; i--) { const j = h[i % h.length] % (i + 1); [idx[i], idx[j]] = [idx[j], idx[i]]; }
  return n >= 3 && idx.every((v, i) => v === i) ? [...idx.slice(1), idx[0]] : idx;
}

/**
 * Pure. The fields of a generated scenario, or why it is not well formed: a situation, two to four stages, each of a known kind with its own
 * key, every stage after the first revealing something, no two stages asking the same thing. An mcq or mrq stage is stored in a seeded shuffle
 * with the key remapped; a cloze stage's prompt must hold the blank.
 * STRICT (the default): any fault refuses the draft. LENIENT (the draft check): a fault in a stage AFTER the first leaves that stage out and
 * carries on (`skipped` says why), so one bad later stage does not cost an otherwise sound scenario; the first stage and the opening must be sound,
 * and at least two stages must remain.
 */
export function parseScenario(r: Record<string, unknown>, lenient = false): { sc: ScenarioRaw; skipped: ScenarioParseWhy[]; why?: undefined; detail?: undefined } | { sc?: undefined; skipped?: undefined; why: ScenarioParseWhy; detail?: string } {
  const situation = text(r.situation ?? r.stem, 800);
  const raw = Array.isArray(r.stages) ? r.stages : null;
  if (!situation) return { why: "scenario_opening" };
  if (!raw || raw.length < SCENARIO_STAGES_MIN || raw.length > SCENARIO_STAGES_MAX) return { why: "scenario_stage_count" };
  const stages: ScenarioStage[] = [];
  const skipped: ScenarioParseWhy[] = [];
  const seenPrompts = new Set<string>();
  let firstWhy: { why: ScenarioParseWhy; detail?: string } | null = null;
  for (let i = 0; i < raw.length; i++) {
    // A fault in this stage: refuse the draft (strict, or the first stage), or leave this stage out (lenient, a later stage).
    const bad = (why: ScenarioParseWhy, detail?: string): { why: ScenarioParseWhy; detail?: string } | null => {
      if (!lenient || i === 0) return { why, ...(detail ? { detail } : {}) };
      skipped.push(why); firstWhy ??= { why, ...(detail ? { detail } : {}) };
      return null;
    };
    const x = (raw[i] ?? {}) as Record<string, unknown>;
    const weight = x.weight === undefined ? 1 : x.weight;
    const prompt = text(x.prompt, 400);
    const correctRaw = Number.isInteger(x.correct) ? [x.correct as number] : x.correct;
    let f = !prompt ? bad("scenario_stage_shape", `stage ${i + 1}: prompt missing or over 400 characters`) : null;
    if (f) return f;
    if (!prompt) continue;
    const built = {
      reveal: typeof x.reveal === "string" ? x.reveal : "", prompt, kind: x.kind, options: strs(x.options)?.map(o => o.trim()), correct: correctRaw, accepted: strs(x.accepted)?.map(a => a.trim()).filter(Boolean),
      weight, keyPoint: x.keyPoint, source: x.source, refs: strs(x.references)?.map(t => t.replace(/[[\]\s]/g, "").toUpperCase()),
    };
    const s = stageOf(built);
    if (!s) { f = bad("scenario_stage_shape", `stage ${i + 1}: ${stageWhy(built)}`); if (f) return f; continue; }
    if (s.kind === "cloze" ? !s.prompt.includes(CLOZE_BLANK) : !asksQuestion(s.prompt)) { f = bad("scenario_prompt", `stage ${i + 1}: the prompt does not ask a question`); if (f) return f; continue; }
    if (s.options.length && new Set(s.options.map(norm)).size !== s.options.length) { f = bad("scenario_options", `stage ${i + 1}: two options are the same`); if (f) return f; continue; }
    if (i > 0 && !s.reveal) { f = bad("scenario_no_reveal", `stage ${i + 1}: nothing is revealed`); if (f) return f; continue; }
    if (seenPrompts.has(norm(s.prompt))) { f = bad("scenario_duplicate_stage", `stage ${i + 1}: the same question as an earlier stage`); if (f) return f; continue; }
    if (s.kind === "mcq" || s.kind === "mrq") {
      const shown = order(s.options.length, `${situation}:${i}:${s.options.join("|")}`);
      s.options = shown.map(k => s.options[k]);
      // correct (old indexes) -> where each now sits
      const old = (x.options as string[]).map(o => o.trim());
      s.correct = (correctRaw as number[]).map(k => s.options.indexOf(old[k])).sort((a, b) => a - b);
      if (s.correct.some(k => k < 0)) { f = bad("scenario_stage_shape", `stage ${i + 1}: a correct index is out of range`); if (f) return f; continue; }
    }
    seenPrompts.add(norm(s.prompt));
    stages.push(s);
  }
  if (stages.length < SCENARIO_STAGES_MIN) {
    const fw = firstWhy as { why: ScenarioParseWhy; detail?: string } | null; // the first stage left out says why there are too few
    return fw ? { why: fw.why, ...(fw.detail ? { detail: fw.detail } : {}) } : { why: "scenario_stage_count" };
  }
  return { sc: { situation, stages }, skipped };
}

/** Pure. The fields of a generated scenario, or null where it is not well formed (parseScenario says why). */
export const parseScenarioRaw = (r: Record<string, unknown>): ScenarioRaw | null => parseScenario(r).sc ?? null;

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
/** Pure. Whether the draft talks about notes, a passage or a student revising anywhere (the whole draft, before any stage is left out). */
export const scenarioIsMeta = (sc: ScenarioRaw): boolean => [sc.situation, ...sc.stages.flatMap(s => [s.reveal, s.prompt])].some(t => META.test(t));

export function scenarioFlaw(sc: ScenarioRaw): "not_a_scenario" | "answer_leaked" | "repeated_stage" | "reveal_not_new" | null {
  if ([sc.situation, ...sc.stages.flatMap(s => [s.reveal, s.prompt])].some(t => META.test(t))) return "not_a_scenario";
  for (let i = 0; i < sc.stages.length; i++) {
    const before = [sc.situation, ...sc.stages.slice(0, i).flatMap(s => [s.reveal, s.prompt])].join(" ");
    // A choice from several (mrq) is a leak only when the WHOLE key is already in the earlier text: one option of it ("respiratory rate") may just be the topic.
    const st = sc.stages[i], keys = stageAnswers(st);
    if (st.kind === "mrq" ? keys.every(a => containsAnswer(before, a)) : keys.some(a => containsAnswer(before, a))) return "answer_leaked";
  }
  // A reveal adds something (the prompt asks it to state what is now seen, measured, reported or found, not what someone plans): at least one clinical term the learner has not already been shown (the opening, an earlier reveal, an earlier question or its options).
  for (let i = 1; i < sc.stages.length; i++) {
    const rv = sc.stages[i].reveal;
    const seen = [sc.situation, ...sc.stages.slice(0, i).flatMap(s => [s.reveal, s.prompt, ...s.options])].join(" ");
    const mine = unsupportedTerms(rv, "").filter(w => !isNarrative(w));
    if (mine.length && !unsupportedTerms(mine.join(" "), seen).length) return "reveal_not_new";
  }
  // A later stage asks about the NEW information, never what an earlier stage already asked: two stages with the same answer, or resting on the same
  // sentence of the section, repeat each other.
  const sources = sc.stages.map(s => words(s.source).join(" ")).filter(Boolean);
  if (new Set(sources).size !== sources.length) return "repeated_stage";
  const keys = sc.stages.map(s => stageAnswers(s).map(a => contentWords(a).sort().join(" ")).filter(Boolean).sort().join("|"));
  if (new Set(keys).size !== keys.length) return "repeated_stage";
  return null;
}

// ── SHAPING A DRAFT: keep the stages that stand on their own ──

/** Words that point at THIS person or THIS moment: a question that has one is a question about the situation. */
const DEICTIC = /\b(?:the person|this person|the person's|their|they|them|he|she|his|her|this|these|now|currently|at this point|here|so far|you|your|the team|the colleague)\b/i;
/** The frames of a plain recall question: "which X is often...", "what is the...", "what does X stand for / combine / include", "according to...". */
const GENERIC = /\b(?:often|usually|typically|commonly|generally)\b|^(?:what|which) (?:is|are) (?:the|a|an)\b|\baccording to\b|\bstands? for\b|\bdefin(?:e|ed|ition)\b|\bwhat does \S+ (?:combine|include|mean)\b|\bwhich (?:\w+ ){0,3}(?:does|do) \S+ (?:combine|include)\b/i;

/**
 * Pure. Whether a stage's question is plain RECALL rather than a decision in the situation: it uses a recall frame ("which ... is often", "what is the",
 * "what does X stand for", "according to") without pointing at this person or this moment, or it says nothing that ties it to the opening or to what has
 * been revealed so far. `story` is the opening and the reveals up to and including this stage's own.
 */
export function isGenericQuestion(prompt: string, story: string): boolean {
  if (DEICTIC.test(prompt)) return false;
  if (GENERIC.test(prompt.trim())) return true;
  const mine = unsupportedTerms(prompt, "").filter(w => !isNarrative(w));
  return !mine.some(w => !unsupportedTerms(w, story).length);
}

/** A reveal that narrates an intention rather than a finding: "the team decides / plans / prepares / wants to ...". */
const PLAN = /\b(?:decid(?:es?|ed|ing)|plan(?:s|ned|ning)?|prepar(?:es?|ed|ing)|intend(?:s|ed)?|about to|going to|wants? to|needs? to|ready to|begins? to|starts? to)\b/i;

/**
 * Pure. Why ONE stage cannot stand in a scenario, given the stages already kept before it, or null:
 *   answer_leaked / repeated_stage / uncited_stage / reveal_not_new / ungrounded_reveal  -- the same rules as the whole-draft checks, applied to this stage alone.
 * `at` is its position among the kept stages (0 is the first, which reveals nothing).
 */
function stageProblem(situation: string, kept: readonly ScenarioStage[], st: ScenarioStage, passageText: string, references: ReadonlyMap<string, string>): string | null {
  const before = [situation, ...kept.flatMap(s => [s.reveal, s.prompt])].join(" ");
  // A decision about this person, not plain recall (the stage is left out; the first stage must stand).
  if (isGenericQuestion(st.prompt, [situation, ...kept.map(k => k.reveal), st.reveal].join(" "))) return "generic_question";
  const keys = stageAnswers(st);
  if (st.kind === "mrq" ? keys.every(a => containsAnswer(before, a)) : keys.some(a => containsAnswer(before, a))) return "answer_leaked";
  const keyOf = (x: ScenarioStage) => stageAnswers(x).map(a => contentWords(a).sort().join(" ")).filter(Boolean).sort().join("|");
  if (kept.some(k => (k.source && words(k.source).join(" ") === words(st.source).join(" ")) || keyOf(k) === keyOf(st))) return "repeated_stage";
  if (citationFlaw([st], passageText, references, unsupportedTerms)) return "uncited_stage";
  if (kept.length > 0) {
    // A reveal states what is now seen, measured, reported or found. One that only narrates what someone decides, plans or wants to do reveals nothing about the
    // person (the decision is the question): the stage is left out.
    if (PLAN.test(st.reveal)) return "reveal_plan";
    const seen = [situation, ...kept.flatMap(s => [s.reveal, s.prompt, ...s.options])].join(" ");
    const mine = unsupportedTerms(st.reveal, "").filter(w => !isNarrative(w));
    if (mine.length && !unsupportedTerms(mine.join(" "), seen).length) return "reveal_not_new";
    const known = [situation, passageText, ...references.values(), ...kept.map(k => k.reveal)].join(" ");
    if (clinicalGaps(st.reveal, known).length || textGroundingViolations(st.reveal, [known]).some(v => v.kind === "asserted_finding")) return "ungrounded_reveal";
  }
  return null;
}

/**
 * Pure. A draft cut to the stages that stand on their own: each stage, in order, is kept if it is cited, gives no earlier answer away, repeats
 * no kept stage, and (after the first) reveals something new and grounded. A stage that fails is LEFT OUT, never rewritten: nothing is added, so
 * nothing is invented. The first stage must stand (the reason is then the draft's) and at least two stages must remain (else the first reason
 * a stage was left out is the draft's). `pruned` lists why stages were left out (codes, for the audit and the probe).
 */
export function shapeScenario(sc: ScenarioRaw, passageText: string, references: ReadonlyMap<string, string>): { sc: ScenarioRaw; pruned: string[] } | { reason: string } {
  const kept: ScenarioStage[] = [], pruned: string[] = [];
  for (const [i, raw] of sc.stages.entries()) {
    // A key point that wanders beyond the sentence(s) the stage cites is replaced by that cited text itself (never by anything new): what the learner is told rests on the source.
    const base = raw.source && unsupportedTerms(raw.keyPoint, raw.source).length > 2 ? { ...raw, keyPoint: raw.source.length > 300 ? raw.source.slice(0, raw.source.lastIndexOf(" ", 300)) : raw.source } : raw;
    // A short answer the cited text does not state (an alternative from another sentence) is dropped from the accepted answers; if none is left the stage fails as uncited.
    const supported = base.source && (base.kind === "short" || base.kind === "cloze") ? base.accepted.filter(a => unsupportedTerms(a, base.source).length <= 1) : base.accepted;
    const st = supported.length && supported.length !== base.accepted.length ? { ...base, accepted: supported } : base;
    const p = stageProblem(sc.situation, kept, st, passageText, references);
    if (!p) kept.push(st);
    else if (kept.length === 0) return { reason: p };
    else pruned.push(`stage ${i + 1} left out: ${p}`);
  }
  if (kept.length < SCENARIO_STAGES_MIN) return { reason: (pruned[0] ?? "").replace(/^stage [0-9]+ left out: /, "") || "scenario_stage_count" };
  return { sc: { situation: sc.situation, stages: kept }, pruned };
}

// ── A STORED SCENARIO IS HELD TO THE CURRENT RULES TOO ──

/** Pure. The version number in a scenario prompt version ("scholar-scenario-v2+..." -> 2), or null (none, or not a scenario version). */
export const scenarioVersionOf = (v: string | null | undefined): number | null => {
  const m = /^scholar-scenario-v(\d+)/.exec(v ?? "");
  return m ? Number(m[1]) : null;
};
/** The oldest prompt version still offered: the current one. Earlier versions let an opening give a stage's answer away, and talked of notes and students. */
export const SCENARIO_MIN_VERSION = scenarioVersionOf(PROMPT_VERSIONS.scenario) ?? 2;

/**
 * Pure. Why a scenario ALREADY STORED must not be offered for a new attempt, or null when it may be. Written before the current rules existed
 * (prompt version below the current one, or none), no longer a sound scenario, or failing today's draft checks against its stored stages and
 * their citations:
 *   "stale_scenario"  old prompt version, missing version, unsound shape, or the section it cites can no longer be read;
 *   "not_a_scenario" | "answer_leaked" | "repeated_stage" | "uncited_stage"  as scenarioFlaw / citationFlaw say.
 * A stage that cites an approved reference was checked against it when written (the reference text is not kept with the item), so only a stage
 * quoting the section is re-checked against `passageText`. Nothing is deleted: the item and its attempts stay for history; it is simply not offered.
 */
export function storedScenarioProblem(q: { stem: string; answer: unknown; promptVersion: string | null | undefined }, passageText: string | null): string | null {
  const v = scenarioVersionOf(q.promptVersion);
  if (v === null || v < SCENARIO_MIN_VERSION) return "stale_scenario";
  const spec = scenarioSpecOf(q.answer);
  if (!spec || passageText === null) return "stale_scenario";
  const flaw = scenarioFlaw({ situation: q.stem, stages: spec.stages });
  if (flaw) return flaw;
  const quoting = spec.stages.filter(s => !s.refs.length);
  return citationFlaw(quoting, passageText, new Map(), unsupportedTerms);
}

// ── GROUNDING THE CLINICAL CONTENT, NOT THE STORY ── a scenario needs a person, a setting and a passing of time that the notes do not contain ──

/**
 * Words that carry the story (a person, a setting, time passing, connectors, plain verbs), not clinical content. The notes do not have them
 * and a scenario cannot be told without them, so they are never held to the notes. Clinical terms (an observation, a finding, a result, a
 * drug, a procedure) are not here and must be supported.
 */
const NARRATIVE = new Set((
  "person people patient patients man woman adult adults someone anyone ward hospital clinic clinics home department community team teams staff colleague colleagues " +
  "doctor doctors clinician clinicians member family relative relatives carer carers visitor visitors setting bed room medical surgical routine later shortly afterwards soon time times " +
  "morning afternoon evening night day days hour hours minute minutes today yesterday still already next earlier previous previously result results arrives arrive arrived " +
  "arriving come comes came coming back asked ask asks says say said tells told reports reported report notice notices noticed noticing seems seem seemed appears appear " +
  "appeared looks look looked feels feel felt becomes become became becoming remains remain remained stays stay stayed continues continue continued start starts started " +
  "begins begin began change changes changed changing recovering recovered admitted admission resting rest quiet awake comfortable settled unwell well worse better getting " +
  "gets get got goes went taken take takes took checked check checks done carried review reviewed called call calls informed also just only again another further " +
  "additional new news information details detail situation mentioned noted noting shows show showed shown worked work works working now present currently " +
  "observation observations notes describe describes described score scores give given gives giving needs need needed " +
  "visit visits visited visiting out nearby around beside near sitting sits sat lying lies lay standing walking walks walked talking talks talked speaking speaks spoke " +
  "arrival leaves left stay waiting waits waited called asks asked answers answered responds responded mention mentions " +
  "member members shift shifts less more earlier before after during while wants want decide decides decided pick picks condition conditions unit area areas " +
  "assess assessing assessed assessment looking looks review reviewing seen see sees saw find finds found early earliest indication indications changes " +
  "concern concerned concerns worried worry worrying thinks think thought wonders ready prepare prepares preparing prepared decision decisions reason reasons " +
  "something anything nothing everything others other one same different usual usually normal normally slightly slowly quickly quite rather bit lot " +
  "family friend friends husband wife son daughter mother father partner home bay corridor chair bedside trolley chart charts record records recorded recording " +
  "handover colleague senior junior called phone bleep speak speaks spoke speaking tell telling " +
  "several many few some single separate together bring brings structured judge telephone deteriorate deteriorates deteriorating deterioration help helps ask asking " +
  "sort set thorough fuller picture full whole complete join joined staff pass passes passed wider wide reassess reassessed reassessment reassessing closer close moves move moved care cared caring carers concerned concern bedside seems different before since last develop develops developed developing emerge emerges emerged comes arrives contact contacts contacted alert alerts alerted alerting informed inform informs begin begins begun joins joined involved involve").split(" "));
/** A word reduced to a root for the story-word test, so visits / visited / visiting are one. */
const rootOf = (w: string) => (w.length > 4 ? w.replace(/(ing|ed|es|s)$/, "").replace(/(.)\1$/, "$1") : w); // dropped -> drop
const NARRATIVE_ROOTS = new Set([...NARRATIVE].map(rootOf));
const isNarrative = (w: string) => NARRATIVE.has(w) || NARRATIVE_ROOTS.has(rootOf(w)) || /ly$/.test(w);

const NUMBERISH = /^(?:\d|zero$|one$|two$|three$|four$|five$|six$|seven$|eight$|nine$|ten$|eleven$|twelve$|thirteen$|fourteen$|fifteen$|sixteen$|seventeen$|eighteen$|nineteen$|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|half$|double$|triple$)/i;

/** Pure. The words of `text` the source never uses, leaving out the story words (NARRATIVE). */
export const clinicalGaps = (text: string, source: string): string[] => {
  const roots = new Set(words(source).map(rootOf)); // "drops" is the section's "drop"
  return unsupportedTerms(text, source).filter(w => !isNarrative(w) && !roots.has(rootOf(w)));
};

/**
 * Pure. Whether the CLINICAL content of a scenario rests on the cited sentences, or the first thing that does not:
 *   "ungrounded_number"   a figure, in digits or words, that the section and the cited references do not hold (a value, a dose, a count);
 *   "ungrounded_opening"  the opening names a finding the section does not hold (an asserted-finding word, or more than five clinical terms unsupported);
 *   "ungrounded_reveal"   a stage's new information names an observation, finding, result, drug or procedure that its cited sentence (or an earlier
 *                         stage's, or the opening it develops) does not support. The story words around it (a person, "some time later", the team) are not held.
 *   "ungrounded_rationale" the explanation shown with the feedback leans on more than four clinical terms the section does not hold.
 * The identifier screen is separate and stays on every word. A key and a key point are held by citationFlaw.
 */
export function scenarioGroundingFlaw(sc: ScenarioRaw, rationale: string, passageText: string, references: ReadonlyMap<string, string>): "ungrounded_number" | "ungrounded_opening" | "ungrounded_reveal" | "ungrounded_rationale" | null {
  const refAll = [...references.values()];
  const corpus = [passageText, ...refAll];
  const all = [sc.situation, rationale, ...sc.stages.flatMap(s => [s.reveal, s.prompt, ...s.options, ...s.accepted, s.keyPoint])].filter(Boolean).join("\n");
  if (textGroundingViolations(all, corpus).some(v => v.kind === "ungrounded_number" && NUMBERISH.test(v.token))) return "ungrounded_number";
  // The existing screen sees digits and some spelled counts; a spelled figure of the story ("Thirty minutes later") is also a figure the section does not hold.
  const held = new Set(words(corpus.join(" ")));
  if (words(all).some(w => w !== "one" && NUMBERISH.test(w) && !held.has(w))) return "ungrounded_number";
  if (textGroundingViolations(sc.situation, corpus).some(v => v.kind === "asserted_finding") || clinicalGaps(sc.situation, corpus.join(" ")).length > 5) return "ungrounded_opening";
  // A reveal's clinical terms must be ones the section (or a cited reference) holds, or that the story has already shown. The stage's own citation is held
  // to its key and key point (citationFlaw); a finding in a reveal may rest on another sentence of the same section.
  let known = [sc.situation, passageText, ...refAll].join(" ");
  for (const st of sc.stages) {
    if (st.reveal && (clinicalGaps(st.reveal, known).length || textGroundingViolations(st.reveal, [known]).some(v => v.kind === "asserted_finding"))) return "ungrounded_reveal";
    known = `${known} ${st.reveal}`;
  }
  if (clinicalGaps(rationale, corpus.join(" ")).length > 4) return "ungrounded_rationale";
  return null;
}

/** Pure. How many stages each kept scenario has (counts only, for the audit: a thin passage supports two, a richer one three or four). */
export const scenarioStageCounts = (drafts: readonly { answer: unknown }[]): number[] => drafts.map(d => scenarioSpecOf(d.answer)?.stages.length ?? 0);

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
