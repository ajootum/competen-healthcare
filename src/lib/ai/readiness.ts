/* eslint-disable @typescript-eslint/no-explicit-any */
import { activityReadiness, type ActivityReadiness } from "./allowance";
import { AI_PRODUCTS, type AiProduct } from "./fair-use-policy";
import type { RiskTier } from "./clinical-risk";

// ── AI READINESS (owner instruction SCHOLAR-EDU-AI-01, 30 Oct 2026, sections 6 and 7) ─────────────────────────────
//
// For /super-admin/ai/fair-use: which activities a student can actually use, at which clinical risk tier, on which model,
// and which student experiences an activity sits behind. Computed from the published policy, routing and eligibility
// (allowance.ts activityReadiness), so it changes with configuration and never decides anything itself.
//
// Scholar's study material is almost always clinical (the clinical.topics rule), so an activity with no route at
// clinical educational is a GAP: its button would refuse on clinical notes. High risk is shown, not counted as a gap:
// most activities rightly never run at high risk.

/** Where each Scholar activity is used by a student (from the routes that call it). Shown beside the activity. */
export const SCHOLAR_EXPERIENCES: Record<string, string> = {
  teach: "Learn: Teach me; practice papers: revision guide",
  explain: "Learn: Explain",
  simplify: "Learn: Simplify",
  deeper: "Learn: Go deeper; practice papers: suggested answer, Check my attempt, research",
  examples: "Learn: Examples",
  summary: "Learn: Summary",
  ask: "Learn: Ask; Personal AI; practice papers: follow-up",
  check: "Learn: check question",
  clarify: "Learn: clarification check",
  tutor_continue: "Learn: tutor conversation",
  map: "Library: map notes to competencies; practice papers: transcription",
  questions: "Revise: generate practice questions; Learn: questions",
  evaluate: "Revise: short-answer feedback; Apply: clinical case feedback",
  case_steps: "Apply: clinical cases",
};

export const experiencesOf = (product: AiProduct, code: string): string | null => (product === "scholar" ? SCHOLAR_EXPERIENCES[code] ?? null : null);

export type ReadinessRow = ActivityReadiness & { experiences: string | null; gap: boolean };
export type ProductReadiness = { product: AiProduct; rows: ReadinessRow[] | null };

/** Pure: an activity is a gap when no route serves it at clinical educational (at or above its floor). */
export function isGap(r: Pick<ActivityReadiness, "floor" | "routes">): boolean {
  const at: RiskTier = r.floor === "high_risk_clinical" ? "high_risk_clinical" : "clinical_educational";
  return !r.routes[at];
}

/** Pure: the gaps, as "code (label)" strings, for a publish warning and its audit record. */
export const gapList = (rows: readonly ReadinessRow[] | null): string[] => (rows ?? []).filter(r => r.gap).map(r => `${r.code} (${r.label})`);

export async function loadReadiness(admin: any, products: readonly AiProduct[] = AI_PRODUCTS): Promise<ProductReadiness[]> {
  return Promise.all(products.map(async product => {
    const rows = await activityReadiness(admin, product).catch(() => null);
    return { product, rows: rows ? rows.map(r => ({ ...r, experiences: experiencesOf(product, r.code), gap: isGap(r) })) : null };
  }));
}
