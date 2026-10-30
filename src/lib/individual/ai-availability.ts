/* eslint-disable @typescript-eslint/no-explicit-any */

// ── HFE-01 WAVE 1: ONE ANSWER TO "WHY CAN'T I USE AI HERE?" ─────────────────────────────────────────────
//
// Pure. Every Individual surface (Scholar, Professional, Personal AI, Passport sharing) asks the same question
// the same way and shows the same words: a concise reason and, where the person can do something about it, the
// next step. It READS what the engine already decided (src/lib/ai/allowance.ts getAiStanding, meteredRefusalBody)
// and the Scholar consent state (scholar/consent-gate.ts). It decides nothing: a disabled button here is a
// courtesy, and the server refusal stays the control. No AI governance lives here.

import { experienceHref, type ExperienceKey } from "./experiences";
import type { AiStanding } from "@/lib/ai/allowance";
import type { ConsentStatus } from "./scholar/consent-gate";
import { SUPPORTIVE_REFUSAL } from "@/lib/ai/operating-mode";
import { SCHOLAR_EDU_AI } from "./scholar/config";

export type AiUnavailableReason =
  | "policy_unpublished"      // HQ has not published the product's AI policy: nothing is switched on yet
  | "consent_off"             // the person has not turned AI help on (Scholar)
  | "consent_outdated"        // the AI terms changed and need agreeing again (Scholar)
  | "consent_awaiting_legal"  // the AI terms are not published yet (Scholar)
  | "allowance_exhausted"     // this period's allowance is used
  | "level_insufficient"      // what is left does not cover this activity
  | "activity_unsupported"    // the published policy does not offer this activity
  | "not_eligible"            // clinical-risk activity with no approved model
  | "unreadable"              // could not be checked just now
  | "not_entitled";           // needs a subscription (paid contexts only)

export type AiAvailability = { available: true } | { available: false; reason: AiUnavailableReason };
export type AiReasonCopy = { text: string; next: { label: string; href: string } | null };

/** Pure: availability of one activity from the engine's standing (and, for Scholar, the consent state). */
export function availabilityFromStanding(standing: AiStanding | null, activity: string, consent?: ConsentStatus): AiAvailability {
  if (consent && consent !== "on") return { available: false, reason: consent === "awaiting_legal" ? "consent_awaiting_legal" : consent === "outdated" ? "consent_outdated" : "consent_off" };
  if (!standing) return { available: false, reason: "unreadable" };
  const a = standing.activities?.[activity];
  if (standing.readable && a?.available) return { available: true };
  if (standing.policyPublished === false) return { available: false, reason: "policy_unpublished" };
  if (!standing.readable) return { available: false, reason: "unreadable" };
  if (!a) return { available: false, reason: "activity_unsupported" };
  if (a.reason === "level_insufficient") return { available: false, reason: "level_insufficient" };
  // The server words this as NOT_ELIGIBLE_REASON, or as SUPPORTIVE_REFUSAL in a mode that answers the educational part.
  if (/approved for clinical content/i.test(a.reason ?? "") || a.reason === SUPPORTIVE_REFUSAL) return { available: false, reason: "not_eligible" };
  if (/subscription/i.test(standing.message ?? "")) return { available: false, reason: "not_entitled" };
  return { available: false, reason: "allowance_exhausted" };
}

const CODE_TO_REASON: Record<string, AiUnavailableReason> = {
  policy_unpublished: "policy_unpublished", unknown_activity: "activity_unsupported", allowance_exhausted: "allowance_exhausted",
  level_insufficient: "level_insufficient", not_eligible: "not_eligible", unreadable: "unreadable", not_entitled: "not_entitled",
  pending_reconciliation: "unreadable",
};

/** Pure: the reason behind a failed AI response body (meteredRefusalBody's `code`), or null if it is not an AI refusal. */
export function reasonFromRefusal(body: any): AiUnavailableReason | null {
  const code = typeof body?.code === "string" ? body.code : null;
  if (code && CODE_TO_REASON[code]) return CODE_TO_REASON[code];
  if (body?.standing?.policyPublished === false) return "policy_unpublished";
  if (body?.continuity === true) return "allowance_exhausted";
  return null;
}

