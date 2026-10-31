/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash } from "node:crypto";
import {
  answeredView, blueprintCompetencies, caseClosing, endsOnReaching, learnerView, nextStage, professionsOf, resolveOptions, resolveToken, safetyEvents, variationWithinBounds, viewToken, visibleFacts,
  type Blueprint, type CaseClosing, type LearnerView,
} from "./blueprint";
import { REASONING_CAPS } from "./categories";
import { caseLibraryEnabled, loadCasePolicy } from "./policy";
import { RANK_POOL, rankLibraryCases, type RankGaps } from "./ranking";

// ── C4: COST-OPTIMISED CASE DELIVERY ── COMPETEN-HOLDINGS-AI-CONSUMPTION-01 s10, IND-004 D-a to D-e, migrations 422-423 ──
//
// Scholar's "offer a library case first" entry (IND-004) calls these, server-side. A library case is delivered from
// its STORED blueprint with deterministic progression: no AI, no AI-standing check, no charge (D-e). Live AI with a
// stored case is a separate, attributed call (case.live_with_stored, the student's own) that Scholar makes with
// resolveOwner and runOwnedAi, naming caseSessionRecord(sessionId) so its spend is counted against the session.
//
// ⚠ ONLY WHAT IS DELIVERABLE (D-d). A search returns ONLY versions that are published AND hold an approved 395 record
// of their exact version (case_library_deliverable). A session can only start on one (423 refuses otherwise).
// A superseded or retired version is returned, labelled "no longer current", only to a student who already has a
// session on that exact version (D-a).
//
// ⚠ THE SERVER KEEPS THE CASE. The full blueprint and the session's progress stay here. The browser gets
// learnerView and answeredView, with tokens it hands back. A variation picks values only inside the approved rules
// (variationWithinBounds), so a varied case is still the approved version.
//
// ⚠ ONE SESSION RECORD FOR A LIBRARY PLAY (migration 424, coordinator decision on the Stage 5A overlap). Scholar's
// AI reasoning feedback on an answered decision, and the end-of-case debrief, are written here, onto the session --
// never into a second store. Each is an AI EVALUATION naming the provider, model and request that produced it, and the
// database keeps it append-only. It is never an approval, a mark or a competence judgement.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const missing = (e: any) => /does not exist|schema cache|could not find/i.test(e?.message ?? "");

export type LibraryOffer = {
  versionId: string; caseId: string; code: string; title: string; intro: string | null; level: string; risk: string;
  competencyIds: string[]; specialtyTermIds: string[];
  /** Why this case is offered for this learner (rankLibraryCases): short reasons, never the blueprint. Empty when nothing in particular. */
  why?: string[];
};
export const caseSessionRecord = (sessionId: string) => ({ type: "case_library_session", ref: sessionId });

/** Pure: does a stored case fit what was asked? Competency, topic, level and clinical context, all optional. */
export function caseMatches(v: { content: any; level: string; competencyIds: string[] }, q: { competencyIds?: string[]; topic?: string; level?: string; context?: { professionTermId?: string | null; specialtyTermIds?: string[] } }): boolean {
  if (q.level && v.level !== q.level) return false;
  if (q.competencyIds?.length && !q.competencyIds.some(c => v.competencyIds.includes(c))) return false;
  const md = v.content?.metadata ?? {};
  const professions = professionsOf(md);   // a case may be for several professions (owner, Stage 5B classification)
  if (q.context?.professionTermId && professions.length && !professions.includes(q.context.professionTermId)) return false;
  if (q.context?.specialtyTermIds?.length && Array.isArray(md.specialtyTermIds) && md.specialtyTermIds.length && !q.context.specialtyTermIds.some(s => md.specialtyTermIds.includes(s))) return false;
  if (q.topic?.trim()) {
    const words = q.topic.toLowerCase().split(/\W+/).filter(w => w.length > 2);
    const hay = [v.content?.title, v.content?.summary, ...(v.content?.learningObjectives ?? []).map((l: any) => l?.text)].filter(Boolean).join(" ").toLowerCase();
    if (words.length && !words.some(w => hay.includes(w))) return false;
  }
  return true;
}

