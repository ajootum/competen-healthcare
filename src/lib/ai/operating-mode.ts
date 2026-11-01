/* eslint-disable @typescript-eslint/no-explicit-any */
import { classifyRisk, higherRisk, intentActive, NO_INTENT, resolveRiskPolicy, riskRank, ruleMatches, ruleRefusal, type ResolvedRiskSubject, type RiskDecision, type RiskPolicy, type RiskRule, type RiskTier } from "./clinical-risk";
import { cautiousIntentFeatures, firstKind, type RefusalKind } from "./request-intent";
import { classificationReadings, vocabularyOf } from "../individual/scholar/spelling";
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

/** `restricted` (SCHOLAR-RISK-01): category 4, real-patient clinical decision support. Refused before routing, whatever
 *  model would be eligible, with words that say why (refusalFor). */
export type GateVerdict = { kind: "classified"; risk: RiskDecision } | { kind: "clarify"; risk: RiskDecision } | { kind: "restricted"; risk: RiskDecision };
export type Purpose = "education" | null;

/**
 * Pure: the risk decision under a mode. Strict Production: classifyRisk, unchanged. Otherwise a HIGH-RISK decision that
 * only clarifiable rules (or "unrecognised") reached becomes a question to the learner; once they confirm it is for
 * study it runs at clinical educational (never lower, and never below the activity's floor). Any other high-risk rule
 * that matches keeps the refusal.
 *
 * SCHOLAR-RISK-01: where the product's risk policy turns its intent layer on (clinical-risk.ts IntentPolicy), decideIntent
 * decides first, in every mode; what it leaves undecided goes on exactly as before.
 */
export function decideRisk(policy: RiskPolicy, subject0: ResolvedRiskSubject, activityFloor: RiskTier, m: RequestMode, purpose: Purpose): GateVerdict {
  return withRecovery(subject0, decideRiskCore(policy, subject0, activityFloor, m, purpose));
}

function decideRiskCore(policy: RiskPolicy, subject0: ResolvedRiskSubject, activityFloor: RiskTier, m: RequestMode, purpose: Purpose): GateVerdict {
  const rules = rulesFor(policy, m);
  // Owner item 8 (1 Nov 2026): where the intent layer is on, the rules also read the corrected readings of the learner's
  // own words (a rule matching in ANY reading matches, so a correction can add a high-risk match, never remove one).
  const subject = intentActive(policy.intent) ? withReadings(subject0) : subject0;
  const d = classifyRisk(rules, subject, activityFloor);
  const v = intentActive(policy.intent) ? decideIntent(rules, subject, activityFloor, d, purpose) : null;
  if (v) return withSafeguards(policy, v);
  if (!m.behaviour.clarify || d.tier !== "high_risk_clinical" || activityFloor === "high_risk_clinical") return withSafeguards(policy, { kind: "classified", risk: d });
  const clarifiable = new Set(m.doc.clarifiableRules);
  const highHits: RiskRule[] = rules.rules.filter(r => r.tier === "high_risk_clinical" && ruleMatches(r, subject));
  const unknown = d.rule.startsWith("unknown:");
  if (unknown ? !clarifiable.has("unknown") : highHits.some(r => !clarifiable.has(r.id))) return withSafeguards(policy, { kind: "classified", risk: d });
  if (purpose !== "education") return { kind: "clarify", risk: d };
  return withSafeguards(policy, { kind: "classified", risk: { tier: higherRisk("clinical_educational", activityFloor), rule: `education_confirmed:${d.rule}`.slice(0, 120),
    reason: "The learner confirmed this is for study, not about a real patient." } });
}

/** Pure: the tier a request is served at once it is for study (strict mode, purpose confirmed): what research text is
 *  compared against (scholar/http.ts withinRequestRisk). A category-4 request is high (it is never served). */
export const servedTier = (policy: RiskPolicy, subject: ResolvedRiskSubject, floor: RiskTier): RiskTier =>
  decideRisk(policy, subject, floor, modeFor(STRICT_DOC, { userId: null, entitlementSources: [], planCodes: [] }), "education").risk.tier;

/** The learner's material words, beside their request (the subject text without the request words), and the lesson's
 *  own words: never corrected (spelling.ts vocabulary). */
function materialVocabulary(s: ResolvedRiskSubject): string[] {
  const req = s.requestText;
  const material = req === undefined ? "" : s.text.startsWith(req) ? s.text.slice(req.length) : s.text.replace(req, "");
  const c = s.intentContext;
  return vocabularyOf([material, c?.lessonTitle, c?.objective, c?.activity, ...(c?.materialTopics ?? [])]);
}
type WithReadings = ResolvedRiskSubject & { readings?: string[]; vocabulary?: string[] };
/** Pure: the subject with the request's other readings beside it (classificationReadings). Unchanged when the text was
 *  read as typed. */
