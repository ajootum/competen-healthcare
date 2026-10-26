import { NextResponse } from "next/server";
import { hqApiGate, isHqRefusal } from "@/lib/hq/api-gate";
import { currentTraceId } from "@/lib/trace";
import { publishScope, setOverride } from "@/lib/config/workspace-config-write";
import { HOLDINGS_FINANCE_SCOPE, unitEconomicsPath, validateUnitEconomicsSettings } from "@/lib/holdings/unit-economics-policy";
import { recordFxEvent, validateFxEvent } from "@/lib/holdings/fx-ledger";

// Request-time only: it reads the session and writes governed records.
export const dynamic = "force-dynamic";

// /api/hq/holdings/economics -- HOLDINGS-FX-01. POST { action, ... }:
//   save_policy   { settings }       save the Scholar FX and margin policy as a DRAFT (CONFIG-002)
//   publish       { note? }          publish the holdings_finance scope as a new version
//   record_event  { event }          append one entry to the FX reserve ledger (migration 560)
//
// ⚠ hq.individual.commercial.manage, the owner-only financial right (migration 400 grants it to no position).
// ⚠ NOTHING HERE MOVES MONEY, CHANGES A PRICE OR LIMITS A USER. The policy sets targets and the ledger
// records what the bank statement already shows.

const CAP = "hq.individual.commercial.manage";
const bad = (status: number, code: string, message: string, fields?: Record<string, string>) =>
  NextResponse.json({ error: { code, message, ...(fields ? { fields } : {}) } }, { status });

export async function POST(req: Request) {
  const ctx = await hqApiGate([CAP]);
  if (isHqRefusal(ctx)) return ctx;
  const body = await req.json().catch(() => ({}));
  const actor = { userId: ctx.userId, name: ctx.fullName ?? null };
  const audit = (action: string, value: unknown) => ctx.admin.from("audit_log").insert({
    trace_id: null, actor_id: ctx.userId, actor_name: ctx.fullName ?? null, action, entity_type: "holdings_finance",
    entity_id: null, entity_name: "scholar", old_value: null, new_value: value,
  }).then((r: unknown) => r, () => {});

  switch (body?.action) {
    case "save_policy": {
      const v = validateUnitEconomicsSettings(body.settings);
      if (!v.ok) return bad(422, "INVALID", "Some fields need attention.", v.errors);
      const out = await setOverride(ctx.admin, actor, HOLDINGS_FINANCE_SCOPE, unitEconomicsPath("scholar"), v.settings);
      if (!out.ok) return bad(503, "UNAVAILABLE", "The draft could not be saved.");
      return NextResponse.json({ ok: true, draft: v.settings });
    }
    case "publish": {
      const note = String(body?.note ?? "").trim().slice(0, 500) || null;
      const out = await publishScope(ctx.admin, actor, HOLDINGS_FINANCE_SCOPE, { label: null, note });
      if (!out.ok) return bad(503, "UNAVAILABLE", "The policy could not be published.");
      return NextResponse.json({ ok: true, versionId: out.version_id ?? null });
    }
    case "record_event": {
      const v = validateFxEvent(body.event, new Date());
      if (!v.ok) return bad(422, "INVALID", "Some fields need attention.", v.errors);
      const out = await recordFxEvent(ctx.admin, v.row, ctx.userId);
      if (!out.ok) return bad(out.status, "REFUSED", out.message);
      const trace = await currentTraceId();
      await audit("holdings_fx_event_recorded", { id: out.id, trace, ...v.row });
      return NextResponse.json({ ok: true, id: out.id });
    }
    default:
      return bad(400, "UNKNOWN_ACTION", "Unknown action.");
  }
}