/**
 * Search the governed library. Published AND approved for the exact version, or nothing (D-d). null = unreadable.
 * The filter is caseMatches, unchanged; what passed is then RANKED (ranking.ts: competency, topic, the learner's
 * gaps, level) and only the best are checked for delivery, so the offer limit never cuts off the most relevant case.
 */
export async function findLibraryCases(admin: any, q: {
  competencyIds?: string[]; topic?: string; level?: string; context?: { professionTermId?: string | null; specialtyTermIds?: string[] };
  excludeVersionIds?: string[]; limit?: number;
  /** Ranking only (never a filter): the learner's gaps from their latest evaluation, and the level their work is pitched at. */
  gaps?: RankGaps | null; learnerLevel?: string | null;
} = {}): Promise<LibraryOffer[] | null> {
  if (!(await caseLibraryEnabled(admin))) return [];
  const policy = await loadCasePolicy(admin);
  const limit = Math.min(policy.offerLimit, Math.max(1, q.limit ?? policy.offerLimit));
  const { data: versions, error } = await admin.from("case_library_version").select("id, case_id, level, risk, content, published_at")
    .eq("state", "published").order("published_at", { ascending: false }).limit(300);
  if (error) return missing(error) ? [] : null;
  const ids = (versions ?? []).map((v: any) => v.id).filter((id: string) => !(q.excludeVersionIds ?? []).includes(id));
  if (!ids.length) return [];
  const [{ data: links, error: lErr }, { data: cases, error: cErr }] = await Promise.all([
    admin.from("case_library_version_competency").select("version_id, competency_id").in("version_id", ids),
    admin.from("case_library_case").select("id, code, status").in("id", [...new Set((versions ?? []).map((v: any) => v.case_id))]),
  ]);
  if (lErr || cErr) return null;
  const caseOf = new Map<string, any>((cases ?? []).map((c: any) => [c.id, c]));
  const fit: (LibraryOffer & { objectives: string[]; summary: string | null })[] = [];
  for (const v of versions ?? []) {                                       // newest first: the order ties keep
    if (!ids.includes(v.id) || caseOf.get(v.case_id)?.status !== "active") continue;
    const competencyIds = (links ?? []).filter((l: any) => l.version_id === v.id).map((l: any) => l.competency_id);
    if (!caseMatches({ content: v.content, level: v.level, competencyIds }, q)) continue;
    fit.push({ versionId: v.id, caseId: v.case_id, code: caseOf.get(v.case_id).code, title: v.content?.title ?? "Clinical case",
      intro: v.content?.learnerIntro ?? v.content?.patient?.presentingComplaint ?? null, level: v.level, risk: v.risk, competencyIds,
      specialtyTermIds: Array.isArray(v.content?.metadata?.specialtyTermIds) ? v.content.metadata.specialtyTermIds : [],
      objectives: (v.content?.learningObjectives ?? []).map((l: any) => l?.text).filter((t: unknown): t is string => typeof t === "string"), summary: v.content?.summary ?? null });
  }
  const ranked = rankLibraryCases(fit, { topic: q.topic, competencyIds: q.competencyIds, gaps: q.gaps, level: q.learnerLevel }).slice(0, Math.max(RANK_POOL, limit));
  const out: LibraryOffer[] = [];
  for (const r of ranked) {
    if (out.length >= limit) break;
    const { data: ok, error: dErr } = await admin.rpc("case_library_deliverable", { p_version: r.versionId });
    if (dErr) return null;
    if (ok !== true) continue;
    const { objectives: _o, summary: _s, score: _sc, why, ...offer } = r;     // nothing of the blueprint but the title and opening
    void _o; void _s; void _sc;
    out.push({ ...offer, why });
  }
  return out;
}

export type LoadedCase = { versionId: string; approval: { state: "approved"; approvedAt: string | null }; risk: string; current: boolean; blueprint: Blueprint;
  /** The database's own hash of the version content (422): what an attempt record names it by. */
  contentHash?: string };