function withReadings(s: ResolvedRiskSubject): WithReadings {
  const req = s.requestText ?? s.text;
  const vocabulary = materialVocabulary(s);
  const { readings } = classificationReadings(req, { vocabulary });
  const extra = readings.filter(r => r !== req);
  if (!extra.length) return { ...s, readings, vocabulary };
  const add = `\n${extra.join("\n")}`;
  return { ...s, text: `${s.text}${add}`, requestText: `${req}${add}`, readings, vocabulary };
}

/** Owner item 5: an unrecognised request asked in Learn says what Learn can still do (the notes, research). */
function withRecovery(s: ResolvedRiskSubject, v: GateVerdict): GateVerdict {
  return s.intentContext?.surface === "learn" && v.risk.refusal === "unrecognised" ? { ...v, risk: { ...v.risk, recovery: "learn" } } as GateVerdict : v;
}

/** Pure: a served decision above standard carries the educational boundary where the policy asks for it. */
function withSafeguards(policy: RiskPolicy, v: GateVerdict): GateVerdict {
  if (v.kind !== "classified" || !policy.intent?.educationalSafeguards || riskRank(v.risk.tier) <= 0) return v;
  return { kind: "classified", risk: { ...v.risk, boundary: true } };
}

const high = (rule: string, reason: string, refusal: RefusalKind): RiskDecision => ({ tier: "high_risk_clinical", rule: rule.slice(0, 120), reason, refusal });
const REASON: Record<RefusalKind, string> = {
  personal_safety: "The learner's words are about their own safety.", emergency: "An emergency happening now.",
  identifiable: "Details that identify a real person.", administration: "A decision about giving a medicine to a real person.",
  real_patient: "A real patient the learner is caring for.", clinical_high: "High-risk clinical content.", unrecognised: "Not recognised.",
};

/**
 * Pure. SCHOLAR-RISK-01, the four categories (owner GO 31 Oct 2026), decided in this order:
 *
 *   4  real-patient clinical decision support -- real-patient evidence in the learner's own words (request-intent.ts),
 *      or a high-risk rule the policy does not name as ambiguous. RESTRICTED, whatever the framing, the purpose already
 *      confirmed, or the model that would be eligible. "For my studies" never lowers it.
 *   3  ambiguous clinical context -- a giving decision (an ambiguous rule or first-person "should I give") or a named
 *      person, with no study framing; or an unrecognised request the policy clarifies. The learner is asked ONCE; with
 *      purpose "education" it runs as clinical education.
 *   2  clinical educational -- the same inside study framing, or recognised by the rules.
 *   1  general educational -- recognised by the rules.
 *
 * Null: nothing for the intent layer to decide (the rules' decision stands, and the mode logic runs as before). An
 * activity whose own floor is high risk is left as it was, except that real-patient evidence still restricts it.
 */
export function decideIntent(rules: RiskPolicy, subject: ResolvedRiskSubject, activityFloor: RiskTier, d: RiskDecision, purpose: Purpose): GateVerdict | null {
  const intent = rules.intent ?? NO_INTENT;
  // Item 8: every reading of the request, the more cautious result. Item 5: where it was asked (subject.intentContext).
  const w = subject as WithReadings;
  const f = cautiousIntentFeatures(w.readings?.[0] ?? subject.requestText ?? subject.text, { context: subject.intentContext, vocabulary: w.vocabulary ?? materialVocabulary(subject) });
  const highHits = rules.rules.filter(r => r.tier === "high_risk_clinical" && ruleMatches(r, subject));
  const ambiguous = new Set(intent.ambiguousRules);
  const hard = highHits.filter(r => !ambiguous.has(r.id));
  const restrict = (k: RefusalKind, candidates: readonly RiskRule[]): GateVerdict => {
    const byRule = candidates.find(r => ruleRefusal(r) === k);
    return { kind: "restricted", risk: high(f.realPatient === k || !byRule ? `intent:${k}` : byRule.id, REASON[k], k) };
  };
  if (activityFloor === "high_risk_clinical") {
    const own = hard.filter(r => r.scope === "request");
    const k = firstKind([f.realPatient, ...own.map(ruleRefusal)]);
    return k ? restrict(k, own) : null;
  }
  // Category 4: evidence of a real person, now, or a configured high-risk rule that is not ambiguous.
  const k4 = firstKind([f.realPatient, ...hard.map(ruleRefusal)]);
  if (k4) return restrict(k4, hard);
  const floor = higherRisk("clinical_educational", activityFloor);
  const educational = (rule: string, reason: string): GateVerdict => ({ kind: "classified", risk: { tier: floor, rule: rule.slice(0, 120), reason } });
  const askOrConfirm = (rule: string, refusal: RefusalKind, allowed: boolean): GateVerdict => {
    if (!allowed) return { kind: "classified", risk: high(rule, REASON[refusal], refusal) };
    if (purpose === "education") return educational(`education_confirmed:${rule}`, "The learner confirmed this is for study, not about a real patient.");
    return { kind: "clarify", risk: high(rule, REASON[refusal], refusal) };
  };
  // Categories 2 and 3: a decision about giving, or a named person.
  const giving = f.administration || highHits.some(r => ambiguous.has(r.id));
  if (giving) {
    if (f.studyFraming || f.caseFraming) return educational("intent:framed_administration", "A medicines question inside study framing (theory, a case or a calculation).");
    return askOrConfirm("intent:ambiguous_administration", "administration", intent.clarifyAmbiguous);
  }
  if (f.namedPerson) {
    if (f.caseFraming) return educational(`intent:case:${d.rule}`, "A named person inside a study case.");
    return askOrConfirm(`intent:ambiguous_person:${d.rule}`, "real_patient", intent.clarifyAmbiguous);
  }
  // Unrecognised: as the policy says.
  if (d.rule === "unknown:no_rule") {
    if (intent.unknownHandling === "educational_if_study_intent" && f.questionFraming) return educational("intent:study_framing", "Not recognised by a rule, asked as a study question.");
    // Item 5: no study verb, but asked inside a lesson or material and about its content: study.
    if (intent.unknownHandling === "educational_if_study_intent" && f.contextFraming) return educational("intent:lesson_context", "Not recognised by a rule, asked about the lesson or material it was asked in.");
    if (intent.unknownHandling !== "high_risk") return askOrConfirm("intent:unrecognised", "unrecognised", true);
  }
  return null;
}

