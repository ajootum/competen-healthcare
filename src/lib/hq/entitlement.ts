import { audit } from "@/lib/practice/audit";
import { validateAccessPeriod } from "@/lib/practice/entitlement-period";
import { openAccessPeriod } from "@/lib/practice/entitlement-writer";
import { commercialAuthority, judgeOverride } from "@/lib/practice/commercial-precedence";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// CPR-PD-PROV-001 -- TIME-LIMITED ENTITLEMENT: how long a practice may be used.
//
// §1's frozen rule: "Provisioning creates the Practice; entitlement determines whether the Practice may
// be used." This module is the second half, and nothing here creates or deletes a practice.
//
// ⚠ WHY IT EXISTS. The owner's own practice hit the end of its 30-day trial and was locked out. The
// screen a member lands on says "reactivating the plan restores access", and until migration 367
// NOTHING could reactivate one: provisioning was the only code that had ever written
// practice_entitlement, and the landlord plane refused even to read the table.
//
// ---- ⚠ PERIODS ARE APPENDED, NEVER REWRITTEN, AND THE FIRST VERSION OF THIS FILE GOT IT WRONG ------
//
// It updated the single row in place, which was tidy and destroyed the record: the trial's own dates
// were overwritten by the extension that replaced them. §9 forbids exactly that ("Do not rewrite
// historical entitlement periods; preserve lifecycle history"), §15 says a reactivation "must not erase
// the previous expiry/history", and AC-09 tests it.
//
// The concern that produced the wrong design is real and is handled differently: the access gate takes
// ANY active-or-trial row whose window covers now, so two live rows would mean a cancelled practice kept
// inside by a stale one. Appending is safe because a period that has ENDED no longer matches -- and for
// the one case that would overlap, an open-ended or future-dated row still granting access, granting a
// new period CLOSES the old one by a status transition first. A status change is a lifecycle event; it
// leaves starts_at and ends_at exactly as they were, which is what "do not rewrite the period" means.
//
// ---- ⚠ AND IT NEVER CHOOSES A DURATION --------------------------------------------------------------
//
// The owner's decision, and §2's: the PRODUCT DIRECTOR determines the access period. There is no
// default here and no "extend by the usual amount", because a default is this file quietly making that
// decision every time somebody accepts what was already in the box.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/** Migration 191's closed list. A status outside it is refused before the database sees it. */
export const ENTITLEMENT_STATUSES = ["active", "trial", "expired", "suspended", "cancelled"] as const;
export type EntitlementStatus = (typeof ENTITLEMENT_STATUSES)[number];

/** The statuses the access gate accepts, quoted from resolveWorkspaceContext rather than re-derived. */
export const STATUSES_GRANTING_ACCESS: readonly string[] = ["active", "trial"];

/**
 * §7's status vocabulary. DERIVED, never stored -- §12: "Practice status must not be inferred from a
 * front-end date alone", and the inverse is equally true: a stored label drifts from the dates that
 * actually decide access. This is computed from the same three conditions the gate applies.
 */
export type AccessState = "scheduled" | "active" | "expiring_soon" | "expired" | "paused" | "none";

export const ACCESS_STATE_LABEL: Record<AccessState, string> = {
  scheduled: "Scheduled",
  active: "Active",
  expiring_soon: "Expiring soon",
  expired: "Expired",
  paused: "Paused",
  none: "No access",
};

/**
 * §8: "Thresholds should be configurable rather than embedded in UI logic." Read from pd_ops_config
 * where it carries one, with this as the fallback -- and the fallback is named rather than inlined so a
 * reader can see which number applied.
 */
export const EXPIRING_SOON_DAYS_DEFAULT = 30;

export type EntitlementPeriod = {
  id: string;
  productCode: string;
  planCode: string;
  status: string;
  startsAt: string;
  endsAt: string | null;
  /** ⚠ COMPUTED THE WAY THE GATE COMPUTES IT, so this screen cannot say "active" about a practice the product turns away. */
  grantsAccessNow: boolean;
  /** Why not, in words a Director can act on. Null when it does grant access. */
  whyNot: string | null;
  /** §7's derived display value. Null for an open-ended period and for one already over. */
  daysRemaining: number | null;
  state: AccessState;
};