/** One library case, SERVER-SIDE ONLY (D-b). Deliverable, or -- for a student resuming that exact version -- labelled. */
export async function loadLibraryCase(admin: any, versionId: string, opts: { resumeFor?: string } = {}): Promise<LoadedCase | null> {
  if (!UUID.test(versionId) || !(await caseLibraryEnabled(admin))) return null;
  const { data: v, error } = await admin.from("case_library_version").select("id, state, risk, content, content_hash").eq("id", versionId).maybeSingle();
  if (error || !v) return null;
  const { data: deliverable } = await admin.rpc("case_library_deliverable", { p_version: versionId });
  let current = deliverable === true;
  if (!current) {
    if (!opts.resumeFor || !UUID.test(opts.resumeFor) || !["superseded", "retired"].includes(v.state)) return null;
    const { data: s } = await admin.from("case_library_session").select("id").eq("user_id", opts.resumeFor).eq("version_id", versionId).limit(1);
    if (!s?.length) return null;
    const { data: approved } = await admin.rpc("case_library_approved", { p_version: versionId });
    if (approved !== true) return null;
    current = false;
  }
  const { data: ccv } = await admin.from("clinical_content_version").select("id").eq("case_version_id", versionId).eq("content_kind", "case");
  const { data: ds } = ccv?.length ? await admin.from("clinical_review_decision").select("created_at").in("version_id", ccv.map((c: any) => c.id)).eq("decision", "approved").order("created_at", { ascending: false }).limit(1) : { data: [] };
  return { versionId, approval: { state: "approved", approvedAt: ds?.[0]?.created_at ?? null }, risk: v.risk, current, blueprint: v.content as Blueprint, contentHash: v.content_hash };
}

/** Pure: a variation chosen from the approved rules, deterministically from a seed. Empty when none or disabled. */
export function pickVariation(b: Blueprint, seed: string, enabled: boolean): Record<string, string> {
  if (!enabled) return {};
  const out: Record<string, string> = {};
  for (const r of b.variation?.rules ?? []) {
    const h = parseInt(createHash("sha256").update(`${seed}\u0000${r.factId}`).digest("hex").slice(0, 8), 16);
    if (r.values?.length) out[r.factId] = r.values[h % r.values.length];
    else if (r.range) { const steps = Math.round((r.range.max - r.range.min) * 10); out[r.factId] = (r.range.min + (steps ? h % (steps + 1) : 0) / 10).toFixed(1); }
  }
  return variationWithinBounds(b, out) ? out : {};
}

/** Pure: the blueprint with an in-bounds variation applied. Anything out of bounds is ignored, never applied. */
export function applyVariation(b: Blueprint, variation: Record<string, string>): Blueprint {
  if (!Object.keys(variation).length || !variationWithinBounds(b, variation)) return b;
  return { ...b, facts: b.facts.map(f => (variation[f.id] !== undefined ? { ...f, value: variation[f.id] } : f)) };
}

type AiEntry = { kind: "ai_evaluation"; provider: string; model: string; modelVersion?: string | null; policyVersion?: string | null; requestId: string; text: string; at: string };
type SessionRow = { id: string; user_id: string; version_id: string; view_salt: string; variation: Record<string, string>; reached_stage_ids: string[];
  revealed_fact_ids: string[]; answers: { decisionPointId: string; chosen: string[]; text?: string; reason?: string; at: string; safety: number }[]; safety_events: number; status: string;
  feedback?: (AiEntry & { decisionPointId: string })[]; debrief?: AiEntry | null };
/** What a learner is shown of an AI evaluation: always labelled as one, with the model that wrote it. */
export type AiEvaluationView = { label: "AI evaluation"; text: string; provider: string; model: string; at: string };
export type SessionView = { sessionId: string; status: string; current: boolean; view: LearnerView; answered: string[];
  feedback: (AiEvaluationView & { decisionToken: string })[]; debrief: AiEvaluationView | null;
  /** The learner's own "why" for the choices where the case asked, by decision token (kept with the answer). */
  reasons: Record<string, string>;
  /** Each answered decision as answeredView shows it (the key and rationales, AFTER answering), by decision token: what a resumed play shows again. */
  answeredViews: Record<string, ReturnType<typeof answeredView>>;
  /** Once the case has ended: its reflection prompt and the optional reasoning sections. null while it is in progress. */
  closing: CaseClosing | null };