/** The question asked instead of a refusal, and what each answer does. SCHOLAR-RISK-01: the owner's wording (31 Oct). */
export const CLARIFY = {
  question: "Is this for your studies or about a patient you are currently caring for?",
  education: "It's for my studies",
  patient: "It's about a patient I'm caring for",
  patientAnswer: "For a patient you are caring for, please follow your local clinical guidance and speak to the nurse in charge, your clinical team or your supervisor. In an emergency, use your local emergency procedure straight away. I can help you study the topic in general terms if you'd like.",
} as const;

/**
 * SCHOLAR-RISK-01: what a refusal says, by its actual reason (RiskDecision.refusal). Each one says why in plain words and
 * gives a safe way to carry on learning. Never the real-patient words for a request that was only unrecognised.
 */
export const REFUSAL: Record<RefusalKind, string> = {
  real_patient: "I can't help with decisions about a real patient's care here. For a patient you are caring for, follow your local clinical guidance and speak to the nurse in charge, your clinical team or your supervisor. If you're studying the topic, ask about it in general terms (for example, \"explain how this condition is assessed and managed\") and I can help you learn it.",
  administration: "I can't advise on giving or prescribing a medicine to a real person. Check the prescription, your local medicines policy and the formulary, and ask the prescriber, a pharmacist or the nurse in charge. To study it, ask in general terms, for example how the medicine works, its dosing principles, or a practice calculation, and I can help.",
  emergency: "This sounds like an emergency happening now. Use your local emergency procedure straight away: call for help (your emergency number, or the crash or rapid response call) and follow your resuscitation training. I can't direct emergency care here. When it's safe, I can help you study the topic.",
  personal_safety: "I'm sorry you're going through this. I can't help with this here, but you don't have to deal with it alone. If you might act on these thoughts or are in danger now, call your local emergency number. Otherwise, please talk to someone you trust, your doctor, or a crisis helpline in your country today.",
  identifiable: "Your message includes details that could identify a real person (such as a hospital or NHS number or a date of birth). Please remove them and ask again in general terms. I can help with the topic without them.",
  clinical_high: "I can't help with this here: it's treated as high-risk clinical content, which AI help here isn't approved to answer. If you're studying the topic, ask it as a general study question (for example, \"explain how this works\") and I can help you learn it.",
  unrecognised: "I couldn't tell what this question is about, so I haven't answered it. If it's a study question, try asking it again with a little more detail, for example \"explain...\", \"compare...\" or \"what are the causes of...\".",
};

/** Owner item 5: the unrecognised words in Learn, where the notes and research are one step away. */
export const REFUSAL_LEARN_UNRECOGNISED = "I couldn't tell what this question is about, so I haven't answered it. Try asking it again with a little more detail (for example \"explain...\", \"compare...\" or \"what are the causes of...\"), search your notes for the topic, or look for references on it from this lesson.";

/** The general high-risk words (kept under their old name: every page that shows them keeps them as the server wrote them). */
export const SUPPORTIVE_REFUSAL = REFUSAL.clinical_high;
/** Pure: the words for a high-risk refusal, by its reason. */
export const refusalFor = (risk: Pick<RiskDecision, "refusal" | "recovery"> | undefined): string =>
  risk?.refusal === "unrecognised" && risk.recovery === "learn" ? REFUSAL_LEARN_UNRECOGNISED : REFUSAL[risk?.refusal ?? "clinical_high"] ?? SUPPORTIVE_REFUSAL;
const REFUSAL_TEXTS = new Set<string>([...Object.values(REFUSAL), REFUSAL_LEARN_UNRECOGNISED]);
/** Pure: whether a message is one of the refusal words above (a page shows it as the server wrote it). */
export const isSupportiveRefusal = (text: unknown): boolean => typeof text === "string" && REFUSAL_TEXTS.has(text);

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
