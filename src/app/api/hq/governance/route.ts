import { NextResponse } from "next/server";
import { hqApiGate, hqOwnerApiGate, isHqRefusal } from "@/lib/hq/api-gate";
import { currentTraceId } from "@/lib/trace";
import { govRpcFor, govStatusForDbError, loadGovBoard, parseGovAction } from "@/lib/hq/governance-model";

/**
 * /api/hq/governance — the Scholar Governance Model V1 registry (COMPETEN-SCHOLAR-GOV-IMPLEMENT-01, migration 610).
 *
 * GET   the registry: bodies, seats and their status, delegations, linked workflows, AI escalation steps
 * POST  one action: { action: appoint | end | declare_interest | set_delegation, ..., reason }
 *
 * ⚠ NOTHING HERE GRANTS ACCESS. A seat appointment is a governance record. Platform authority stays an HQ
 * appointment to a position, on /api/hq/appointments, with its own checks.
 *
 * ⚠ THE DATABASE IS THE GATE, THIS ROUTE IS THE FIRST REFUSAL. Each action is one owner-only hq_gov_admin_*
 * function that writes its audit_log row first. The separation-of-duties and board rules are a trigger, so they
 * hold for every writer. The actor is the session, never the body. Reads need hq.platform.users.view, the same
 * right as the positions and appointments screens beside it.
 */
const READ = ["hq.platform.users.view"];

export async function GET() {
  const ctx = await hqApiGate(READ);
  if (isHqRefusal(ctx)) return ctx;
  const load = await loadGovBoard(ctx.admin);
  return NextResponse.json({ load, canRecord: ctx.isOwner && load.state === "ok" });
}

export async function POST(req: Request) {
  const ctx = await hqOwnerApiGate(READ);
  if (isHqRefusal(ctx)) return ctx;

  const parsed = parseGovAction(await req.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  if (parsed.value.action === "appoint" && parsed.value.personId === ctx.userId)
    return NextResponse.json({ error: "You cannot record your own appointment. Another owner records it." }, { status: 409 });

  const { fn, args } = govRpcFor(parsed.value, { id: ctx.userId, name: ctx.fullName, trace: await currentTraceId() });
  const { data, error } = await ctx.admin.rpc(fn, args);
  if (error) {
    const { status, error: text } = govStatusForDbError(error.message, error.code);
    return NextResponse.json({ error: text }, { status });
  }
  return NextResponse.json({ ok: true, action: parsed.value.action, result: data });
}
