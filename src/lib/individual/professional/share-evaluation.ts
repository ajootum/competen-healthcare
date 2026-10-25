/* eslint-disable @typescript-eslint/no-explicit-any */
import { isUuid } from "./validate";
import { loadIndividualPolicy } from "../policy";
import { DIMENSIONS, FORMATIVE_NOTICE, MISSING_NOTICE, type Dimension } from "./evaluation-vocabulary";
import { FINDING_STATE_LABEL, type Finding, type SourceRef } from "./evaluation";

// ── EVALUATIONS A PERSON CHOOSES TO SHOW ON ONE PASSPORT LINK ── COMPETEN-PROFESSIONAL-EVALUATION-01 s13, migration 530 ──
//
// Selective, never automatic: nothing is shared unless the person ticks a RECORDED evaluation for that link, and only
// while the evaluation policy offers sharing (checked when the link is made AND when it is shown). A shared evaluation
// is shown as FORMATIVE, with its six findings in words, its source records (kind, label, provenance, date), methods,
// confidence and limitations, and the distinction between self-reported, document-supported, formative and
// independently verified evidence. It is never a credential and never "verified competence".
//
// ⚠ NEVER PRIVATE WORDS. Notes on an evaluation, AI text, and private reflections and goal reviews never travel: private
// sources are counted ("2 private reflections, not shown"), never named.

const PRIVATE_KINDS = new Set(["reflection", "learning_reflection", "goal_review"]);

/** Pure: the evaluations ticked on the share form (fields named evaluation:<id>). */
export function parseShareEvaluations(b: Record<string, unknown>): string[] {
  const ticked = (v: unknown) => v === true || v === "true" || v === "on" || v === "1";
  return [...new Set(Object.keys(b).filter(k => k.startsWith("evaluation:") && ticked(b[k])).map(k => k.slice(11)).filter(isUuid))].slice(0, 50);
}

/** Before minting: sharing is offered and every chosen evaluation is the person's own. null = fine. */
export async function checkShareEvaluations(admin: any, userId: string, ids: readonly string[], sharing: "offer" | "off"): Promise<string | null> {
  if (!ids.length) return null;
  if (sharing !== "offer") return "Evaluations cannot be added to a link.";
  const { data, error } = await admin.from("individual_professional_evaluation").select("id").eq("user_id", userId).in("id", [...ids]);
  if (error) return "Your evaluations could not be checked just now. Try again shortly.";
  return (data ?? []).length === ids.length ? null : "Only your own recorded evaluations may be added to a link.";
}

/** After minting: the chosen evaluations on that link. */
export async function saveShareEvaluations(admin: any, userId: string, shareTokenId: string, ids: readonly string[]): Promise<boolean> {
  if (!ids.length) return true;
  const { error } = await admin.from("individual_professional_share_evaluation").insert(ids.map(evaluation_id => ({ share_token_id: shareTokenId, user_id: userId, evaluation_id })));
  return !error;
}

export type SharedEvaluation = {
  id: string; scope: string; evaluatedAt: string; frameworkVersions: string[]; interpretation: string;
  findings: { dimension: Dimension; label: string; state: string; summary: string; limitations: string[] }[];
  sources: Pick<SourceRef, "kind" | "title" | "provenance" | "date" | "method" | "frameworkVersion">[];
  privateCount: number; notices: string[];
};

/** Pure: what a link shows of one snapshot. */
export function sharedView(row: any): SharedEvaluation {
  const f = (row.findings ?? {}) as Record<Dimension, Finding>;
  const sources = ((row.sources ?? []) as SourceRef[]);
  return {
    id: row.id, scope: row.scope_label, evaluatedAt: row.evaluated_at, frameworkVersions: row.framework_versions ?? [],
    interpretation: row.interpretation === "deterministic_and_ai" ? "Deterministic findings (an AI summary exists and is not shared)" : "Deterministic findings",
    findings: DIMENSIONS.filter(([d]) => f[d]).map(([d, label]) => ({
      dimension: d, label, state: d === "evidence_confidence" && f[d].confidence ? `${f[d].confidence} confidence in the evidence` : FINDING_STATE_LABEL[f[d].state] ?? f[d].state,
      summary: f[d].summary, limitations: (f[d].limitations ?? []).slice(0, 6),
    })),
    sources: sources.filter(s => !PRIVATE_KINDS.has(s.kind)).map(s => ({ kind: s.kind, title: s.title, provenance: s.provenance, date: s.date, method: s.method, frameworkVersion: s.frameworkVersion })),
    privateCount: sources.filter(s => PRIVATE_KINDS.has(s.kind)).length,
    notices: [FORMATIVE_NOTICE, MISSING_NOTICE],
  };
}

/** For /verify: the evaluations a link carries, re-checked now. null = could not be read, [] = none. */
export async function loadSharedEvaluations(admin: any, tokenId: string, userId: string, sharing: "offer" | "off"): Promise<SharedEvaluation[] | null> {
  try {
    const { data, error } = await admin.from("individual_professional_share_evaluation").select("evaluation_id").eq("share_token_id", tokenId).eq("user_id", userId).limit(50);
    if (error) return /does not exist|schema cache|could not find/i.test(error.message ?? "") ? [] : null;
    if (!data?.length || sharing !== "offer") return [];
    const { data: rows, error: e2 } = await admin.from("individual_professional_evaluation")
      .select("id, scope_label, evaluated_at, framework_versions, interpretation, findings, sources").eq("user_id", userId).in("id", data.map((r: any) => r.evaluation_id));
    if (e2) return null;
    return (rows ?? []).sort((a: any, b: any) => String(b.evaluated_at).localeCompare(String(a.evaluated_at))).map(sharedView);
  } catch { return null; }
}

/**
 * For the Lifelong Passport (Stage 7) and any other composed Passport view: the evaluations a link carries, re-checked
 * now under the current sharing policy. null = could not be read, [] = none. Each stays formative: never relabel it.
 */
export async function sharedEvaluationsFor(admin: any, tokenId: string, userId: string): Promise<SharedEvaluation[] | null> {
  return loadSharedEvaluations(admin, tokenId, userId, (await loadIndividualPolicy(admin)).professionalEvaluation.sharing);
}
