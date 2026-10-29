import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { aiStatus } from "@/lib/ai/config";
import { checkAiQuota } from "@/lib/ai/quota";
import { individualAiQuota, individualQuotaRefusal, loadIndividualPolicy } from "../policy";
import { individualPlanAiLimit } from "../commerce";
import { pilotQuotaRefusal } from "../pilot-ai";
import { currentTraceId } from "@/lib/trace";
import type { IndividualContext } from "../guard";
import { readConsent, sectionLinks, topicsOfSections } from "./store";
import { consentDocuments, consentStatus } from "./consent-gate";
import { CONSENT_AWAITING_LEGAL, CONSENT_UPDATED } from "./config";
import { aiFairUseEnabled, isMeteredRefusal, loadModelRouting, loadProductPolicy, meteredRefusalBody, requestIdFor, resolveRiskSubject, runMeteredAi, runOwnedAi, unmeteredGate, type MeteredRefusal } from "@/lib/ai/allowance";
import { sha256Hex } from "@/lib/ai/outcomes";
import type { ResolvedOwner } from "@/lib/ai/consumption";
import type { GenerateArgs, GenerateResult } from "@/lib/ai/client";
import { classifyRisk, riskRank, type RiskContext, type RiskTier } from "@/lib/ai/clinical-risk";
import type { ScholarAiActivity } from "./ai-standing";

// ── WHAT EVERY SCHOLAR AI ROUTE CHECKS, IN ORDER ── after requireIndividualContext("scholar") ────────────
//
//   1. CONSENT. The person's own, revocable consent to AI processing of their uploads
//      (individual_scholar_consent), to the CURRENT notice version, while the Privacy Notice and Terms
//      of Use it relies on are published (consent-gate.ts). None, revoked, to an earlier notice,
//      documents unpublished, or unreadable: no AI call. Unreadable is not permission (ADR-015).
//   2. QUOTA. The estate's hourly AI limit (src/lib/ai/quota.ts), which counts audit_log rows by action.
//   3. CONFIGURATION. An environment with no AI provider says so rather than failing later.
//
// The audit row afterwards uses action `ai_assistant_query` -- the action the quota counts -- so a Scholar
// AI call is one the hourly limit can see. entity_type names which Scholar operation it was.

export async function aiPreflight(ctx: IndividualContext): Promise<NextResponse | null> {
  const consent = await readConsent(ctx.admin, ctx.userId);
  if (!consent.ok) return NextResponse.json({ error: "Your AI consent could not be checked just now, so nothing was sent. Try again shortly." }, { status: 503 });
  const status = consentStatus(consent.data, consentDocuments().published);
  if (status === "awaiting_legal") return NextResponse.json({ error: CONSENT_AWAITING_LEGAL }, { status: 403 });
  if (status === "outdated") return NextResponse.json({ error: CONSENT_UPDATED }, { status: 403 });
  if (status !== "on")
    return NextResponse.json({ error: "Turn on AI processing of your material in My Learning before asking for explanations or questions." }, { status: 403 });
  // The estate limit (quota.ts, unchanged) and the Individual policy limit, whichever is tighter (CONFIG-002).
  const quota = individualAiQuota(await checkAiQuota(ctx.admin, ctx.userId), await loadIndividualPolicy(ctx.admin), await individualPlanAiLimit(ctx.admin, ctx.userId));
  // Fails CLOSED: an unreadable count is a 503 refusal, never a free pass (individualAiQuota).
  const refusal = await pilotQuotaRefusal(ctx.admin, "scholar", ctx.userId, quota, individualQuotaRefusal(quota, "AI requests"), "AI requests");
  if (refusal) return NextResponse.json({ error: refusal.error }, { status: refusal.status });
  if (!aiStatus().configured) return NextResponse.json({ error: "AI is not configured on this environment." }, { status: 503 });
  return null;
}

export const AI_ERROR: Record<"not_configured" | "refusal" | "failed", { status: number; error: string }> = {
  not_configured: { status: 503, error: "AI is not configured on this environment." },
  refusal: { status: 502, error: "The AI declined that request." },
  failed: { status: 502, error: "The AI could not answer just now. Try again shortly." },
};

/** One audit row. Counts and ids only -- never the person's question text or their material. */
export async function audit(ctx: IndividualContext, action: string, entityType: string, entityId: string | null, value: Record<string, unknown>) {
  await ctx.admin.from("audit_log").insert({
    trace_id: await currentTraceId(), actor_id: ctx.userId, actor_name: ctx.profile.fullName,
    action, entity_type: entityType, entity_id: entityId, new_value: value,
  }).then((r: unknown) => r, () => {});
}

