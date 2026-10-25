/* eslint-disable @typescript-eslint/no-explicit-any */
import { aiFairUseEnabled } from "@/lib/ai/allowance";

// ── WHICH LIMIT GOVERNS PROFESSIONAL AI ── owner and coordinator decision, 25 October 2026 ──────────────────────
//
// "When ai_fair_use is ON, the metered allowance REPLACES the legacy hourly quota. With metering OFF, the legacy quota
// stays." Before this, both ran: the estate hourly quota (checkAiQuota / individualAiQuota) and then the metered
// allowance (runMeteredAi), so a Professional user met two limits at once and the stricter one won unseen.
//
// ⚠ ONE LIMIT AT A TIME, NEVER NONE. Metering ON: the allowance governs (atomic reservation, Continuity, eligibility).
// Metering OFF: runMeteredAi is generate() unchanged, so the legacy quota is the only limit and must stay. An unreadable
// flag reads as OFF (aiFairUseEnabled), so the legacy quota applies: it fails toward a limit, never toward none.
// Scholar keeps its own arrangement: this is Professional's decision only.

/** True when the legacy hourly quota must run for a Professional AI request (metering is off or unreadable). */
export async function professionalLegacyQuotaApplies(admin: any): Promise<boolean> {
  return !(await aiFairUseEnabled(admin));
}
