/* eslint-disable @typescript-eslint/no-explicit-any */

// ── PROFESSIONAL LEARNING AND CPD CONFIGURATION ── COMPETEN-PROFESSIONAL-LCPD-01 s11 ─────────────────────────────────
//
// One CONFIG-002 document in the Individual policy scope (platform / individual), drafted and published with the rest of
// the Individual policy through the existing audited, versioned route (/api/hq/individual/config, hq.individual.config.
// manage). Unpublished means the defaults below. What it configures:
//
//   activityTypes        the CPD activity types offered (code and label). The defaults are the 373 types and the owner's
//                        new ones. Migration 490 lets the schema accept any code; the person is offered these only.
//   reflectionTemplates  quick, guided and detailed reflection, each a label and its prompts (LCPD-3).
//   requirements         CPD requirements, each with an identifiable AUTHORITATIVE SOURCE and a REVIEW STATUS (LCPD-5).
//                        NONE is seeded: no regulatory rule is invented and none is hard-coded for any country.
//   passportShareable    which kinds of learning evidence a person may choose to share on a Passport link (LCPD-6).
//
// ⚠ NOT A COMPLIANCE ENGINE. A requirement here is what an administrator recorded from a named source, with the review
// status they gave it. Summaries say "recorded" and "potentially eligible", never "compliant" or "accepted": Competen has
// no authorised route to verify CPD with any regulator.

export const LCPD_PATH = "individual.professional_lcpd";

export type ActivityType = { code: string; label: string };
export type ReflectionTemplate = { code: string; label: string; prompts: string[] };
export type ReviewStatus = "unreviewed" | "under_review" | "reviewed";
export type CpdRequirement = {
  code: string; label: string; profession: string; jurisdiction: string; body: string;
  source: { title: string; reference: string | null; url: string | null };
  reviewStatus: ReviewStatus; reviewedOn: string | null;
  cycleMonths: number; requiredHours: number | null; requiredCredits: number | null;
  /** Activity codes that may count. Empty means every configured type may count. */
  eligibleTypes: string[];
  mandatoryCategories: { label: string; types: string[]; minHours: number }[];
  evidence: string | null; reportingPeriod: string | null;
  effectiveFrom: string; effectiveTo: string | null; version: string;
};
export type ShareableClass = "platform_recorded" | "source_linked" | "self_declared";
export type LcpdConfig = { activityTypes: ActivityType[]; reflectionTemplates: ReflectionTemplate[]; requirements: CpdRequirement[]; passportShareable: ShareableClass[] };

export const REVIEW_LABEL: Record<ReviewStatus, string> = {
  unreviewed: "Not yet reviewed against its source",
  under_review: "Being reviewed against its source",
  reviewed: "Reviewed against its source",
};

/**
 * 373's nine types, as its CHECK listed them. Mirrored here so this Individual-scope module imports nothing of Professional
 * (individual-professional-harness R2). lcpd.test pins it equal to professional/vocabulary CPD_ACTIVITY.
 */
export const LEGACY_ACTIVITY: readonly [string, string][] = [
  ["course", "Formal course"], ["workshop", "Workshop"], ["conference", "Conference"], ["self_study", "Self-directed learning"], ["simulation", "Simulation"],
  ["osce", "OSCE practice"], ["teaching", "Teaching"], ["research", "Research"], ["other", "Other"],
];
/** The owner's new types (LCPD-2), beside 373's. Independent study is 373's self_study. */
export const NEW_ACTIVITY: readonly [string, string][] = [
  ["workplace_learning", "Workplace learning"], ["mentorship", "Mentorship"], ["quality_improvement", "Quality improvement"], ["reflective_practice", "Reflective practice"],
];
export const LEGACY_CODES: ReadonlySet<string> = new Set<string>(LEGACY_ACTIVITY.map(([c]) => c));

export const DEFAULT_LCPD: LcpdConfig = {
  activityTypes: [...LEGACY_ACTIVITY.filter(([c]) => c !== "other"), ...NEW_ACTIVITY, ["other", "Other"]].map(([code, label]) => ({ code, label })),
  reflectionTemplates: [
    { code: "quick", label: "Quick reflection", prompts: ["What did you learn?"] },
    { code: "guided", label: "Guided reflection", prompts: [
      "What did you learn?", "Why was it relevant to your practice?", "How might your practice change?",
      "Have you applied it yet? How?", "What further development do you need?",
    ] },
    { code: "detailed", label: "Detailed reflection", prompts: [
      "What did you learn, and what surprised you?", "Why was it relevant to your role and the people you care for?",
      "How might your practice change, and what would show it?", "Have you applied it yet? Describe a situation.",
      "What further development do you need, and how will you get it?",
    ] },
  ],
  requirements: [],
  passportShareable: ["platform_recorded", "source_linked"],
};