/** What Scholar passes when it records an AI evaluation: the generation's own provider, model and request id. */
export type AiEvaluation = { provider: string; model: string; modelVersion?: string | null; policyVersion?: string | null; requestId: string; text: string };

async function sessionFor(admin: any, userId: string, sessionId: string): Promise<{ s: SessionRow; c: LoadedCase; b: Blueprint } | null> {
  if (!UUID.test(userId) || !UUID.test(sessionId)) return null;
  const { data: s, error } = await admin.from("case_library_session").select("*").eq("id", sessionId).eq("user_id", userId).maybeSingle();
  if (error || !s) return null;
  const c = await loadLibraryCase(admin, s.version_id, { resumeFor: userId });
  if (!c) return null;
  return { s, c, b: applyVariation(c.blueprint, s.variation ?? {}) };
}

function viewOf(x: { s: SessionRow; c: LoadedCase; b: Blueprint }, hints: boolean): SessionView {
  const view = learnerView(x.b, { reachedStageIds: x.s.reached_stage_ids, revealedFactIds: x.s.revealed_fact_ids }, x.s.view_salt, { hints });
  const shown = (e: AiEntry): AiEvaluationView => ({ label: "AI evaluation", text: e.text, provider: e.provider, model: e.model, at: e.at });
  return { sessionId: x.s.id, status: x.s.status, current: x.c.current, view, answered: x.s.answers.map(a => viewToken(x.s.view_salt, "decision", a.decisionPointId)),
    feedback: (x.s.feedback ?? []).map(f => ({ ...shown(f), decisionToken: viewToken(x.s.view_salt, "decision", f.decisionPointId) })),
    debrief: x.s.debrief ? shown(x.s.debrief) : null,
    reasons: Object.fromEntries(x.s.answers.filter(a => typeof a.reason === "string" && a.reason).map(a => [viewToken(x.s.view_salt, "decision", a.decisionPointId), a.reason as string])),
    answeredViews: Object.fromEntries(x.s.answers.map(a => [viewToken(x.s.view_salt, "decision", a.decisionPointId), answeredView(x.b, a.decisionPointId, a.chosen ?? [], x.s.view_salt)])),
    closing: x.s.status === "completed" ? caseClosing(x.b) : null };
}

/**
 * SCHOLAR-CASE-INTEGRITY-01 (810): what a completed attempt of the caller's own library session was played against and
 * did, for Scholar's immutable attempt record. SERVER-SIDE ONLY: it carries the blueprint (the variation applied), so
 * it must never reach a browser. Read only: nothing here writes the session.
 */
export type SessionAttemptSource = {
  versionId: string; contentHash: string | null; current: boolean; status: string; completedAt: string | null; blueprint: Blueprint; variation: Record<string, string>;
  reached: string[]; revealed: string[]; answers: SessionRow["answers"]; feedback: { decisionPointId: string; text: string; model: string; provider: string; at: string }[];
  debrief: { text: string; model: string; provider: string; at: string } | null;
};
export async function sessionAttemptSource(admin: any, userId: string, sessionId: string): Promise<SessionAttemptSource | null> {
  const x = await sessionFor(admin, userId, sessionId);
  if (!x) return null;
  return {
    versionId: x.s.version_id, contentHash: x.c.contentHash ?? null, current: x.c.current, status: x.s.status, completedAt: (x.s as any).completed_at ?? null,
    blueprint: x.b, variation: x.s.variation ?? {}, reached: x.s.reached_stage_ids, revealed: x.s.revealed_fact_ids, answers: x.s.answers,
    feedback: (x.s.feedback ?? []).map(f => ({ decisionPointId: f.decisionPointId, text: f.text, model: f.model, provider: f.provider, at: f.at })),
    debrief: x.s.debrief ? { text: x.s.debrief.text, model: x.s.debrief.model, provider: x.s.debrief.provider, at: x.s.debrief.at } : null,
  };
}

