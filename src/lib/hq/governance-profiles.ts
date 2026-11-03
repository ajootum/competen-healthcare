// Competen HQ -- the two standard capability profiles of UNIFIED-GOVERNANCE-V1 (owner spec section 6).
//
// A profile is a LIST OF CODES the Capabilities tab offers to grant to a position. It is not a new governance
// engine: every grant still goes through hq_position_admin_grant, which checks ownership, audits first and
// refuses separation-of-duties pairs. Clinical approval is a specialist authority, offered as a separate
// explicit addition and never part of the standard profile.
//
// Pure module.

export const STANDARD_CONTENT_GOVERNANCE: readonly string[] = [
  "hq.platform.home.view",
  "hq.quality.governance.view",
  "hq.quality.policy.view", "hq.quality.policy.author", "hq.quality.policy.review", "hq.quality.policy.publish",
  "hq.assessment.catalogue.view",
  "hq.assessment.catalogue.manage",
  "hq.assessment.studio.view",
  "hq.assessment.instrument.author",
  "hq.assessment.instrument.review",
  "hq.assessment.instrument.publish",
  "hq.quality.competency.author",
  "hq.quality.competency.publish",
];

/** A specialist clinical authority: granted on its own, with an explicit acknowledgement. */
export const CLINICAL_APPROVAL: readonly string[] = ["hq.quality.clinical.approve"];

export type GovernanceProfileKey = "executive" | "management";
export type GovernanceProfile = { label: string; capabilities: readonly string[]; note: string };

export const PROFILES: Record<GovernanceProfileKey, GovernanceProfile> = {
  executive: {
    label: "Executive profile",
    capabilities: STANDARD_CONTENT_GOVERNANCE,
    note: "Full standard content-governance profile. Clinical approval is a separate specialist authority.",
  },
  management: {
    label: "Management profile",
    capabilities: STANDARD_CONTENT_GOVERNANCE,
    note: "Same standard profile; each appointment names the capabilities it carries (delegated scope).",
  },
};

/** The profile's capabilities the position does not yet hold live, in the profile's order. Pure. */
export function profileGaps(profile: Pick<GovernanceProfile, "capabilities">, liveGrantCodes: readonly string[]): string[] {
  const held = new Set(liveGrantCodes);
  return profile.capabilities.filter(c => !held.has(c));
}