const CODE = /^[a-z][a-z0-9_]{1,40}$/, REQ_CODE = /^[a-z][a-z0-9_]{1,60}$/, DAY = /^\d{4}-\d{2}-\d{2}$/;
// A reflection template code is stored on 470 individual_professional_reflection.template_code, whose CHECK allows
// lower-case letters, digits and hyphens: the same rule here, so a configured template can always be saved.
const TEMPLATE_CODE = /^[a-z0-9][a-z0-9-]{0,62}$/;
const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "");
const num = (v: unknown, min: number, max: number): number | null => { const n = Number(v); return v === null || v === undefined || v === "" || !Number.isFinite(n) || n < min || n > max ? null : Math.round(n * 10) / 10; };
const day = (v: unknown): string | null => (typeof v === "string" && DAY.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) ? v : null);
const https = (v: unknown): string | null => { const s = str(v, 400); return /^https:\/\/[^\s/]+\.[^\s]+$/i.test(s) ? s : null; };

/** Pure: a requirement, kept to its known fields, or why it is not one. */
export function checkRequirement(r: any, typeCodes: ReadonlySet<string>): { ok: true; value: CpdRequirement } | { ok: false; error: string } {
  const code = str(r?.code, 61).toLowerCase(), label = str(r?.label, 200);
  if (!REQ_CODE.test(code)) return { ok: false, error: "A requirement code is lower-case letters, digits and underscores." };
  if (label.length < 3) return { ok: false, error: `${code}: name the requirement.` };
  const profession = str(r?.profession, 120), jurisdiction = str(r?.jurisdiction, 120), body = str(r?.body, 200);
  if (!profession || !jurisdiction || !body) return { ok: false, error: `${code}: a requirement names its profession, jurisdiction and professional or regulatory body.` };
  const source = { title: str(r?.source?.title, 300), reference: str(r?.source?.reference, 300) || null, url: https(r?.source?.url) };
  if (source.title.length < 3) return { ok: false, error: `${code}: a requirement names its authoritative source.` };
  const reviewStatus = (["unreviewed", "under_review", "reviewed"] as const).includes(r?.reviewStatus) ? r.reviewStatus as ReviewStatus : null;
  if (!reviewStatus) return { ok: false, error: `${code}: give the requirement its review status.` };
  const reviewedOn = day(r?.reviewedOn);
  if (reviewStatus === "reviewed" && !reviewedOn) return { ok: false, error: `${code}: a reviewed requirement says when it was reviewed.` };
  const cycleMonths = num(r?.cycleMonths, 1, 120);
  if (!cycleMonths || !Number.isInteger(cycleMonths)) return { ok: false, error: `${code}: the CPD cycle is 1 to 120 whole months.` };
  const requiredHours = num(r?.requiredHours, 0, 10000), requiredCredits = num(r?.requiredCredits, 0, 10000);
  if (requiredHours === null && requiredCredits === null) return { ok: false, error: `${code}: a requirement sets required hours, required credits, or both.` };
  const types = (v: unknown) => (Array.isArray(v) ? [...new Set(v.map(x => str(x, 41)).filter(c => CODE.test(c)))] : []);
  const eligibleTypes = types(r?.eligibleTypes);
  const unknown = eligibleTypes.filter(c => !typeCodes.has(c));
  if (unknown.length) return { ok: false, error: `${code}: ${unknown.join(", ")} is not a configured activity type.` };
  const mandatoryCategories = (Array.isArray(r?.mandatoryCategories) ? r.mandatoryCategories : []).slice(0, 20).map((m: any) => ({ label: str(m?.label, 120), types: types(m?.types).filter(c => typeCodes.has(c)), minHours: num(m?.minHours, 0, 10000) ?? 0 }))
    .filter((m: { label: string; types: string[] }) => m.label && m.types.length);
  const effectiveFrom = day(r?.effectiveFrom), effectiveTo = day(r?.effectiveTo);
  if (!effectiveFrom) return { ok: false, error: `${code}: give the date the requirement takes effect.` };
  if (effectiveTo && effectiveTo < effectiveFrom) return { ok: false, error: `${code}: it cannot end before it takes effect.` };
  const version = str(r?.version, 40);
  if (!version) return { ok: false, error: `${code}: give the version of the source the requirement reflects.` };
  return { ok: true, value: {
    code, label, profession, jurisdiction, body, source, reviewStatus, reviewedOn, cycleMonths, requiredHours, requiredCredits, eligibleTypes, mandatoryCategories,
    evidence: str(r?.evidence, 1000) || null, reportingPeriod: str(r?.reportingPeriod, 200) || null, effectiveFrom, effectiveTo, version,
  } };
}