/** Pure: an AI evaluation entry as the database will accept it (424), or null when it would be refused. */
export function aiEntry(e: AiEvaluation, at: string): AiEntry | null {
  const t = (v: unknown, lo: number, hi: number) => (typeof v === "string" && v.trim().length >= lo && v.trim().length <= hi ? v.trim() : null);
  const provider = t(e?.provider, 1, 40), model = t(e?.model, 1, 120), requestId = t(e?.requestId, 8, 200), text = t(e?.text, 1, 8000);
  if (!provider || !model || !requestId || !text) return null;
  return { kind: "ai_evaluation", provider, model, modelVersion: t(e.modelVersion, 1, 120), policyVersion: t(e.policyVersion, 1, 200), requestId, text, at };
}

/** What AI feedback on ONE answered written decision needs. SERVER-SIDE ONLY: it carries the expected response. */
export type FeedbackContext = {
  versionId: string;
  prompt: string;
  expectedResponse: string;
  rubric: { criterion: string; dimension?: string }[];
  answer: string;
  visibleFacts: { label: string; value: string; unit: string | null }[];
  competencyIds: string[];
};
export type FeedbackContextError = { error: "not_answered" | "not_free_text" | "no_session" | "already_has_feedback" };

/**
 * Pure: the narrow context for evaluating ONE answered free-text decision -- its prompt, expected response and rubric
 * (for the AI evaluator, after the answer), the student's own text, the facts the student had SEEN, and the
 * competencies for the risk subject. Never an option key, never another decision, never a fact the student had not
 * seen.
 */
export function feedbackContextFrom(b: Blueprint, s: Pick<SessionRow, "reached_stage_ids" | "revealed_fact_ids" | "answers" | "feedback">, dpId: string)
  : Omit<FeedbackContext, "versionId"> | FeedbackContextError {
  const d = b.decisionPoints.find(x => x.id === dpId);
  const a = s.answers.find(x => x.decisionPointId === dpId);
  if (!d || !a) return { error: "not_answered" };
  if (d.kind !== "free_text" || typeof a.text !== "string" || !a.text.trim()) return { error: "not_free_text" };
  if ((s.feedback ?? []).some(f => f.decisionPointId === dpId)) return { error: "already_has_feedback" };
  const seen = visibleFacts(b, { reachedStageIds: s.reached_stage_ids, revealedFactIds: s.revealed_fact_ids });
  return {
    prompt: d.prompt, expectedResponse: d.expectedResponse ?? "", answer: a.text,
    rubric: (d.rubric ?? []).map(c => ({ criterion: c.criterion, ...(c.dimension ? { dimension: c.dimension } : {}) })),
    visibleFacts: b.facts.filter(f => seen.has(f.id)).map(f => ({ label: f.label, value: f.value, unit: f.unit ?? null })),
    competencyIds: blueprintCompetencies(b),
  };
}

/**
 * The context Scholar's AI evaluator needs for ONE answered written decision of the caller's own library session.
 * SERVER-SIDE ONLY: never return it to a browser (static K12). The variation the session was delivered with applies.
 */
export async function sessionFeedbackContext(admin: any, userId: string, sessionId: string, decisionToken: string): Promise<FeedbackContext | FeedbackContextError> {
  const x = await sessionFor(admin, userId, sessionId);
  if (!x) return { error: "no_session" };
  const dpId = resolveToken(x.b, x.s.view_salt, "decision", decisionToken);
  if (!dpId) return { error: "not_answered" };
  const c = feedbackContextFrom(x.b, x.s, dpId);
  return "error" in c ? c : { versionId: x.s.version_id, ...c };
}

/**
 * Record Scholar's AI reasoning feedback on ONE answered decision of a library session (CR4). Appended, never
 * rewritten (424). Two writers at once: the second is refused by the append-only check and may retry.
 */
export async function recordSessionFeedback(admin: any, userId: string, sessionId: string, decisionToken: string, e: AiEvaluation): Promise<SessionView | { error: string }> {
  const x = await sessionFor(admin, userId, sessionId);
  if (!x) return { error: "No such session." };
  const dpId = resolveToken(x.b, x.s.view_salt, "decision", decisionToken);
  if (!dpId || !x.s.answers.some(a => a.decisionPointId === dpId)) return { error: "Feedback is only on a decision you have answered." };
  const entry = aiEntry(e, new Date().toISOString());
  if (!entry) return { error: "That feedback is not a complete AI evaluation." };
  const { data: s, error } = await admin.from("case_library_session").update({ feedback: [...(x.s.feedback ?? []), { decisionPointId: dpId, ...entry }] }).eq("id", x.s.id).select("*").single();
  if (error || !s) return { error: /append-only/i.test(error?.message ?? "") ? "Feedback was added meanwhile. Try again." : "The feedback could not be recorded just now." };
  return viewOf({ ...x, s }, false);
}

