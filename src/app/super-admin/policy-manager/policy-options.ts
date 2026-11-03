// Governed policies: the type and scope vocabularies for the Policy Manager pages and routes (the database checks the same lists, 942).
export const POLICY_TYPES = ["clinical", "hr", "safety", "governance", "infection_control", "quality"] as const;
export const POLICY_SCOPES = ["holdings", "scholar", "practice", "enterprise", "individual"] as const;

export const POLICY_TYPE_LABEL: Record<string, string> = {
  clinical: "Clinical", hr: "HR", safety: "Safety", governance: "Governance", infection_control: "Infection control", quality: "Quality",
};
export const POLICY_SCOPE_LABEL: Record<string, string> = {
  holdings: "Holdings", scholar: "Scholar", practice: "Practice", enterprise: "Enterprise", individual: "Individual",
};
