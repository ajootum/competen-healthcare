/* eslint-disable @typescript-eslint/no-explicit-any */
import { classifyRisk, higherRisk, resolveRiskPolicy, riskRank, ruleMatches, type ResolvedRiskSubject, type RiskDecision, type RiskPolicy, type RiskRule, type RiskTier } from "./clinical-risk";
import type { AiProduct } from "./fair-use-policy";

// ── AI OPERATING MODES ── owner GO "COMPETEN AI — SUPERVISED PILOT MODE", 29 Oct 2026 ─────────────────────────────
//
// One CONFIG-002 document per product, `ai.mode.<product>`, in its OWN scope (platform / ai_modes), so a mode is drafted,
// published (audited, publisher not the drafter, 640) and rolled back on its own, without carrying the other AI drafts
// (prices, routing, budgets) with it. Unpublished or unreadable: Strict Production for everyone, which is exactly the
// behaviour before this file. Environment needs no field: each Supabase project holds its own document.
//
//   strict_production    the published fair-use risk rules, unchanged. Unrecognised or high-risk: refused.
//   supervised_pilot     ONLY for the cohorts the document names (people listed by id, or by entitlement source or plan).
//                        Adds the pilot rules, asks the learner to clarify an ambiguous clinical request instead of
//                        refusing it, answers the educational part within stated boundaries, and logs every gate decision.
//   clinical_production  the production rules, with the clarify question and the educational boundary, and a decision
//                        log of refusals. High-risk clinical requests still need a model made eligible for that tier
//                        by a recorded evaluation (ai_model_eligibility). A mode never approves a model.
//
// ⚠ A MODE NEVER LOWERS A PATIENT-SPECIFIC RISK. Clarifying applies only to a high-risk decision reached by rules the
// document lists as clarifiable (topic rules such as medicines or sepsis named in a study question) or by "unrecognised".
// Any other high-risk rule that matches (a real patient now, giving a medicine, urgent direction) refuses, as before.
// Confirmed as study, the request runs at CLINICAL EDUCATIONAL -- on a model eligible for clinical educational content,
// never on the cheaper standard model -- with the educational boundary in its instructions.

export const AI_MODES = ["strict_production", "supervised_pilot", "clinical_production"] as const;
export type AiMode = (typeof AI_MODES)[number];
export const AI_MODE_LABEL: Record<AiMode, string> = { strict_production: "Strict Production", supervised_pilot: "Supervised Pilot", clinical_production: "Clinical Production" };
export const MODE_SCOPE = { scopeType: "platform", scopeRef: "ai_modes" } as const;
export const modePath = (p: AiProduct) => `ai.mode.${p}`;

export type ModeBehaviour = { pilotRules: boolean; clarify: boolean; educationalBoundary: boolean; logAll: boolean };
export const MODE_BEHAVIOUR: Record<AiMode, ModeBehaviour> = {
  strict_production: { pilotRules: false, clarify: false, educationalBoundary: false, logAll: false },
  supervised_pilot: { pilotRules: true, clarify: true, educationalBoundary: true, logAll: true },
  clinical_production: { pilotRules: false, clarify: true, educationalBoundary: true, logAll: false },
};

export type Cohort = { code: string; label: string; mode: AiMode; userIds: string[]; entitlementSources: string[]; planCodes: string[]; hourlyLimit: number | null };
export type ModeDoc = { defaultMode: AiMode; cohorts: Cohort[]; pilotRisk: RiskPolicy; clarifiableRules: string[] };
/** The decision the gate reads: who is in which mode, and why. */
export type RequestMode = { mode: AiMode; cohort: string | null; behaviour: ModeBehaviour; doc: ModeDoc; version: string | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE = /^[a-z][a-z0-9_-]{1,40}$/;
const isMode = (m: unknown): m is AiMode => (AI_MODES as readonly string[]).includes(m as string);
const strs = (v: unknown, re: RegExp, max: number) => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && re.test(x)).map(x => x.toLowerCase()))].slice(0, max) : []);

export const STRICT_DOC: ModeDoc = { defaultMode: "strict_production", cohorts: [], pilotRisk: { minTier: resolveRiskPolicy(null).minTier, rules: [] }, clarifiableRules: [] };

/**
 * Pure: a published mode document. Anything malformed is dropped, never widened: an unknown default is Strict
 * Production, a cohort without members or a known mode is ignored, and only high-risk rules may be clarifiable.
 * Supervised Pilot can never be the default: a pilot is for named cohorts only.
 */
