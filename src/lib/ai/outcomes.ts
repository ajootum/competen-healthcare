// AI OUTCOMES, LEARNER FEEDBACK AND THE QUALITY-AND-COST VIEW ── COMPETEN-SCHOLAR-AI-OPT-01 (Wave 1) ─────────────
//
// ⚠ NOT A NEW AI ENGINE OR A SECOND USAGE LOG. plat_ai_requests (055, 371) stays the record of every model call and
// its cost. What it could not say is whether a call produced anything a learner kept: one learner action makes
// several calls (write, check blind, retry once) and nothing tied them together. Migration 600 adds the action id on
// each call, one outcome row per action, and optional learner feedback. This module writes and reads them.
//
// ⚠ CODES ONLY. Nothing here stores text: no question, note, passage, generated content or clinical detail, and no
// user id. A material key and a feedback key are sha256 digests over the user id and the content, computed here, so
// a row cannot be read back to a person or a passage.
//
// ⚠ FAIL-SOFT, like recordAiUsage. Before migration 600 is applied the writes are skipped and the reads say "not
// measured" -- never zero. Telemetry must never break the learner action that produced it.
/* eslint-disable @typescript-eslint/no-explicit-any */

import { createHash } from "node:crypto";

export type AiProductCode = "scholar" | "professional" | "practice" | "enterprise" | "holdings";
export type AiOutputKind = "explanation" | "question" | "case" | "other";
export type AiOutcome = "accepted" | "partial" | "rejected" | "redirected" | "error";
export type Sufficiency = "sufficient" | "simpler" | "insufficient" | "uncertain" | "not_assessed";
export const FEEDBACK_REASONS = ["inaccurate", "unclear", "difficulty", "relevance", "evidence"] as const;
export type FeedbackReason = (typeof FEEDBACK_REASONS)[number];

export type AiOutcomeEntry = {
  actionId: string;
  product: AiProductCode;
  /** The operation without its product prefix: questions_mcq, case_steps, case_blueprint, learn:teach ... */
  activity: string;
  operation?: string | null;
  outputKind: AiOutputKind;
  outcome: AiOutcome;
  accepted?: number;
  rejected?: number;
  /** Rejection reason CODES (the checks' own kinds). Anything after ':' or '(' is detail and is cut off here. */
  reasons?: readonly string[];
  sufficiency?: Sufficiency;
  generationAttempts?: number;
  verifyAttempts?: number;
  promptVersion?: string | null;
  configVersion?: string | null;
  materialKey?: string | null;
};

export const sha256Hex = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

/**
 * Pure. One way to say "this learner, this activity, this material, under these versions", for the identical-retry
 * guard. The parts are joined with a separator that cannot occur in a uuid or a version, and the contents are sorted
 * so the same sections in another order are the same material.
 */
export function materialKey(p: { userId: string; activity: string; versions: readonly (string | null | undefined)[]; contents: readonly string[] }): string {
  const norm = (s: string) => s.replace(/\s+/g, " ").trim();
  return sha256Hex([p.userId, p.activity, ...p.versions.map(v => v ?? ""), ...[...p.contents].map(norm).sort()].join("\u0000"));
}

/** Pure. accepted / partial / rejected from counts. */
export function outcomeOf(accepted: number, rejected: number): AiOutcome {
  return accepted > 0 ? (rejected > 0 ? "partial" : "accepted") : "rejected";
}

/** Pure. Reason codes only: the kind before any detail, lower-case, deduplicated, at most 20. */
export function reasonCodes(list: readonly string[] | undefined): string[] {
  const out = new Set<string>();
  for (const r of list ?? []) {
    const code = String(r).split(/[:(\s]/)[0].toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 40);
    if (code) out.add(code);
    if (out.size >= 20) break;
  }
  return [...out];
}

const isMissingTable = (e: any) => e?.code === "PGRST205" || e?.code === "42P01" || /does not exist|schema cache/i.test(e?.message ?? "");

