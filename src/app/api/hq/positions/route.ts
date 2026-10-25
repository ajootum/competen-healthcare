import { NextResponse } from "next/server";
import { hqApiGate, hqOwnerApiGate, isHqRefusal } from "@/lib/hq/api-gate";
import { currentTraceId } from "@/lib/trace";
import { loadPositionBoard, parsePositionAction, rpcFor, statusForDbError } from "@/lib/hq/positions";

/**
 * /api/hq/positions — HQ positions and their grants, without a migration (HQ-POSITION-ADMIN-01, migration 500).
 *
 * GET   the board: every position, every grant row (live and ended), the code catalogue marked applied or not
 * POST  one action: { action: create | update | set_active | grant | end_grant | register, ..., reason }
 *
 * ⚠ THE DATABASE IS THE GATE, THIS ROUTE IS THE FIRST REFUSAL. Each action is one hq_position_admin_* function
 * that checks ownership again, writes the audit_log row FIRST and the change after it, in one transaction. A
 * trigger on hq_position_capability refuses the separation-of-duties pairs for every writer. So nothing this
 * route forgets can be written, and nothing written lacks its audit row.
 *
 * ⚠ WHAT THIS ROUTE ADDS THAT THE DATABASE CANNOT: the code catalogue. A capability is enforced by routes and
 * hq-guard B1 requires the applied catalogue to equal src/lib/hq/spaces.ts, so a grant or a registration names
 * only a code that file defines, and a registration takes its SPACE from that file, never from the request.
 *
 * ⚠ THE WRITE GATE IS OWNERSHIP. hq.platform.users.view reads the board (Platform Director today). Letting it
 * write would let a Platform Director grant their own position anything -- the escalation this model exists to
 * prevent. There is no DELETE: positions are deactivated and grants are ended, both kept as history.
 */
const READ = ["hq.platform.users.view"];

export async function GET() {
  const ctx = await hqApiGate(READ);
  if (isHqRefusal(ctx)) return ctx;
  const board = await loadPositionBoard(ctx.admin);
  return NextResponse.json({ board, canAdminister: ctx.isOwner && board.migrationApplied });
}

export async function POST(req: Request) {
  const ctx = await hqOwnerApiGate(READ);
  if (isHqRefusal(ctx)) return ctx;

  const parsed = parsePositionAction(await req.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const { fn, args } = rpcFor(parsed.value, { id: ctx.userId, name: ctx.fullName, trace: await currentTraceId() });
  const { data, error } = await ctx.admin.rpc(fn, args);
  if (error) {
    const { status, error: text } = statusForDbError(error.message, error.code);
    return NextResponse.json({ error: text }, { status });
  }
  return NextResponse.json({ ok: true, action: parsed.value.action, result: data });
}