/** Pure: the effective configuration from a published document. Anything invalid falls back to the default, never a guess. */
export function resolveLcpd(doc: any): LcpdConfig {
  const at = Array.isArray(doc?.activityTypes) ? doc.activityTypes : null;
  const typesRaw: ActivityType[] = at ? at.map((t: any) => ({ code: str(t?.code, 41), label: str(t?.label, 80) })).filter((t: ActivityType) => CODE.test(t.code) && t.label) : [];
  const seen = new Set<string>();
  const activityTypes = typesRaw.filter(t => !seen.has(t.code) && seen.add(t.code)).slice(0, 60);
  const types = activityTypes.length ? activityTypes : DEFAULT_LCPD.activityTypes;
  const codes = new Set(types.map(t => t.code));
  const rt = Array.isArray(doc?.reflectionTemplates) ? doc.reflectionTemplates : null;
  const reflectionTemplates: ReflectionTemplate[] = rt ? rt.map((t: any) => ({ code: str(t?.code, 41), label: str(t?.label, 80), prompts: (Array.isArray(t?.prompts) ? t.prompts : []).map((p: unknown) => str(p, 300)).filter(Boolean).slice(0, 10) }))
    .filter((t: ReflectionTemplate) => TEMPLATE_CODE.test(t.code) && t.label && t.prompts.length).slice(0, 10) : [];
  const requirements = (Array.isArray(doc?.requirements) ? doc.requirements : []).slice(0, 100).map((r: any) => checkRequirement(r, codes)).filter((r: any) => r.ok).map((r: any) => r.value as CpdRequirement);
  const rq = new Set<string>();
  const ps = Array.isArray(doc?.passportShareable) ? doc.passportShareable.filter((c: unknown) => c === "platform_recorded" || c === "source_linked" || c === "self_declared") : null;
  return {
    activityTypes: types,
    reflectionTemplates: reflectionTemplates.length ? reflectionTemplates : DEFAULT_LCPD.reflectionTemplates,
    requirements: requirements.filter((r: CpdRequirement) => !rq.has(r.code) && rq.add(r.code)),
    passportShareable: ps ? [...new Set(ps)] as ShareableClass[] : DEFAULT_LCPD.passportShareable,
  };
}

/** Pure: a draft from HQ, validated whole. Requirements that fail say why, so nothing is silently dropped at save. */
export function checkLcpdDraft(input: any): { ok: true; settings: Record<string, unknown> } | { ok: false; error: string } {
  const r = resolveLcpd(input);
  const codes = new Set(r.activityTypes.map(t => t.code));
  for (const req of Array.isArray(input?.requirements) ? input.requirements : []) {
    const c = checkRequirement(req, codes);
    if (!c.ok) return { ok: false, error: c.error };
  }
  if (Array.isArray(input?.activityTypes) && input.activityTypes.length && r.activityTypes === DEFAULT_LCPD.activityTypes) return { ok: false, error: "Each activity type needs a code (lower-case letters, digits, underscores) and a label." };
  return { ok: true, settings: { activityTypes: r.activityTypes, reflectionTemplates: r.reflectionTemplates, requirements: r.requirements, passportShareable: r.passportShareable } };
}

/** The published configuration. Unreadable or unpublished: the defaults (no requirement). Never throws. */
export async function loadLcpdConfig(admin: any): Promise<LcpdConfig> {
  try {
    const { data, error } = await admin.from("workspace_config_overrides").select("published").eq("scope_type", "platform").eq("scope_ref", "individual").eq("config_path", LCPD_PATH).maybeSingle();
    return error ? DEFAULT_LCPD : resolveLcpd(data?.published ?? null);
  } catch { return DEFAULT_LCPD; }
}