/** Best-effort. One outcome row per learner action. Never throws. */
export async function recordAiOutcome(admin: any, e: AiOutcomeEntry): Promise<void> {
  try {
    const { error } = await admin.from("plat_ai_outcomes").insert({
      action_id: e.actionId, product: e.product, activity: e.activity.slice(0, 60), operation: e.operation?.slice(0, 80) ?? null,
      output_kind: e.outputKind, outcome: e.outcome,
      accepted_count: Math.max(0, e.accepted ?? 0), rejected_count: Math.max(0, e.rejected ?? 0),
      rejection_reasons: reasonCodes(e.reasons), sufficiency: e.sufficiency ?? "not_assessed",
      generation_attempts: Math.min(10, Math.max(0, e.generationAttempts ?? 0)), verify_attempts: Math.min(10, Math.max(0, e.verifyAttempts ?? 0)),
      prompt_version: e.promptVersion?.slice(0, 120) ?? null, config_version: e.configVersion?.slice(0, 120) ?? null,
      material_key: e.materialKey ?? null,
    });
    if (error && !isMissingTable(error)) console.error(`[ai-outcomes] outcome for "${e.activity}" was NOT recorded: ${error.message}`);
  } catch (err) {
    console.error(`[ai-outcomes] outcome for "${e.activity}" was NOT recorded: ${String((err as Error)?.message ?? err)}`);
  }
}

/**
 * Whether this exact material was already tried for this activity, under the same versions, and rejected, within
 * `days`. Unreadable (600 absent, an error) is "no": this is an efficiency guard, not a safety control, and a
 * learner is never stopped on a guess. The grounding and verification checks stay in front either way.
 */
export async function priorRejection(admin: any, key: string, days = 14): Promise<boolean> {
  try {
    const since = new Date(Date.now() - days * 86400000).toISOString();
    // The latest GENERATION on this material decides: a redirect sent nothing, and an error is an outage, not the
    // material's fault, so neither counts either way.
    const { data, error } = await admin.from("plat_ai_outcomes").select("outcome")
      .eq("material_key", key).in("outcome", ["accepted", "partial", "rejected"]).gte("created_at", since)
      .order("created_at", { ascending: false }).limit(1);
    if (error || !data?.length) return false;
    return data[0].outcome === "rejected";
  } catch { return false; }
}

// ── LEARNER FEEDBACK ────────────────────────────────────────────────────────────────────────────────────────────

export type FeedbackEntry = {
  userId: string; product: AiProductCode; outputKind: AiOutputKind; ref: string; activity?: string | null;
  rating: "positive" | "negative"; reasons?: readonly string[]; promptVersion?: string | null; actionId?: string | null;
};

/** Pure. Only the fixed reason codes, each once. */
export const feedbackReasons = (list: unknown): FeedbackReason[] =>
  Array.isArray(list) ? [...new Set(list.filter((r): r is FeedbackReason => (FEEDBACK_REASONS as readonly string[]).includes(r as string)))] : [];

/** Pure. One feedback row per learner and output, without the learner's id. */
export const feedbackKey = (userId: string, kind: AiOutputKind, ref: string) => sha256Hex(`${userId}\u0000${kind}\u0000${ref}`);

/** Whether feedback can be stored here (migration 600). The widget is not offered where it cannot. */
export async function aiFeedbackAvailable(admin: any): Promise<boolean> {
  try {
    const { error } = await admin.from("plat_ai_feedback").select("id", { head: true, count: "exact" }).limit(1);
    return !error;
  } catch { return false; }
}

/** One learner's view of one output, replacing their earlier one. */
export async function recordAiFeedback(admin: any, f: FeedbackEntry): Promise<"ok" | "not_provisioned" | "failed"> {
  try {
    const { error } = await admin.from("plat_ai_feedback").upsert({
      feedback_key: feedbackKey(f.userId, f.outputKind, f.ref), product: f.product, output_kind: f.outputKind,
      activity: f.activity?.slice(0, 60) ?? null, rating: f.rating,
      reasons: f.rating === "negative" ? feedbackReasons(f.reasons) : [],
      prompt_version: f.promptVersion?.slice(0, 120) ?? null, action_id: f.actionId ?? null, updated_at: new Date().toISOString(),
    }, { onConflict: "feedback_key" });
    if (!error) return "ok";
    return isMissingTable(error) ? "not_provisioned" : "failed";
  } catch { return "failed"; }
}

// ── THE QUALITY-AND-COST VIEW (Holdings) ────────────────────────────────────────────────────────────────────────

export type RequestRow = { operation: string | null; attribution_scope?: string | null; cost_usd: number | string | null; action_id?: string | null; actor_id?: string | null; created_at: string };
export type OutcomeRow = {
  action_id: string; product: string; activity: string; output_kind: AiOutputKind; outcome: AiOutcome;
  accepted_count: number; rejected_count: number; rejection_reasons: string[] | null; sufficiency: Sufficiency; created_at: string;
};
export type FeedbackRow = { output_kind: AiOutputKind; rating: "positive" | "negative"; reasons: string[] | null; created_at: string };