export const SCHOLAR_AI_AUDIT_ACTION = "ai_assistant_query";

// ── AI-FAIR-USE-01: EVERY SCHOLAR AI CALL GOES THROUGH THE HOLDINGS ALLOWANCE ──────────────────────────────
//
// One runner per student action. It sends each AI call through runMeteredAi with Scholar's activity code and a
// request id -- the client's retry key if it sent one (x-request-id), never an amount, a policy or a level. With
// metering off, runMeteredAi is generate() unchanged, and aiPreflight's existing quota stays in front, exactly as
// today. One action may make several calls (a question set is written, then checked blind, and retried once):
// each `part` gets its own deterministic id, so a retry of the whole action stays idempotent.
//
// The generators take a plain `run` (the Holdings mapping engine's own form). A metered refusal is KEPT here and the
// generator is told the call failed; the route then shows the refusal plainly (meteredRefusal), never a generic
// failure, and never a quietly weaker model.

export type ScholarAiRun = (g: GenerateArgs, part?: string) => Promise<GenerateResult>;

const RISK_TEXT_MAX = 20000, RISK_MAX_TERMS = 50;

/**
 * Owner D1 (AI-FAIR-USE-01): the subject of a Scholar AI request, for the Holdings clinical-risk classification. The
 * student's own words (after the route's identifier screen), the sections the request works from (screened when
 * they were uploaded), those sections' competencies (their live links, unless the caller names them) and their topic
 * terms. The engine reads it in memory only. Never omitted: a request with no subject is classified as high risk.
 * `actorId` is the signed-in student (their operating mode and cohort); `purpose` is only their answer to a clarify question.
 */
export async function scholarRisk(admin: unknown, userId: string, input: {
  text?: string | null; passages: readonly { chunkId: string; content: string }[]; competencyIds?: readonly string[];
  /** AI operating modes: "education" once the student confirmed a clarify question was for study (purposeFrom). */
  purpose?: "education" | null;
}): Promise<RiskContext> {
  const chunkIds = input.passages.map(p => p.chunkId);
  const [links, topics] = await Promise.all([input.competencyIds ? null : sectionLinks(admin, userId, chunkIds), topicsOfSections(admin, userId, chunkIds)]);
  return {
    text: [input.text ?? "", ...input.passages.map(p => p.content)].filter(Boolean).join("\n\n").slice(0, RISK_TEXT_MAX),
    competencyIds: [...new Set(input.competencyIds ?? (links ?? []).map(l => l.competencyId))].slice(0, RISK_MAX_TERMS),
    topicTerms: [...new Set([...topics.values()].flat())].slice(0, RISK_MAX_TERMS),
    actorId: userId, purpose: input.purpose ?? null,
  };
}

/**
 * Every Scholar AI call, through the Holdings allowance: Scholar's activity, one deterministic request id per call of
 * one student action (`:retry`, `:verify`, `:retry-verify` for the further calls), and the SAME risk subject on each,
 * so a verification or a retry is never classified below the content it checks (IND-007's contract).
 */
/** The request id the engine reserves against: the caller's, from the client's retry key when it is well formed. */
export const scholarRequestId = (ctx: IndividualContext, req: Request) => requestIdFor(ctx.userId, req.headers.get("x-request-id"));

export function scholarAiRunner(ctx: IndividualContext, req: Request, activity: ScholarAiActivity, risk: RiskContext, callKey?: string): { run: ScholarAiRun; refusal: () => MeteredRefusal | null; actionId: string; calls: () => Record<string, number> } {
  // `callKey`: one student action that makes several separate generations (a revision session filling its shortfall)
  // gives each its own deterministic id, `:g1`, `:g2` ..., so each is its own idempotent reservation.
  const requestId = callKey ? `${scholarRequestId(ctx, req)}:${callKey}` : scholarRequestId(ctx, req);
  let refused: MeteredRefusal | null = null;
  // SCHOLAR-AI-OPT-01: every call of this one student action carries the same action id (plat_ai_requests.action_id),
  // so its cost can be set against what it produced (plat_ai_outcomes). `calls` counts the calls made, by part.
  const actionId = randomUUID();
  const made: Record<string, number> = {};
  const run: ScholarAiRun = async (g, part = "main") => {
    if (refused) return { ok: false, error: "failed", detail: "metered" } as GenerateResult;
    made[part] = (made[part] ?? 0) + 1;
    g = withAction(g, actionId);
    const x = await runMeteredAi(ctx.admin, { userId: ctx.userId, product: "scholar", activity, requestId: part === "main" ? requestId : `${requestId}:${part}`, generate: g, risk });
    if (isMeteredRefusal(x)) { refused = x; return { ok: false, error: "failed", detail: "metered" } as GenerateResult; }
    return x;
  };
  return { run, refusal: () => refused, actionId, calls: () => ({ ...made }) };
}

