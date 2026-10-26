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
  if (/approved for clinical content/i.test(a.reason ?? "")) return { available: false, reason: "not_eligible" };
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
    case "not_eligible": return { text: "This needs an AI model approved for clinical content, and none is approved for it yet.", next: null };
    case "unreadable": return { text: "AI help could not be checked just now, so nothing was sent. Try again shortly.", next: null };
    case "not_entitled": return { text: `This needs an active ${product} subscription.`, next: null };
  }
}
