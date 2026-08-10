import { NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import { syncStatus } from "@/lib/practice/sync-engine";

// GET /api/v1/practice/sync/status — COMP-SYNC-001 s10 "provide synchronization status",
// CP-SYNC-001 s7, CP-OFF-UI-001 s7 (the Synchronisation Centre).
//
// ⚠ IT REPORTS WHAT THE SERVER RECEIVED, NOT WHAT A DEVICE IS HOLDING. The two are different questions
// and only the device can answer the second -- its outbox is local and no server has ever seen it. A
// screen that showed this count as "items waiting" would tell a practitioner with fifty unsent notes
// that everything was fine. The Synchronisation Centre reads BOTH: the outbox for what is waiting, and
// this for what arrived and what the practice would not take.
//
// ⚠ `syncableEntityTypes` IS DELIBERATELY IN THE PAYLOAD AND IS CURRENTLY EMPTY. It is how a screen can
// say why nothing can be filed from a device yet, rather than rendering an empty ledger as success.

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate, private" };

export async function GET() {
  const auth = await requirePracticeContext("encounter.list");
  if (isDenied(auth)) return auth;

  const report = await syncStatus(auth.caller.admin, auth.ctx.workspaceId);

  return NextResponse.json({ ...report, correlationId: auth.caller.traceId }, { headers: NO_STORE });
}