/** Pure. Which product an operation belongs to: its prefix first, then the attribution scope. */
export function productOf(operation: string | null, scope?: string | null): string {
  const op = operation ?? "";
  if (op.startsWith("individual_scholar_")) return "Scholar";
  if (op.startsWith("individual_professional_") || op.startsWith("professional_")) return "Professional";
  if (op.startsWith("practice") || scope === "workspace") return "Practice";
  if (op.startsWith("personal_ai_")) return "Personal AI";
  if (scope === "tenant") return "Enterprise";
  return "Platform";
}

/** Pure. The activity an operation measures: no product prefix, and a verification call counts with what it checks. */
export const activityOf = (operation: string | null) =>
  (operation ?? "unknown").replace(/^individual_(scholar|professional)_/, "").replace(/_verify$/, "");

const money = (n: number) => +n.toFixed(4);
const DAY = 86400000;

/**
 * Pure. The view: total spend, spend by product and activity, cost per ACCEPTED explanation, question and case, the
 * rejection rates and reasons, what unsuccessful generation cost, and a daily trend. Cost per accepted output is
 * spend on the actions of that kind (every call of the action, kept or not) over the outputs they kept. Calls with
 * no action id (before 600, or a surface not yet instrumented) count in spend and never in a per-output figure.
 */