/** Record the end-of-case AI debrief of a COMPLETED library session. Once (424). */
export async function recordSessionDebrief(admin: any, userId: string, sessionId: string, e: AiEvaluation): Promise<SessionView | { error: string }> {
  const x = await sessionFor(admin, userId, sessionId);
  if (!x) return { error: "No such session." };
  if (x.s.status !== "completed") return { error: "The debrief comes at the end of the case." };
  if (x.s.debrief) return { error: "This case already has its debrief." };
  const entry = aiEntry(e, new Date().toISOString());
  if (!entry) return { error: "That debrief is not a complete AI evaluation." };
  const { data: s, error } = await admin.from("case_library_session").update({ debrief: entry }).eq("id", x.s.id).is("debrief", null).select("*").single();
  if (error || !s) return { error: "The debrief could not be recorded just now." };
  return viewOf({ ...x, s }, false);
}

/** Start a session on a deliverable case. The database refuses any other (423). No AI, no charge. */
export async function startCaseSession(admin: any, userId: string, versionId: string, opts: { hints?: boolean } = {}): Promise<SessionView | { error: string }> {
  if (!UUID.test(userId) || !UUID.test(versionId)) return { error: "No such case." };
  const c = await loadLibraryCase(admin, versionId);
  if (!c || !c.current) return { error: "This case is not available." };
  const policy = await loadCasePolicy(admin);
  const first = c.blueprint.stages[0]?.id;
  if (!first) return { error: "This case has no stages." };
  const variation = pickVariation(c.blueprint, `${userId}:${versionId}:${Date.now()}`, policy.variationsEnabled);
  const { data: s, error } = await admin.from("case_library_session").insert({ user_id: userId, version_id: versionId, variation, reached_stage_ids: [first] }).select("*").single();
  if (error || !s) return { error: /only a published case approved/i.test(error?.message ?? "") ? "This case is not available." : "The case could not be started just now." };
  return viewOf({ s, c, b: applyVariation(c.blueprint, variation) }, !!opts.hints);
}

/** The learner's view of their own session. */
export async function caseSessionView(admin: any, userId: string, sessionId: string, opts: { hints?: boolean } = {}): Promise<SessionView | null> {
  const x = await sessionFor(admin, userId, sessionId);
  return x ? viewOf(x, !!opts.hints) : null;
}

/** Ask for a fact. Only one a decision on the CURRENT stage permits, and only while the session is open. */
export async function revealInSession(admin: any, userId: string, sessionId: string, factToken: string): Promise<SessionView | { error: string }> {
  const x = await sessionFor(admin, userId, sessionId);
  if (!x) return { error: "No such session." };
  if (x.s.status !== "in_progress") return { error: "This session is finished." };
  const factId = resolveToken(x.b, x.s.view_salt, "fact", factToken);
  const stage = x.s.reached_stage_ids[x.s.reached_stage_ids.length - 1];
  const permitted = x.b.decisionPoints.filter(d => d.stageId === stage && !x.s.answers.some(a => a.decisionPointId === d.id)).flatMap(d => d.permittedReveals);
  if (!factId || !permitted.includes(factId)) return { error: "That cannot be asked for here." };
  if (x.s.revealed_fact_ids.includes(factId)) return viewOf(x, false);
  const revealed = [...x.s.revealed_fact_ids, factId];
  const { data: s, error } = await admin.from("case_library_session").update({ revealed_fact_ids: revealed }).eq("id", x.s.id).eq("status", "in_progress").select("*").single();
  if (error || !s) return { error: "That could not be recorded just now." };
  return viewOf({ ...x, s }, false);
}

