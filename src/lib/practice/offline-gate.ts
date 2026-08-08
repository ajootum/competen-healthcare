import { gateFor, type FlagDecision } from "@/lib/platform/feature-flags";
import type { WorkspaceContext } from "@/lib/practice/access";

// CP-OFFLINE-SURVEY-001 s3.7 / s3.8.6 — WHO IS ALLOWED TO HOLD A CLINIC DAY ON A DEVICE.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// TWO SWITCHES, AND THEY ANSWER DIFFERENT QUESTIONS.
//
//   practice_offline_cache          plat_feature_flags. The PLATFORM's rollout switch: tenant-scoped so a
//                                   single pilot practice can be enabled. Default off. Fail-closed.
//   practice_configuration.
//     feature_flags.offline_cache   THE PRACTICE'S OWN. s3.8.6: being able to say "do not hold my
//                                   patients' data on that laptop" is itself a security control, and it
//                                   is worthless if it requires a support ticket.
//
// ⚠ THREE STATES, NOT TWO, AND ONLY ONE OF THEM PURGES.
//
//   allowed      both switches say yes -- the device may write and read a cached day
//   withheld     somebody switched it OFF. ⚠ The cache is PURGED, not merely left to expire: a switch
//                that stops writing while yesterday's day sits on the device has not honoured the request
//   unresolved   we could not work out whether it is on. Withheld -- nothing new is written -- but NOT
//                purged, because an unreadable table is not a decision anybody made, and deleting on a
//                transient read failure would silently punish a practice for a database blip
//
// ⚠ And the honest caveat, which belongs beside every one of these: purging needs the device to come
// online. On a device that never reconnects, the SELF-EXECUTING EXPIRY in offline-projection.ts is the
// only control that acts at all. Revocation does not reach back (s3.8.2); nor does this.

/* eslint-disable @typescript-eslint/no-explicit-any */

/** The platform rollout flag's key. ⚠ Not seeded by any migration yet -- see the route's header. */
export const OFFLINE_FLAG = "practice_offline_cache";

/** The per-workspace key inside practice_configuration.feature_flags. */
export const OFFLINE_PRACTICE_SWITCH = "offline_cache";

export type OfflineGate = {
  state: "allowed" | "withheld" | "unresolved";
  /** True only for "allowed". */
  allowed: boolean;
  /** ⚠ True only for "withheld": somebody decided, so anything already stored must go. */
  purge: boolean;
  /** A sentence that is true today, safe to show a practitioner. Never empty. */
  reason: string;
  /** Which switch decided, so "off" and "could not tell" never render alike. */
  decidedBy: "platform_flag" | "practice_switch" | "allowed";
  platform: FlagDecision;
};

/**
 * Resolve both switches, platform first.
 *
 * The platform flag is asked first because it is the rollout gate: a practice that has not been enabled
 * has nothing to opt out of, and asking its configuration would be a query with no consequence.
 */
export async function offlineCacheGate(
  admin: any, ctx: WorkspaceContext, userId: string,
): Promise<OfflineGate> {
  const platform = await gateFor(admin, OFFLINE_FLAG, userId);

  if (platform.state === "unresolved")
    return {
      state: "unresolved", allowed: false, purge: false, decidedBy: "platform_flag", platform,
      reason: `Offline access is not switched on, because the platform could not work out whether it should be. It is withheld rather than guessed. (${platform.reason})`,
    };

  if (platform.state === "off")
    return {
      state: "withheld", allowed: false, purge: true, decidedBy: "platform_flag", platform,
      reason: "Offline access is switched off for this practice by the platform, so nothing is kept on this device.",
    };

  const { data, error } = await admin.from("practice_configuration")
    .select("feature_flags").eq("workspace_id", ctx.workspaceId).eq("is_effective", true).maybeSingle();

  if (error)
    return {
      state: "unresolved", allowed: false, purge: false, decidedBy: "practice_switch", platform,
      reason: `Offline access is not switched on, because this practice's own setting could not be read: ${error.message}`,
    };

  const flags = (data?.feature_flags ?? {}) as Record<string, unknown>;
  // ⚠ ABSENT IS NOT OFF. A practice that has never touched the switch has not refused; the platform flag
  // already decided for it. Only an explicit `false` is a refusal, and only a refusal purges.
  if (flags[OFFLINE_PRACTICE_SWITCH] === false)
    return {
      state: "withheld", allowed: false, purge: true, decidedBy: "practice_switch", platform,
      reason: "This practice has turned offline access off, so nothing is kept on this device and anything already stored has been removed from it.",
    };

  return {
    state: "allowed", allowed: true, purge: false, decidedBy: "allowed", platform,
    reason: "Offline access is on for this practice.",
  };
}