export type EntitlementReading =
  | { state: "ok"; periods: EntitlementPeriod[]; current: EntitlementPeriod | null; hasAccess: boolean; expiringSoonDays: number }
  | { state: "none"; periods: []; current: null; hasAccess: false; expiringSoonDays: number }
  | { state: "unreadable"; reason: string };

const nowIso = () => new Date().toISOString();
const DAY = 86_400_000;

/**
 * ⚠ EXPORTED SO THE ESTATE REGISTER DERIVES STATE THE SAME WAY THIS CARD DOES (§8). A list that
 * classified "Expiring soon" with its own arithmetic, beside a detail page that classified it with this
 * one, is two answers to one question -- and the one a Director acts on would be whichever they opened
 * second. There is one implementation, and both surfaces call it.
 */
export function periodOf(row: any, expiringSoonDays: number): EntitlementPeriod {
  const status = String(row.status);
  const startsAt = String(row.starts_at);
  const endsAt = row.ends_at ? String(row.ends_at) : null;
  const now = nowIso();

  // ⚠ THE SAME THREE CONDITIONS THE GATE APPLIES, and each failure gets its own sentence -- "expired"
  // and "has not started yet" send a Director to different actions.
  const statusOk = STATUSES_GRANTING_ACCESS.includes(status);
  const started = startsAt <= now;
  const notEnded = endsAt === null || endsAt >= now;
  const grantsAccessNow = statusOk && started && notEnded;

  const whyNot = grantsAccessNow ? null
    : !statusOk ? `the plan is ${status}, and only an active or trial plan grants access`
      : !started ? "the plan has not started yet"
        : "the plan window has ended";

  const msLeft = endsAt ? Date.parse(endsAt) - Date.now() : null;
  const daysRemaining = msLeft === null || msLeft < 0 ? null : Math.ceil(msLeft / DAY);

  const state: AccessState =
    status === "suspended" ? "paused"
      : !statusOk ? "expired"
        : !started ? "scheduled"
          : !notEnded ? "expired"
            : daysRemaining !== null && daysRemaining <= expiringSoonDays ? "expiring_soon"
              : "active";

  return {
    id: String(row.id), productCode: String(row.product_code), planCode: String(row.plan_code),
    status, startsAt, endsAt, grantsAccessNow, whyNot, daysRemaining, state,
  };
}

/** §8's configurable threshold, with the fallback named. A failed read uses the fallback rather than refusing a whole screen over a number. */
export async function expiringSoonDays(admin: any): Promise<number> {
  return configuredDays(admin, "entitlement_expiring_soon_hours", EXPIRING_SOON_DAYS_DEFAULT);
}

/**
 * §8's NEAR threshold -- the "expires in 7 days" group, beside the 30-day one above.
 *
 * ⚠ BOTH NUMBERS COME FROM CONFIGURATION AND NEITHER IS WRITTEN INTO A COMPONENT. §8: "Thresholds should
 * be configurable rather than embedded in UI logic." The filter buttons are labelled FROM these values,
 * so changing the row changes the button -- rather than leaving a control that says 7 and filters by
 * something else, which is the failure mode of a threshold that lives in two places.
 */
export const EXPIRING_NEAR_DAYS_DEFAULT = 7;

export async function expiringNearDays(admin: any): Promise<number> {
  return configuredDays(admin, "entitlement_expiring_near_hours", EXPIRING_NEAR_DAYS_DEFAULT);
}

async function configuredDays(admin: any, key: string, fallback: number): Promise<number> {
  try {
    const { data } = await admin.from("pd_ops_config")
      .select("value_hours").eq("config_key", key).maybeSingle();
    const hours = Number(data?.value_hours);
    return Number.isFinite(hours) && hours > 0 ? Math.round(hours / 24) : fallback;
  } catch { return fallback; }
}

/**
 * Every access period a practice has had, newest first, and which one (if any) is letting them in.
 *
 * ⚠ A FAILED READ IS `unreadable`, NEVER "no plan". Telling a Director a practice has no entitlement
 * because a query failed invites them to write a second one beside the row that already exists.
 */
