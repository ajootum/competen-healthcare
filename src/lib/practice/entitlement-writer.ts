/* eslint-disable @typescript-eslint/no-explicit-any */
import { validateAccessPeriod } from "./entitlement-period";

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// CPR-PD-PROV-001 §9/§15 -- THE ONE WAY AN ACCESS PERIOD IS OPENED.
//
// ⚠ WHY THIS EXISTS. Three places create access for a practice: provisioning (its first period), the
// Product Director's access card (extend, reactivate), and a settled payment. Until now they wrote three
// different ways, and one of them was wrong in a way the others were not -- the payment path issued an
// UPDATE with no row filter beyond the workspace and a status list, so it rewrote plan_code, status and
// ends_at on EVERY period the practice had ever held.
//
// That was survivable while a practice only ever had one row. It stopped being survivable the day
// periods began to APPEND (§9: "Do not rewrite historical entitlement periods"), because a practice with
// a trial, an extension and a lapse would have had all three resurrected as `active`, all carrying the
// same new end date, each still claiming the start date it originally had. The ledger would have read
// as three overlapping live periods that never happened.
//
// ⚠ AND IT WAS NOT REACHABLE, WHICH IS WHY NOTHING CAUGHT IT. No plan in `practice_plans` is both active
// and priced, so no checkout can be raised and this branch has never run against real data. A latent
// defect in a payment path is still a defect: it runs for the first time on the day money arrives.
//
// One implementation, therefore, and every commercial source expresses itself through it.
// ════════════════════════════════════════════════════════════════════════════════════════════════════

export type EntitlementRow = {
  id: string; workspace_id: string; product_code: string; plan_code: string;
  status: string; starts_at: string; ends_at: string | null;
};

export type OpenPeriodResult =
  | { ok: true; before: EntitlementRow | null; after: EntitlementRow }
  | { ok: false; status: number; code: string; message: string };

const PERIOD_COLUMNS = "id, workspace_id, product_code, plan_code, status, starts_at, ends_at";
const GRANTING = ["active", "trial"];

/** Would this row be letting somebody in right now? The same three conditions resolveWorkspaceContext applies. */
function grantsNow(r: EntitlementRow, nowIso: string): boolean {
  return GRANTING.includes(r.status) && r.starts_at <= nowIso && (r.ends_at === null || r.ends_at >= nowIso);
}

/**
 * Append a new access period, closing whatever was still granting access.
 *
 * ⚠ CLOSING IS A STATUS TRANSITION. The old row keeps its own start and its own end; only its status
 * moves to `expired`. That is the difference between recording that a period ended and pretending it was
 * always going to end now -- §9 forbids the second, and the second is what an UPDATE of `ends_at` does.
 *
 * ⚠ THE CLOSE HAPPENS BEFORE THE INSERT, AND A FAILED CLOSE ABORTS. Two live periods would give the gate
 * two answers, and this project's migration runner cannot carry a transaction (see provisioning.ts's
 * header), so ordering is the only tool available: better no new period than two.
 */
export async function openAccessPeriod(admin: any, args: {
  workspaceId: string;
  planCode: string;
  status: "active" | "trial";
  startsAt: string;
  endsAt: string | null;
  productCode?: string;
}): Promise<OpenPeriodResult> {
  const refusal = validateAccessPeriod({ status: args.status, startsAt: args.startsAt, endsAt: args.endsAt });
  if (refusal) return { ok: false, status: refusal.status, code: refusal.code, message: refusal.message };

  const { data: rows, error: readErr } = await admin.from("practice_entitlement")
    .select(PERIOD_COLUMNS).eq("workspace_id", args.workspaceId).order("starts_at", { ascending: false });
  if (readErr)
    return { ok: false, status: 503, code: "UNREADABLE", message: `this practice's access could not be read: ${readErr.message}` };

  const nowIso = new Date().toISOString();
  const existing = (rows ?? []) as EntitlementRow[];
  const before = existing.find(r => grantsNow(r, nowIso)) ?? existing[0] ?? null;

  for (const live of existing.filter(r => grantsNow(r, nowIso))) {
    const { error } = await admin.from("practice_entitlement")
      .update({ status: "expired", updated_at: nowIso })
      // ⚠ BY ID. The filter this replaced was `.eq(workspace_id).in(status, [...])`, which is the whole
      // bug: it addressed a SET of rows when it meant one.
      .eq("id", live.id);
    if (error)
      return { ok: false, status: 400, code: "NOT_CLOSED", message: `the previous period could not be closed, so no new one was created: ${error.message}` };
  }

  const { data: created, error: insErr } = await admin.from("practice_entitlement").insert({
    workspace_id: args.workspaceId,
    product_code: args.productCode ?? "practice",
    plan_code: args.planCode,
    status: args.status,
    starts_at: args.startsAt,
    ends_at: args.endsAt,
  }).select(PERIOD_COLUMNS).maybeSingle();

  if (insErr || !created)
    return { ok: false, status: 400, code: "NOT_CREATED", message: `the new period could not be created: ${insErr?.message ?? "no row returned"}` };

  return { ok: true, before, after: created as EntitlementRow };
}