export function summariseQuality(requests: readonly RequestRow[], outcomes: readonly OutcomeRow[], feedback: readonly FeedbackRow[], opts: { days: number; now?: number }) {
  const now = opts.now ?? Date.now();
  const cost = (r: RequestRow) => Number(r.cost_usd ?? 0) || 0;
  const total = requests.reduce((n, r) => n + cost(r), 0);

  const byProduct = new Map<string, { cost: number; n: number; actors: Set<string> }>();
  const byActivity = new Map<string, { product: string; cost: number; n: number }>();
  const byAction = new Map<string, number>();
  for (const r of requests) {
    const p = productOf(r.operation, r.attribution_scope);
    const a = `${p}|${activityOf(r.operation)}`;
    const gp = byProduct.get(p) ?? { cost: 0, n: 0, actors: new Set<string>() }; gp.cost += cost(r); gp.n++; if (r.actor_id) gp.actors.add(r.actor_id); byProduct.set(p, gp);
    const ga = byActivity.get(a) ?? { product: p, cost: 0, n: 0 }; ga.cost += cost(r); ga.n++; byActivity.set(a, ga);
    if (r.action_id) byAction.set(r.action_id, (byAction.get(r.action_id) ?? 0) + cost(r));
  }

  // SCHOLAR-AI-OPT-01 P8/P10: the outputs measured are Scholar's, so "per learner" is per active Scholar learner -- a
  // person with at least one Scholar AI call in the window. Counted here; no id leaves this function.
  const learners = byProduct.get("Scholar")?.actors.size ?? 0;
  const perLearner = (n: number) => (learners ? +(n / learners).toFixed(2) : null);
  const kinds: AiOutputKind[] = ["explanation", "question", "case"];
  const perKind = kinds.map(kind => {
    const rows = outcomes.filter(o => o.output_kind === kind);
    const generated = rows.filter(o => o.outcome !== "redirected");
    const accepted = generated.reduce((n, o) => n + (o.accepted_count ?? 0), 0);
    const spend = generated.reduce((n, o) => n + (byAction.get(o.action_id) ?? 0), 0);
    const failed = generated.filter(o => o.outcome === "rejected" || o.outcome === "error");
    const failedCost = failed.reduce((n, o) => n + (byAction.get(o.action_id) ?? 0), 0);
    const fb = feedback.filter(f => f.output_kind === kind);
    return {
      kind, actions: generated.length, accepted,
      rejectedActions: failed.length,
      rejectionRate: generated.length ? Math.round((failed.length / generated.length) * 100) : null,
      spend: money(spend), costPerAccepted: accepted ? money(spend / accepted) : null,
      unsuccessfulCost: money(failedCost),
      redirected: rows.length - generated.length,
      feedback: { n: fb.length, positive: fb.filter(f => f.rating === "positive").length },
      actionsPerLearner: perLearner(generated.length), acceptedPerLearner: perLearner(accepted),
      // Share of kept outputs a learner rated (one rating per learner and output). Null when nothing was kept.
      feedbackRate: accepted ? Math.round((fb.length / accepted) * 100) : null,
    };
  });

  const reasons = new Map<string, number>();
  for (const o of outcomes) for (const r of o.rejection_reasons ?? []) reasons.set(r, (reasons.get(r) ?? 0) + 1);
  const sufficiency = new Map<string, number>();
  for (const o of outcomes) if (o.sufficiency !== "not_assessed") sufficiency.set(o.sufficiency, (sufficiency.get(o.sufficiency) ?? 0) + 1);
  const feedbackReasonsTally = new Map<string, number>();
  for (const f of feedback) for (const r of f.reasons ?? []) feedbackReasonsTally.set(r, (feedbackReasonsTally.get(r) ?? 0) + 1);

  const trend = Array.from({ length: opts.days }, (_, i) => {
    const start = new Date(now - (opts.days - 1 - i) * DAY); start.setUTCHours(0, 0, 0, 0);
    const end = start.getTime() + DAY;
    const inDay = (t: string) => { const x = new Date(t).getTime(); return x >= start.getTime() && x < end; };
    const out = outcomes.filter(o => inDay(o.created_at) && o.outcome !== "redirected");
    const accepted = out.reduce((n, o) => n + (o.accepted_count ?? 0), 0);
    const actionSpend = out.reduce((n, o) => n + (byAction.get(o.action_id) ?? 0), 0);
    const fb = feedback.filter(f => inDay(f.created_at));
    const dayLearners = new Set(requests.filter(r => inDay(r.created_at) && r.actor_id && productOf(r.operation, r.attribution_scope) === "Scholar").map(r => r.actor_id)).size;
    return {
      day: start.toISOString().slice(0, 10), learners: dayLearners,
      spend: money(requests.filter(r => inDay(r.created_at)).reduce((n, r) => n + cost(r), 0)),
      actions: out.length, accepted,
      rejectionRate: out.length ? Math.round((out.filter(o => o.outcome === "rejected" || o.outcome === "error").length / out.length) * 100) : null,
      costPerAccepted: accepted ? money(actionSpend / accepted) : null,
      positiveRate: fb.length ? Math.round((fb.filter(f => f.rating === "positive").length / fb.length) * 100) : null,
    };
  });

  const sorted = (m: Map<string, number>) => [...m.entries()].map(([label, n]) => ({ label, n })).sort((a, b) => b.n - a.n);
  return {
    totalSpend: money(total), requests: requests.length,
    attributedSpend: money([...byAction.values()].reduce((a, b) => a + b, 0)),
    byProduct: [...byProduct.entries()].map(([label, g]) => ({ label, cost: money(g.cost), n: g.n, learners: g.actors.size, costPerLearner: g.actors.size ? money(g.cost / g.actors.size) : null })).sort((a, b) => b.cost - a.cost),
    learners: { scholar: learners, costPerLearner: learners ? money((byProduct.get("Scholar")?.cost ?? 0) / learners) : null, callsPerLearner: perLearner(byProduct.get("Scholar")?.n ?? 0) },
    byActivity: [...byActivity.values()].length
      ? [...byActivity.entries()].map(([k, g]) => ({ product: g.product, activity: k.split("|")[1], cost: money(g.cost), n: g.n })).sort((a, b) => b.cost - a.cost)
      : [],
    perKind,
    reasons: sorted(reasons).slice(0, 12),
    sufficiency: sorted(sufficiency),
    feedbackReasons: sorted(feedbackReasonsTally),
    trend,
  };
}

/** Reads the window and summarises it. `measured` is false until migration 600 is applied: say so, never zero. */
export async function loadAiQuality(admin: any, days = 14) {
  const since = new Date(Date.now() - days * DAY).toISOString();
  const [req, out, fb] = await Promise.all([
    admin.from("plat_ai_requests").select("operation, attribution_scope, cost_usd, action_id, actor_id, created_at").gte("created_at", since).order("created_at", { ascending: false }).limit(10000),
    admin.from("plat_ai_outcomes").select("action_id, product, activity, output_kind, outcome, accepted_count, rejected_count, rejection_reasons, sufficiency, created_at").gte("created_at", since).limit(10000),
    admin.from("plat_ai_feedback").select("output_kind, rating, reasons, created_at").gte("created_at", since).limit(10000),
  ]);
  return {
    usageReady: !req.error,
    measured: !out.error,
    feedbackReady: !fb.error,
    days,
    ...summariseQuality(req.error ? [] : req.data ?? [], out.error ? [] : out.data ?? [], fb.error ? [] : fb.data ?? [], { days }),
  };
}