export function resolveModeDoc(raw: any): ModeDoc {
  if (!raw || typeof raw !== "object") return STRICT_DOC;
  const defaultMode: AiMode = raw.defaultMode === "clinical_production" ? "clinical_production" : "strict_production";
  const cohorts: Cohort[] = [];
  for (const c of (Array.isArray(raw.cohorts) ? raw.cohorts : []).slice(0, 20) as any[]) {
    if (!c || typeof c.code !== "string" || !CODE.test(c.code) || !isMode(c.mode) || cohorts.some(x => x.code === c.code)) continue;
    const userIds = strs(c.userIds, UUID, 500), entitlementSources = strs(c.entitlementSources, CODE, 10), planCodes = strs(c.planCodes, CODE, 20);
    if (!userIds.length && !entitlementSources.length && !planCodes.length) continue;
    const h = Number(c.hourlyLimit);
    cohorts.push({ code: c.code, label: typeof c.label === "string" && c.label.trim() ? c.label.trim().slice(0, 120) : c.code, mode: c.mode, userIds, entitlementSources, planCodes,
      hourlyLimit: Number.isInteger(h) && h >= 1 && h <= 500 ? h : null });
  }
  const pilotRisk = resolveRiskPolicy({ rules: raw?.pilotRisk?.rules ?? [] });
  const clarifiableRules = strs(raw.clarifiableRules, /^[a-z][a-z0-9_.:-]{1,60}$/, 40);
  return { defaultMode, cohorts, pilotRisk, clarifiableRules };
}

/** Pure: the mode for one person. The first cohort that names them wins, otherwise the default. */
export function modeFor(doc: ModeDoc, person: { userId: string | null; entitlementSources: readonly string[]; planCodes: readonly string[] }, version: string | null = null): RequestMode {
  const c = person.userId ? doc.cohorts.find(k => k.userIds.includes(person.userId!.toLowerCase())
    || k.entitlementSources.some(s => person.entitlementSources.includes(s)) || k.planCodes.some(p => person.planCodes.includes(p))) : undefined;
  const mode = c?.mode ?? doc.defaultMode;
  return { mode, cohort: c?.code ?? null, behaviour: MODE_BEHAVIOUR[mode], doc, version };
}

/** Pure: the production rules, with the pilot rules added in a pilot. Highest tier still wins, so a pilot rule can
 *  recognise a request but never lower what a production rule found. */
export function rulesFor(production: RiskPolicy, m: RequestMode): RiskPolicy {
  if (!m.behaviour.pilotRules || !m.doc.pilotRisk.rules.length) return production;
  const seen = new Set(production.rules.map(r => r.id));
  return { ...production, rules: [...production.rules, ...m.doc.pilotRisk.rules.filter(r => !seen.has(r.id))] };
}

export type GateVerdict = { kind: "classified"; risk: RiskDecision } | { kind: "clarify"; risk: RiskDecision };
export type Purpose = "education" | null;

/**
 * Pure: the risk decision under a mode. Strict Production: classifyRisk, unchanged. Otherwise a HIGH-RISK decision that
 * only clarifiable rules (or "unrecognised") reached becomes a question to the learner; once they confirm it is for
 * study it runs at clinical educational (never lower, and never below the activity's floor). Any other high-risk rule
 * that matches keeps the refusal.
 */
export function decideRisk(policy: RiskPolicy, subject: ResolvedRiskSubject, activityFloor: RiskTier, m: RequestMode, purpose: Purpose): GateVerdict {
  const rules = rulesFor(policy, m);
  const d = classifyRisk(rules, subject, activityFloor);
  if (!m.behaviour.clarify || d.tier !== "high_risk_clinical" || activityFloor === "high_risk_clinical") return { kind: "classified", risk: d };
  const clarifiable = new Set(m.doc.clarifiableRules);
  const highHits: RiskRule[] = rules.rules.filter(r => r.tier === "high_risk_clinical" && ruleMatches(r, subject));
  const unknown = d.rule.startsWith("unknown:");
  if (unknown ? !clarifiable.has("unknown") : highHits.some(r => !clarifiable.has(r.id))) return { kind: "classified", risk: d };
  if (purpose !== "education") return { kind: "clarify", risk: d };
  return { kind: "classified", risk: { tier: higherRisk("clinical_educational", activityFloor), rule: `education_confirmed:${d.rule}`.slice(0, 120),
    reason: "The learner confirmed this is for study, not about a real patient." } };
}