export async function practiceEntitlements(admin: any, workspaceId: string): Promise<EntitlementReading> {
  const soon = await expiringSoonDays(admin);
  const { data, error } = await admin.from("practice_entitlement")
    .select("id, workspace_id, product_code, plan_code, status, starts_at, ends_at")
    .eq("workspace_id", workspaceId)
    .order("starts_at", { ascending: false });

  if (error) return { state: "unreadable", reason: `this practice's access could not be read: ${error.message}` };
  const rows = (data ?? []) as any[];
  if (rows.length === 0)
    return { state: "none", periods: [], current: null, hasAccess: false, expiringSoonDays: soon };

  const periods = rows.map(r => periodOf(r, soon));
  // The CURRENT period is the one granting access; failing that, the most recent. A Director looking at
  // a locked-out practice needs to see the period that ended, not an empty card.
  const current = periods.find(p => p.grantsAccessNow) ?? periods[0] ?? null;
  return { state: "ok", periods, current, hasAccess: periods.some(p => p.grantsAccessNow), expiringSoonDays: soon };
}

export type AccessChange =
  | { ok: true; action: "granted" | "ended"; periodId: string; before: EntitlementPeriod | null; after: EntitlementPeriod; grantsAccessNow: boolean }
  | { ok: false; status: number; code: string; message: string };

/**
 * Grant a new access period (§9's extension and reactivation, and §4's provisioning-time grant).
 *
 * ⚠ IT APPENDS. The previous period keeps its own dates and its own row, so "when did this practice's
 * trial actually end" stays answerable after an extension -- which is the whole of §9 and AC-09.
 */
export async function grantAccessPeriod(admin: any, args: {
  workspaceId: string;
  status: Extract<EntitlementStatus, "active" | "trial">;
  planCode: string;
  /** §5: now, or an explicitly chosen future start. A future start yields Scheduled and no access. */
  startsAt: string;
  /** §5: an instant, or null ONLY where the access basis permits open-ended. */
  endsAt: string | null;
  actorId: string;
  reason: string;
  correlationId: string;
  /**
   * §12: acknowledgement that this act knowingly overrides a live paid subscription. Absent, an act that
   * would reduce paid-for access is REFUSED rather than performed quietly -- "must not be silently
   * overwritten" is a rule about silence, not about the act.
   */
  overrideBilling?: boolean;
}): Promise<AccessChange> {
  // ⚠ THE §5 INTERVAL RULES LIVE IN src/lib/practice/entitlement-period.ts AND ARE NOT REPEATED HERE.
  // The provisioning wizard creates a practice's FIRST period and has to apply exactly these rules; two
  // copies would drift into the wizard being quietly more permissive than this card. §19: "not as a
  // parallel expiry system."
  const refusal = validateAccessPeriod({ status: args.status, startsAt: args.startsAt, endsAt: args.endsAt });
  if (refusal) return { ok: false, status: refusal.status, code: refusal.code, message: refusal.message };

  // ⚠ THE REASON IS *NOT* IN THE SHARED RULES, AND THAT IS DELIBERATE. It is a governance requirement of
  // a MANUAL OVERRIDE on a practice somebody is already using (§9, §14) -- not a property of a period.
  // Provisioning a new practice carries its own authorisation and its own audit event; demanding a
  // written justification for giving a brand-new practice its first trial would be a ritual, not a control.
  const reason = (args.reason ?? "").trim();
  if (reason.length < 8)
    return { ok: false, status: 400, code: "REASON_REQUIRED", message: "a reason is required (at least 8 characters). It is recorded with the before and after." };

  // ── §12 / AC-10: does this contradict a commercial fact somebody else established? ───────────────
  //
  // ⚠ CONSULTED BEFORE THE WRITE, AND ITS REFUSALS ARE REAL ONES. Administrative suspension outranks
  // every commercial act, so writing a period into a SUSPENDED practice would produce a "saved" and a
  // practice still shut. And a period that ends before what somebody paid for is permitted but may not
  // be SILENT -- see judgeOverride for why refusing outright would be the worse design.
  const authority = await commercialAuthority(admin, args.workspaceId);
  const verdict = judgeOverride(authority, {
    kind: "grant", proposedEndsAt: args.endsAt, acknowledged: !!args.overrideBilling,
  });
  if (!verdict.allowed) return { ok: false, status: 409, code: verdict.code, message: verdict.message };

  // ⚠ THE APPEND ITSELF IS SHARED WITH PROVISIONING AND THE PAYMENT PATH (entitlement-writer.ts). Three
  // implementations is how one of them ended up rewriting every historical row.
  const soon = await expiringSoonDays(admin);
  const opened = await openAccessPeriod(admin, {
    workspaceId: args.workspaceId, planCode: args.planCode,
    status: args.status, startsAt: args.startsAt, endsAt: args.endsAt,
  });
  if (!opened.ok) return { ok: false, status: opened.status, code: opened.code, message: opened.message };

  const before = opened.before ? periodOf(opened.before, soon) : null;
  const after = periodOf(opened.after, soon);

  await audit(admin, {
    // §14: the practice's OWN trail. The people who will ask about this are inside that practice.
    workspaceId: args.workspaceId, actorId: args.actorId,
    eventType: "practice.access_granted",
    payload: {
      reason,
      // §14 "Entitlement extended: old end; new end; actor; reason where required."
      previousEnd: before?.endsAt ?? null,
      previousStatus: before?.status ?? null,
      planCode: after.planCode, status: after.status,
      startsAt: after.startsAt, endsAt: after.endsAt,
      grantsAccessNow: after.grantsAccessNow,
    },
    correlationId: args.correlationId,
  });

  return { ok: true, action: "granted", periodId: after.id, before, after, grantsAccessNow: after.grantsAccessNow };
}

