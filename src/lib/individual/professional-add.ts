/* eslint-disable @typescript-eslint/no-explicit-any */

// ── ADD COMPETEN PROFESSIONAL FROM SCHOLAR ── PRODUCT-EXPERIENCE P5, owner Option A (26 Oct 2026) ──────────
//
// PREPARED, OFF. For the pilot, Professional is granted by HQ. This is the guided "Add Competen Professional"
// a Scholar member will use later: the same account, the same Scholar record and Passport, one new entitlement.
// It reuses the JOIN-01 J1 shape (a person adds an experience to the account they already have) and the
// existing membership and entitlement tables -- no migration, no new store.
//
// ⚠ SERVER-ENFORCED GATE, DEFAULT OFF. practice_platform_flags.flag = 'individual_professional_self_add', read
// like every Individual flag: no row, a failed read or a false value is OFF, and it never throws. Nothing writes
// that row: turning it on is a separate owner decision after legal approval. While it is off the route answers
// 404 before reading anything else, and Settings shows nothing.

import { individualAppEnabled } from "./gate";

export const PROFESSIONAL_SELF_ADD_FLAG = "individual_professional_self_add";

/** True only when the Individual release gate AND the self-add flag are on. Never throws. */
export async function professionalSelfAddEnabled(admin: any | null): Promise<boolean> {
  if (!admin || !(await individualAppEnabled(admin))) return false;
  try {
    const { data, error } = await admin.from("practice_platform_flags").select("enabled").eq("flag", PROFESSIONAL_SELF_ADD_FLAG).maybeSingle();
    return !error && data?.enabled === true;
  } catch { return false; }
}

// The write itself lives in grants.ts (the one file allowed to write gate-3 records, harness 2a), reached through
// join.ts like every self-service addition (JOIN-01 J1, harness 5c).
export { addProfessionalFromScholar, type AddOutcome } from "./join";