/** The question asked instead of a refusal, and what each answer does. */
export const CLARIFY = {
  question: "Is this question for your studies, or about a real patient you are caring for now?",
  education: "It's for my studies",
  patient: "It's about a real patient",
  patientAnswer: "For a real patient, please follow your local clinical guidance and speak to the nurse in charge, your clinical team or your supervisor. In an emergency, use your local emergency procedure straight away. I can help you study the topic in general terms if you'd like.",
} as const;

/** Said on a refusal in place of the old one-line refusal. Supportive, and it says what still works. */
export const SUPPORTIVE_REFUSAL = "I can't help with this here. Questions about a real patient's care, giving medicines to someone, or an urgent situation need your clinical team and local guidance. If you are studying the topic, ask it as a study question (for example, \"explain how this works\") and I can help.";

/** Instructions added when a mode answers the educational part of a clinical question. Prompt only: it never changes the gate. */
export const EDUCATIONAL_BOUNDARY = [
  "EDUCATIONAL BOUNDARY: this is general education for a learner, not advice about a real patient.",
  "Answer the educational part fully and clearly. If any part asks for a decision about a real patient, a medicine dose or administration for a real person, or what to do in an urgent situation, do not answer that part: say plainly that it needs their clinical team and local guidance, then continue with the educational part.",
  "Never present your suggestions as the learner's own goals or records, and never say this model is approved for real clinical decisions.",
].join("\n");

// ── READS AND THE DECISION LOG ────────────────────────────────────────────────────────────────────────────────

/** The mode for one person on one product. Unreadable or unpublished: Strict Production (the behaviour before modes). */
export async function loadRequestMode(admin: any, product: AiProduct, userId: string | null): Promise<RequestMode> {
  let doc = STRICT_DOC, version: string | null = null;
  try {
    const { data, error } = await admin.from("workspace_config_overrides").select("published, updated_at")
      .eq("scope_type", MODE_SCOPE.scopeType).eq("scope_ref", MODE_SCOPE.scopeRef).eq("config_path", modePath(product)).maybeSingle();
    if (!error && data?.published) { doc = resolveModeDoc(data.published); version = `${modePath(product)}@${data.updated_at}`; }
  } catch { /* Strict Production */ }
  if (!doc.cohorts.length || !userId) return modeFor(doc, { userId, entitlementSources: [], planCodes: [] }, version);
  let sources: string[] = [], plans: string[] = [];
  try {
    const { data } = await admin.from("individual_entitlement").select("source, plan_code, status, ends_at").eq("user_id", userId).eq("status", "active");
    const now = new Date().toISOString();
    const live = (data ?? []).filter((e: any) => !e.ends_at || e.ends_at > now);
    sources = live.map((e: any) => String(e.source ?? "").toLowerCase()).filter(Boolean);
    plans = live.map((e: any) => String(e.plan_code ?? "").toLowerCase()).filter(Boolean);
  } catch { /* named people only */ }
  return modeFor(doc, { userId, entitlementSources: sources, planCodes: plans }, version);
}

export type GateDecision = "served" | "clarify" | "refused";
/**
 * One gate decision, for pilot learning and refusal analytics: product, activity, mode, cohort, tier, deciding rule and
 * outcome. NEVER the request text. Written for every decision in a pilot and for every refusal or question in any mode.
 * Its own action name, so the hourly quota (which counts ai_assistant_query) never counts it.
 */
export async function logGateDecision(admin: any, m: RequestMode, e: { userId: string | null; product: AiProduct; activity: string; decision: GateDecision; reason: string; risk?: RiskDecision }) {
  if (e.decision === "served" && !m.behaviour.logAll) return;
  try {
    await admin.from("audit_log").insert({
      actor_id: e.userId, action: "ai_gate_decision", entity_type: "ai_activity", entity_id: null,
      new_value: { product: e.product, activity: e.activity, mode: m.mode, cohort: m.cohort, decision: e.decision, reason: e.reason,
        tier: e.risk?.tier ?? null, rule: e.risk?.rule ?? null, policy: m.version },
    });
  } catch { /* the decision stands; the log is best effort */ }
}

/** Pure: a cohort's hourly limit, where the pilot sets one above the plan's. Never lower than the plan, never above 500. */
export const pilotHourlyLimit = (m: RequestMode, planLimit: number) => {
  const c = m.cohort ? m.doc.cohorts.find(k => k.code === m.cohort) : undefined;
  return c?.hourlyLimit && c.hourlyLimit > planLimit ? c.hourlyLimit : planLimit;
};

export { riskRank };