/** Pure: the words and the next step for a reason, in the person's terms (never "environment" or internal codes). */
export function aiReasonCopy(reason: AiUnavailableReason, experience: ExperienceKey): AiReasonCopy {
  const product = experience === "scholar" ? "Competen Scholar" : "Competen Professional";
  const settings = { label: "Review AI help in Settings", href: experienceHref(experience, "settings") };
  const allowance = { label: "See your AI allowance", href: experienceHref(experience, "ai-allowance") };
  switch (reason) {
    case "policy_unpublished": return { text: "AI help is not switched on for Competen Individual yet. Everything else here works without it.", next: null };
    case "consent_off": return { text: "AI help is off for your account. You can turn it on whenever you choose.", next: settings };
    case "consent_outdated": return { text: "The AI terms have changed. Review them to turn AI help back on.", next: settings };
    case "consent_awaiting_legal": return { text: "AI help opens once its terms are published. Everything else here works without it.", next: null };
    case "allowance_exhausted": return { text: "You have used this period's AI allowance. Everything you have saved stays available.", next: allowance };
    case "level_insufficient": return { text: "This needs more AI help than your allowance has left this period. A weaker model is never used instead.", next: allowance };
    case "activity_unsupported": return { text: `This kind of AI help is not offered in ${product} yet.`, next: null };
    // SCHOLAR-EDU-AI-01 s6: plain words, never the governance reason (allowance.ts NOT_ELIGIBLE_REASON).
    case "not_eligible": return { text: experience === "scholar" ? SCHOLAR_EDU_AI.unavailable.general : PROFESSIONAL_NOT_YET, next: null };
    case "unreadable": return { text: "AI help could not be checked just now, so nothing was sent. Try again shortly.", next: null };
    case "not_entitled": return { text: `This needs an active ${product} subscription.`, next: null };
  }
}

const PROFESSIONAL_NOT_YET = "AI help isn't available for this yet. Nothing you have written or saved is lost — you can carry on by hand and try AI help again later.";

// ── SCHOLAR-EDU-AI-01 s6: THE GOVERNANCE REASON STAYS WITH HQ ────────────────────────────────────────────────────
// The engine words a clinical-eligibility refusal for governance ("...needs an AI model approved for clinical
// content..."): allowance.ts NOT_ELIGIBLE_REASON on the standing, NOT_ELIGIBLE on an owned-budget refusal. Precise for
// HQ, meaningless to a student, so Individual surfaces and responses swap it for the plain words above. The standing's
// per-activity reason is left as the engine wrote it (availabilityFromStanding reads it as a code).
const GOVERNANCE_NOT_ELIGIBLE = /approved for clinical content/i;

/** Pure: whether a message is the engine's governance wording for "no eligible model". */
export const isGovernanceNotEligible = (text: string | null | undefined): boolean => GOVERNANCE_NOT_ELIGIBLE.test(text ?? "");

/** Pure: a message as a student may see it -- the governance wording swapped for the plain words; anything else as is. */
export function studentAiText(text: string, experience: ExperienceKey = "scholar"): string {
  return isGovernanceNotEligible(text) ? aiReasonCopy("not_eligible", experience).text : text;
}

/**
 * Pure: the words for a failed AI response, or null if it is not an AI refusal. An operating mode's supportive answer
 * (SUPPORTIVE_REFUSAL, about a real patient's care) is kept as that mode words it; every other refusal gets the shared copy.
 */
export function refusalCopy(body: any, experience: ExperienceKey): AiReasonCopy | null {
  const reason = reasonFromRefusal(body);
  if (!reason) return null;
  if (reason === "not_eligible" && body?.error === SUPPORTIVE_REFUSAL) return { text: SUPPORTIVE_REFUSAL, next: null };
  return aiReasonCopy(reason, experience);
}

/**
 * Pure: what an examination-paper AI action (a suggested answer / "Check my attempt", activity `deeper`) says when it
 * is not available -- before a click (`reason`, from the standing) or after one (`body`, the refusal). No eligible model
 * gets the paper's own words, pointing at what still works without AI; anything else the shared copy. Null: not an AI refusal.
 */
export function paperAiCopy(source: { reason: AiUnavailableReason } | { body: any }, saved: boolean): AiReasonCopy | null {
  const c = "reason" in source ? aiReasonCopy(source.reason, "scholar") : refusalCopy(source.body, "scholar");
  const reason = "reason" in source ? source.reason : reasonFromRefusal(source.body);
  if (c && reason === "not_eligible" && c.text !== SUPPORTIVE_REFUSAL) return { text: SCHOLAR_EDU_AI.unavailable.paper(saved), next: null };
  return c;
}

/** The question an AI operating mode puts to the learner instead of a refusal (allowance.ts meteredRefusalBody, HTTP 409). */
export type ClarifyPrompt = { question: string; education: string; patient: string; patientAnswer: string };

/** Pure: the clarify prompt in a failed AI response body (`code: "clarify_purpose"`), or null for anything else. All four texts must be present. */
export function clarifyFrom(body: any): ClarifyPrompt | null {
  if (body?.code !== "clarify_purpose") return null;
  const c = body.clarify;
  const t = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
  const question = t(c?.question), education = t(c?.education), patient = t(c?.patient), patientAnswer = t(c?.patientAnswer);
  return question && education && patient && patientAnswer ? { question, education, patient, patientAnswer } : null;
}
