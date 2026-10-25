/* eslint-disable @typescript-eslint/no-explicit-any */

// ── THE LEARNING POLICY AND ITS SWITCHES ── COMPETEN-LEARNING-01, product definition s18 ───────────────────────────
//
// One CONFIG-002 document at scope platform / learning, path learning.policy, drafted and published through the
// Workspace Configuration Engine (versioned, in workspace_config_audit). The door that writes it is /api/hq/learning,
// behind hq.learning.course.publish. Offering types, formats and levels are CONFIGURATION: nothing below hard-codes a
// profession, a country, a price or a workflow (owner GO s1, no-code).
//
// ⚠ POLICY TUNES, THE DATABASE ENFORCES. Independence of review, publication, price approval and certificate issuance,
// freeze from submission, delivery only of a deliverable version and the course-entitlement rules are 460-464.
//
// ⚠ TWO SWITCHES, BOTH OFF UNLESS WRITTEN. learning_app opens Competen Learning (the studio, the catalogue, the record).
// The learner side ALSO sits behind the Individual release gate, because it is reached through the Individual guard.
// learning_commerce additionally opens paid course checkout, which also needs the Holdings payment gateway's env keys.
// No migration writes either row: production stays dark.

export const LEARNING_SCOPE = { scopeType: "platform", scopeRef: "learning" } as const;
export const LEARNING_POLICY_PATH = "learning.policy";

export type LearningPolicy = {
  /** Offering types an author may choose (learning_offering.offering_type). Lowercase codes. */
  offeringTypes: string[];
  /** Delivery formats (self_paced, workshop, ...). */
  formats: string[];
  /** Educational levels. */
  levels: string[];
  /** The purchase terms a new price is proposed under. Must be a version LEARNING_TERMS holds. */
  termsVersion: string;
  /** External listings are flagged for review this many days before their review date. */
  listingReviewWarningDays: number;
  /** Knowledge checks: attempts allowed per check (1-20). */
  checkAttempts: number;
};

const CODE = /^[a-z][a-z_]{1,30}$/;
export const DEFAULT_LEARNING_POLICY: LearningPolicy = {
  offeringTypes: ["course", "module", "workshop", "blended", "simulation", "programme", "pathway"],
  formats: ["self_paced", "microlearning", "instructor_led", "blended", "practical", "simulation", "external"],
  levels: ["foundation", "intermediate", "advanced", "specialist"],
  termsVersion: "learning-terms/1",
  listingReviewWarningDays: 30,
  checkAttempts: 5,
};

const codes = (v: unknown, fb: string[]) => {
  const xs = Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && CODE.test(x)))].slice(0, 30) : [];
  return xs.length ? xs : fb;
};
const int = (v: unknown, lo: number, hi: number, fb: number) => { const n = Number(v); return Number.isInteger(n) ? Math.min(hi, Math.max(lo, n)) : fb; };

/** Pure: a published Learning policy, clamped, over the defaults. */
export function resolveLearningPolicy(s: any): LearningPolicy {
  const d = DEFAULT_LEARNING_POLICY;
  return {
    offeringTypes: codes(s?.offeringTypes, d.offeringTypes),
    formats: codes(s?.formats, d.formats),
    levels: codes(s?.levels, d.levels),
    termsVersion: typeof s?.termsVersion === "string" && LEARNING_TERMS[s.termsVersion] ? s.termsVersion : d.termsVersion,
    listingReviewWarningDays: int(s?.listingReviewWarningDays, 0, 365, d.listingReviewWarningDays),
    checkAttempts: int(s?.checkAttempts, 1, 20, d.checkAttempts),
  };
}

/** The published Learning policy. Fail-soft to the defaults. */
export async function loadLearningPolicy(admin: any): Promise<LearningPolicy> {
  try {
    const { data, error } = await admin.from("workspace_config_overrides").select("published")
      .eq("scope_type", LEARNING_SCOPE.scopeType).eq("scope_ref", LEARNING_SCOPE.scopeRef).eq("config_path", LEARNING_POLICY_PATH).maybeSingle();
    return error ? { ...DEFAULT_LEARNING_POLICY } : resolveLearningPolicy(data?.published);
  } catch { return { ...DEFAULT_LEARNING_POLICY }; }
}

/**
 * The course purchase terms, by version. A price is proposed under one version and a checkout copies it, so what a
 * person agreed to is always recoverable. ⚠ PENDING LEGAL REVIEW: these words are a staging draft, not a legal
 * instrument, and no real charging is authorised.
 */
export const LEARNING_TERMS: Record<string, { title: string; text: string }> = {
  "learning-terms/1": {
    title: "Competen Learning course access terms (staging draft)",
    text: "You are buying access to one Competen Learning course, provided by Competen Holdings, for the period shown with the price "
      + "(or, where no period is shown, for as long as the course is offered under these terms). It does not include Competen Scholar or "
      + "Competen Professional. Access starts when the payment is confirmed by the payment provider to Competen, never from the browser. "
      + "Your progress, completion and any certificate stay in your learning record after access ends. A certificate states what you "
      + "completed or what the course assessed. It is not a professional accreditation, a regulatory approval or a verification of "
      + "clinical competence.",
  },
};

export const LEARNING_APP_FLAG = "learning_app";
export const LEARNING_COMMERCE_FLAG = "learning_commerce";
export const LEARNING_OFF = "Competen Learning is not switched on in this environment.";

async function flag(admin: any, name: string): Promise<boolean> {
  if (!admin) return false;
  try {
    const { data, error } = await admin.from("practice_platform_flags").select("enabled").eq("flag", name).maybeSingle();
    return !error && data?.enabled === true;
  } catch { return false; }
}

/** The studio, catalogue and record. Off unless the row exists and is on. Never throws. */
export async function learningEnabled(admin: any): Promise<boolean> { return flag(admin, LEARNING_APP_FLAG); }

/** Paid course checkout: learning_app AND learning_commerce. Real charging additionally needs live gateway keys. */
export async function learningCommerceEnabled(admin: any): Promise<boolean> {
  return (await flag(admin, LEARNING_APP_FLAG)) && (await flag(admin, LEARNING_COMMERCE_FLAG));
}
