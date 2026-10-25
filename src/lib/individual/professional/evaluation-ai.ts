/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash } from "node:crypto";
import { DIMENSIONS } from "./evaluation-vocabulary";
import { FINDING_STATE_LABEL, type Evaluation } from "./evaluation";

// ── MY PROFESSIONAL EVALUATION: AI ASSISTANCE ── COMPETEN-PROFESSIONAL-EVALUATION-01 s11 ───────────────────────────────
//
// The Holdings Personal AI (askProfessionalAssistant: guard, fair use, model eligibility, gateway, identifier screen,
// audit) is asked to SUMMARISE the deterministic findings, explain their limitations and suggest opportunities. It is
// sent the findings' words and counts, never a private reflection, note or document (professional_evaluation_ai_reflections
// is fixed "off"). Its answer is shown as AI interpretation, apart from the findings, and changes no finding.
//
// ⚠ PROVENANCE YOU CAN CHECK. The AI route writes an ids-only audit row with the model, the policy version and the
// sha256 of the answer. A snapshot may carry AI text only when that row exists for this person, so the model and
// policy version a snapshot names are the ones that actually answered.

export const EVALUATION_AI_ACTION = "individual_professional_evaluation_ai";
export const AI_LABEL = "AI interpretation: a summary written by the personal AI from the findings above. It is not a finding, not an assessment and not verification.";
export const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
export const aiPolicyVersion = (configVersion: string | null) => `professional_evaluation_ai:on@${configVersion ?? "defaults"}`;

/** Pure: the question, from the deterministic findings only. */
export function aiEvaluationQuestion(ev: Evaluation): string {
  const lines = DIMENSIONS.map(([d, label]) => `- ${label}: ${FINDING_STATE_LABEL[ev.findings[d].state]}. ${ev.findings[d].summary}`);
  return [
    `Summarise this formative evaluation of my own professional development records for "${ev.scope.label}".`,
    "Deterministic findings, by separate dimension:", ...lines,
    `Limitations: ${ev.limitations.slice(0, 8).join(" ")}`,
    ev.competencies.length ? `Competencies in scope: ${ev.competencies.slice(0, 8).map(c => c.name).join("; ")}.` : "No competency catalogue is used for this scope.",
    "In under 200 words: summarise what the evidence supports, explain the evidence limitations, and suggest development opportunities.",
    "Keep the dimensions separate and give no score. Do not invent evidence. Do not say or imply that I am competent or incompetent: missing records are not evidence of a gap.",
    "Do not verify competence, issue credentials, or make licensing, employment or recruitment judgements.",
  ].join("\n");
}

/** True when this exact AI text was produced for this person by the AI route within the last day. */
export async function aiProvenanceHolds(admin: any, userId: string, v: { text: string; model: string; policyVersion: string }): Promise<boolean> {
  try {
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { data, error } = await admin.from("audit_log").select("new_value, created_at").eq("actor_id", userId).eq("action", EVALUATION_AI_ACTION).gte("created_at", since).limit(200);
    if (error) return false;
    const digest = sha256(v.text);
    return (data ?? []).some((r: any) => r?.new_value?.text_sha256 === digest && r?.new_value?.model === v.model && r?.new_value?.policy_version === v.policyVersion);
  } catch { return false; }
}
