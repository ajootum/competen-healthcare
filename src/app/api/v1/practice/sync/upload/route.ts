import { NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import { applyBatch, SYNC_MAX_BATCH, type SyncTransaction } from "@/lib/practice/sync-engine";

// POST /api/v1/practice/sync/upload — COMP-END-001 s5, COMP-SYNC-001 s10 "upload pending events".
//
// ════════════════════════════════════════════════════════════════════════════════════════════════════
// ⚠ EVERY TRANSACTION GETS A VERDICT, INCLUDING THE ONES THIS SERVER WILL NOT TAKE.
//
// The device is holding the only copy of what it uploads. A transaction that is silently ignored stays
// `pending` on that device for ever, counted in a queue that never drains, and the practitioner is told
// their work is on its way. So the response is a verdict PER TRANSACTION and never a bare 200.
//
// ⚠ AND THE VERDICT CARRIES `retryable`, WHICH IS NOT THE SAME AS THE STATUS. `refused` in the outbox
// means the server understood and said no, so the record leaves the retry loop and escalates. A ledger
// that would not read, or an applier that threw, is a TRANSIENT failure wearing the same status -- and a
// client that treated it as refused would abandon a real consultation over a database blip.
//
// ⚠ WHY THERE IS NO /sync/ack ENDPOINT, THOUGH COMP-END-001 s5 LISTS ONE. An ack exists to close the
// loop when the server processes asynchronously and the client must confirm later. This server applies
// while it holds the request, so the response IS the acknowledgement -- and an ack endpoint would be a
// second, later chance to mark something delivered that the first response already settled. Two places
// deciding the same fact is how they come to disagree. If processing ever becomes asynchronous, this
// comment is the thing to revisit.
//
// ⚠ NOR IS THERE A /sync/conflict ENDPOINT. A conflict is a verdict on a transaction, recorded on that
// transaction's ledger row with status 'conflict'. A separate endpoint would need its own store and its
// own idea of which conflicts exist, and the two would drift. The resolution SCREEN (precondition 5)
// reads the ledger.

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate, private" };

/** ⚠ Coerced field by field. A spread would let a caller set columns the ledger never agreed to. */
function readTransaction(raw: unknown): SyncTransaction | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const op = String(r.operation ?? "");
  return {
    id: String(r.id ?? ""),
    deviceId: String(r.deviceId ?? ""),
    entityType: String(r.entityType ?? ""),
    entityId: String(r.entityId ?? ""),
    operation: (op === "create" || op === "update" || op === "delete" ? op : "create"),
    payload: r.payload ?? null,
    baseVersion: typeof r.baseVersion === "number" ? r.baseVersion : null,
    clientSequence: typeof r.clientSequence === "number" ? r.clientSequence : 0,
    occurredAt: String(r.occurredAt ?? ""),
    payloadHash: typeof r.payloadHash === "string" ? r.payloadHash : null,
  };
}

export async function POST(request: Request) {
  // ⚠ THE SAME CAPABILITY THE ONLINE WRITE PATH USES IS CHECKED BY THE APPLIER, NOT HERE. This gate is
  // membership plus a capability every practitioner who can record anything holds; each applier re-checks
  // what its own entity needs. A single coarse capability here would let somebody who may book an
  // appointment upload an encounter.
  const auth = await requirePracticeContext("encounter.list");
  if (isDenied(auth)) return auth;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "The upload could not be read as JSON. Nothing was filed." },
      { status: 400, headers: NO_STORE });
  }

  const raw = (body as { transactions?: unknown })?.transactions;
  if (!Array.isArray(raw))
    return NextResponse.json({ error: "The upload carried no transactions. Nothing was filed." },
      { status: 400, headers: NO_STORE });

  // ⚠ REFUSED WHOLE RATHER THAN TRUNCATED. Taking the first hundred and dropping the rest would return a
  // success the device reads as "all delivered", and the remainder would be marked delivered on a
  // response that never mentioned them.
  if (raw.length > SYNC_MAX_BATCH)
    return NextResponse.json({
      error: `An upload can carry at most ${SYNC_MAX_BATCH} items and this one carried ${raw.length}. Nothing was filed — send them in smaller batches.`,
    }, { status: 413, headers: NO_STORE });

  const transactions = raw.map(readTransaction).filter((t): t is SyncTransaction => t !== null);

  const result = await applyBatch(auth.caller.admin, auth.ctx, transactions, {
    actorId: auth.caller.userId,
  });

  return NextResponse.json({
    verdicts: result.verdicts,
    applied: result.applied,
    refused: result.refused,
    conflicts: result.conflicts,
    // ⚠ Reported so a client can tell "you sent me things I could not read" from "I took everything".
    received: raw.length,
    understood: transactions.length,
    correlationId: auth.caller.traceId,
  }, { headers: NO_STORE });
}
