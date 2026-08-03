// CPR-310's vocabularies, in a module with NO server imports so the team console derives its options
// from the same source the engine enforces.
//
// NOT practice_owner. There is exactly one owner per workspace (ux_practice_owner_single, migration
// 191), and migration 201 refuses to let the last one be removed. Handing ownership over is a transfer
// with its own consequences, not an invitation somebody can accept while the current owner is unaware.

export const INVITABLE_ROLES = [
  ["practitioner", "Practitioner",
    "Clinical access: consultations, documents, procedures, follow-ups."],
  ["practice_assistant", "Practice assistant",
    "The desk: diary, registration, tasks, the inbox. No clinical record access."],
  ["billing_reporting", "Billing and reporting",
    "Reports only."],
  ["read_only_auditor", "Read-only auditor",
    "Looks, changes nothing."],
] as const;

export const MEMBERSHIP_STATUSES = ["active", "suspended", "revoked"] as const;

/** Days an invitation code may live for. Bounded at both ends by the engine. */
export const INVITE_EXPIRY_BOUNDS = { min: 1, max: 30, default: 7 } as const;