/**
 * End or pause access (§7's End access / Pause, §14's "Access ended").
 *
 * ⚠ A STATUS TRANSITION ON THE CURRENT PERIOD, and its dates stay as they are. The period genuinely ran
 * from its start until now; rewriting ends_at to this moment would make the record claim it had always
 * been going to end today.
 */
export async function endAccess(admin: any, args: {
  workspaceId: string;
  status: Extract<EntitlementStatus, "expired" | "suspended" | "cancelled">;
  actorId: string;
  reason: string;
  correlationId: string;
  /** §12: acknowledgement that this knowingly closes a practice with a live paid subscription. */
  overrideBilling?: boolean;
}): Promise<AccessChange> {
  if (!["expired", "suspended", "cancelled"].includes(args.status))
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "ending access needs expired, suspended or cancelled" };

  const reason = (args.reason ?? "").trim();
  if (reason.length < 8)
    return { ok: false, status: 400, code: "REASON_REQUIRED", message: "a reason is required (at least 8 characters). It is recorded with the before and after." };

  // ⚠ §12 / AC-10. Ending access to a practice that has PAID is the sharpest form of the override this
  // rule exists for, so it is asked about here as well as on the grant. An administratively closed
  // practice is refused for a different reason: there is nothing left to end.
  const authority = await commercialAuthority(admin, args.workspaceId);
  const verdict = judgeOverride(authority, { kind: "end", acknowledged: !!args.overrideBilling });
  if (!verdict.allowed) return { ok: false, status: 409, code: verdict.code, message: verdict.message };

  const { data: rows, error: readErr } = await admin.from("practice_entitlement")
    .select("id, workspace_id, product_code, plan_code, status, starts_at, ends_at")
    .eq("workspace_id", args.workspaceId).order("starts_at", { ascending: false });
  if (readErr)
    return { ok: false, status: 503, code: "UNREADABLE", message: `this practice's access could not be read: ${readErr.message}` };

  const soon = await expiringSoonDays(admin);
  const existing = ((rows ?? []) as any[]).map(r => periodOf(r, soon));
  const target = existing.find(p => p.grantsAccessNow) ?? existing[0] ?? null;
  if (!target)
    return { ok: false, status: 404, code: "NO_PERIOD", message: "this practice has no access period to end" };

  const { data: updated, error } = await admin.from("practice_entitlement")
    .update({ status: args.status, updated_at: nowIso() }).eq("id", target.id)
    .select("id, workspace_id, product_code, plan_code, status, starts_at, ends_at").maybeSingle();
  if (error || !updated)
    return { ok: false, status: 400, code: "NOT_SAVED", message: `access was not changed: ${error?.message ?? "the row came back empty"}` };

  const after = periodOf(updated, soon);

  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId,
    eventType: "practice.access_ended",
    payload: {
      reason, priorStatus: target.status, newStatus: after.status,
      periodStartedAt: after.startsAt, periodEndsAt: after.endsAt,
    },
    correlationId: args.correlationId,
  });

  return { ok: true, action: "ended", periodId: after.id, before: target, after, grantsAccessNow: after.grantsAccessNow };
}