/** The same request, tagged with the student action it belongs to. Nothing else about it changes. */
const withAction = (g: GenerateArgs, actionId: string): GenerateArgs => ({ ...g, context: { ...g.context, actionId } });

/**
 * CLINICAL-REASONING-01: a Scholar call whose spend owner the consumption-ownership rules resolved (resolveOwner, by
 * workflow -- never chosen by the browser), counted against `record` (e.g. caseSessionRecord). The same refusal rule
 * as the metered runner: a refusal stops the action and is kept, nothing quietly weaker.
 */
export function scholarOwnedRunner(admin: unknown, args: { owner: ResolvedOwner; activity: ScholarAiActivity; requestId: string; risk: RiskContext; record: { type: string; ref: string } }): { run: ScholarAiRun; refusal: () => string | null } {
  let refused: string | null = null;
  const run: ScholarAiRun = async (g, part = "main") => {
    if (refused) return { ok: false, error: "failed", detail: "metered" } as GenerateResult;
    const x = await runOwnedAi(admin, { owner: args.owner, product: "scholar", activity: args.activity, requestId: part === "main" ? args.requestId : `${args.requestId}:${part}`, generate: g, risk: args.risk, record: args.record });
    if (x && x.ok === false && ("standing" in x || "budget" in x)) { refused = x.error; return { ok: false, error: "failed", detail: "metered" } as GenerateResult; }
    return x as GenerateResult;
  };
  return { run, refusal: () => refused };
}

/** The engine's student-facing words for a refusal, and whether it is about the level of AI (never quietly weaker). */
export function refusalWords(refusal: MeteredRefusal): { message: string; insufficient: boolean } {
  return { message: meteredRefusalBody(refusal).body.error, insufficient: refusal.error === "level_insufficient" || refusal.error === "not_eligible" };
}

/** The refusal, as the engine words it (with the standing, for Learning Continuity), or null. */
export function meteredRefusal(refusal: MeteredRefusal | null): NextResponse | null {
  if (!refusal) return null;
  const m = meteredRefusalBody(refusal);
  return NextResponse.json(m.body, { status: m.status });
}


/**
 * A short fingerprint of the published Holdings model routing (read, never changed). Part of the identical-retry key:
 * when the owner changes routing, the conditions changed, and a retry is allowed.
 */
export async function routingVersion(admin: unknown): Promise<string> {
  const r = await loadModelRouting(admin).catch(() => null);
  return r ? `routing:${sha256Hex(JSON.stringify(r)).slice(0, 12)}` : "routing:unreadable";
}

/**
 * COMPETEN-RESEARCH-01: before Learn searches external research, the same clinical-risk gate the AI call will meet,
 * on the same risk subject -- so a topic no model is eligible for is refused before anything is sent to a research
 * provider. With metering ON the call itself decides (runMeteredAi); this returns null and the call refuses as before.
 */
export async function scholarRiskGate(ctx: IndividualContext, activity: ScholarAiActivity, risk: RiskContext): Promise<MeteredRefusal | null> {
  if (await aiFairUseEnabled(ctx.admin)) return null;
  const g = await unmeteredGate(ctx.admin, "scholar", activity, "reasoning", risk);
  return g.ok ? null : g;
}

/**
 * COMPETEN-RESEARCH-01: which texts stay within the request's OWN risk tier, classified WITH the request's subject by the
 * same published rules. Learn applies it to what the research part WROTE (generation), never to what was found
 * (discovery): research text that would lift the request above its tier is withheld, so research never raises what is
 * shown beyond the eligible model's tier. An unreadable policy keeps none (fail closed: the notes part alone is shown).
 */
export async function withinRequestRisk(admin: unknown, activity: ScholarAiActivity, risk: RiskContext, texts: readonly string[]): Promise<boolean[]> {
  const { policy, readable } = await loadProductPolicy(admin, "scholar");
  if (!readable || !texts.length) return texts.map(() => false);
  const floor = ((policy.activities as Record<string, { riskFloor?: string }>)[activity]?.riskFloor ?? "standard_educational") as RiskTier;
  const subject = await resolveRiskSubject(admin, risk);
  const base = riskRank(classifyRisk(policy.risk, subject, floor).tier);
  return texts.map(t => riskRank(classifyRisk(policy.risk, { ...subject, text: `${subject.text}\n\n${t}` }, floor).tier) <= base);
}