/** Pure: apply one answer to a session's state, by the blueprint's own rules. */
export function applyAnswer(b: Blueprint, s: Pick<SessionRow, "reached_stage_ids" | "revealed_fact_ids" | "answers">, dpId: string, chosen: string[], text: string | null, at: string, reason: string | null = null)
  : { error: string } | { reached: string[]; revealed: string[]; answers: SessionRow["answers"]; completed: boolean; safety: number } {
  const stage = s.reached_stage_ids[s.reached_stage_ids.length - 1];
  const d = b.decisionPoints.find(x => x.id === dpId);
  if (!d || d.stageId !== stage) return { error: "That decision is not on the current stage." };
  if (s.answers.some(a => a.decisionPointId === dpId)) return { error: "That decision is already answered." };
  if (d.kind === "single" && chosen.length !== 1) return { error: "Choose one option." };
  if (d.kind === "multiple" && chosen.length < 1) return { error: "Choose at least one option." };
  if (d.kind === "free_text" && !(text ?? "").trim()) return { error: "Write your answer." };
  const events = d.kind === "free_text" ? [] : safetyEvents(b, d.id, chosen);
  // "Explain your choice": kept beside the choice when the decision asks for it. It never changes the marking.
  const why = d.kind !== "free_text" && d.askReason === true && (reason ?? "").trim() ? (reason ?? "").trim().slice(0, REASONING_CAPS.reason) : null;
  const answers = [...s.answers, { decisionPointId: d.id, chosen: d.kind === "free_text" ? [] : chosen, ...(d.kind === "free_text" ? { text: (text ?? "").slice(0, 4000) } : {}), ...(why ? { reason: why } : {}), at, safety: events.length }];
  const stageDps = b.decisionPoints.filter(x => x.stageId === stage);
  let reached = [...s.reached_stage_ids], revealed = [...s.revealed_fact_ids], completed = false;
  if (stageDps.every(x => answers.some(a => a.decisionPointId === x.id))) {
    // R2: only a stage with exactly one single-choice decision branches on its answer, so this is unambiguous.
    const branchOn = stageDps.length === 1 && stageDps[0].kind === "single" ? answers.find(a => a.decisionPointId === stageDps[0].id)!.chosen : [];
    const nx = nextStage(b, stage, branchOn);
    revealed = [...new Set([...revealed, ...nx.consequenceFactIds])];
    if (nx.stageId) { reached = [...reached, nx.stageId]; if (endsOnReaching(b, nx.stageId)) completed = true; } else completed = true;
  }
  return { reached, revealed, answers, completed, safety: events.length };
}

/** Answer a decision. Deterministic: the key, the safety criteria and the progression are the blueprint's. */
export async function answerInSession(admin: any, userId: string, sessionId: string, args: { decisionToken: string; optionTokens?: string[]; text?: string | null; reason?: string | null })
  : Promise<{ answered: ReturnType<typeof answeredView>; session: SessionView } | { error: string }> {
  const x = await sessionFor(admin, userId, sessionId);
  if (!x) return { error: "No such session." };
  if (x.s.status !== "in_progress") return { error: "This session is finished." };
  const dpId = resolveToken(x.b, x.s.view_salt, "decision", args.decisionToken);
  if (!dpId) return { error: "No such decision." };
  const d = x.b.decisionPoints.find(p => p.id === dpId)!;
  const chosen = d.kind === "free_text" ? [] : resolveOptions(x.b, x.s.view_salt, dpId, args.optionTokens ?? []);
  if (chosen === null) return { error: "Choose from this decision's options." };
  const r = applyAnswer(x.b, x.s, dpId, chosen, args.text ?? null, new Date().toISOString(), args.reason ?? null);
  if ("error" in r) return r;
  const { data: s, error } = await admin.from("case_library_session").update({
    reached_stage_ids: r.reached, revealed_fact_ids: r.revealed, answers: r.answers, safety_events: x.s.safety_events + r.safety,
    ...(r.completed ? { status: "completed" } : {}),
  }).eq("id", x.s.id).eq("status", "in_progress").select("*").single();
  if (error || !s) return { error: "Your answer could not be recorded just now." };
  return { answered: answeredView(x.b, dpId, chosen, x.s.view_salt), session: viewOf({ ...x, s }, false) };
}
