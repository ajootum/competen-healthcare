import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import { emitEvent } from "@/lib/mos/event";
import { listFollowUps, createFollowUp, followUpBoard, followUpWorkspace, listIntervals } from "@/lib/practice/follow-ups";

// GET  /api/v1/practice/follow-ups?patientId=&status=&board=1 -- CPR-140's obligations.
// GET  /api/v1/practice/follow-ups?workspace=1&view=&search=  -- CPR-FUP-001's cards + work queue.
// POST /api/v1/practice/follow-ups                            -- raise one.
//
// VIEW AND MANAGE ARE SEPARATE CAPABILITIES, and migration 196 s4 explains why at length: an assistant
// can work the board and chase people all day, and cannot alter a clinical obligation.

export async function GET(req: NextRequest) {
  const auth = await requirePracticeContext("followup.view");
  if (isDenied(auth)) return auth;

  const url = new URL(req.url);
  if (url.searchParams.get("board") === "1") {
    const [board, intervals] = await Promise.all([
      followUpBoard(auth.caller.admin, auth.ctx.workspaceId),
      listIntervals(auth.caller.admin),
    ]);
    return NextResponse.json({ board, intervals, correlationId: auth.caller.traceId });
  }

  // CPR-FUP-001 s4. The cards and the queue come back TOGETHER, from one read, because they are the
  // same list looked at two ways -- see followUpWorkspace. Two endpoints would be two reads and two
  // chances for a card to disagree with the list it opens.
  if (url.searchParams.get("workspace") === "1") {
    const workspace = await followUpWorkspace(auth.caller.admin, auth.ctx.workspaceId, {
      view: url.searchParams.get("view"),
      patientId: url.searchParams.get("patientId"),
      search: url.searchParams.get("search"),
      priority: url.searchParams.get("priority"),
      source: url.searchParams.get("source"),
    });
    return NextResponse.json({ workspace, correlationId: auth.caller.traceId });
  }

  const status = url.searchParams.get("status");
  const result = await listFollowUps(auth.caller.admin, auth.ctx.workspaceId, {
    patientId: url.searchParams.get("patientId") ?? undefined,
    status: status ? status.split(",") : undefined,
  });
  // `unavailable` is a FIELD ON THE PAYLOAD, not a comment on this route. A client receiving
  // `followUps: []` has no way to tell an empty board from a failed read, and the one it will show the
  // practitioner is the reassuring one. Spelled out rather than returning the result object whole, so
  // the shape of this response is a decision somebody made and not a refactor leaking through.
  return NextResponse.json({
    followUps: result.items,
    unavailable: result.unavailable,
    unavailableDetail: result.detail,
    correlationId: auth.caller.traceId,
  });
}

// CPR-CORE-MOS-001 phase 3 — Create Follow-up, the third instrumented critical journey.
//
// ⚠ SAME WRAPPER, SAME REASON. The body is unchanged and moved into makeFollowUp, which cannot return a
// bare response at all, so a return added later cannot escape the attempt/outcome pairing.
//
// ⚠ AND THIS JOURNEY NEEDED A NEW EVENT NAME TO HAVE A DENOMINATOR AT ALL. §6's catalogue gives
// follow-up only result-shaped names — created, failed, completed — and "created, with outcome started"
// is a sentence nobody should have to reconcile. practice.followup.attempted was added deliberately by
// migration 314 so what was TRIED can be counted, not only what succeeded.
export async function POST(req: NextRequest) {
  const auth = await requirePracticeContext("followup.manage");
  if (isDenied(auth)) return auth;

  const startedAt = Date.now();
  const base = {
    practiceId: auth.ctx.workspaceId,
    practitionerId: auth.caller.userId,
    correlationId: auth.caller.traceId,
    component: "follow_up",
  } as const;

  await emitEvent(auth.caller.admin, { ...base, eventName: "practice.followup.attempted", outcome: "started" });

  const { res, failureCode } = await makeFollowUp(req, auth);

  await emitEvent(auth.caller.admin, failureCode === null
    ? { ...base, eventName: "practice.followup.created", outcome: "success", durationMs: Date.now() - startedAt }
    : { ...base, eventName: "practice.followup.failed", outcome: "failure", failureCode, durationMs: Date.now() - startedAt });

  return res;
}

/** The original handler, unchanged except that every return names its failure code. */
async function makeFollowUp(
  req: NextRequest,
  auth: Extract<Awaited<ReturnType<typeof requirePracticeContext>>, { ctx: unknown }>,
): Promise<{ res: NextResponse; failureCode: string | null }> {

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return { res: NextResponse.json({ error: "invalid JSON" }, { status: 400 }), failureCode: "INVALID_JSON" }; }
  if (!body.patientId) return { res: NextResponse.json({ error: "patientId is required" }, { status: 400 }), failureCode: "MISSING_PATIENT" };

  const result = await createFollowUp(auth.caller.admin, {
    workspaceId: auth.ctx.workspaceId,
    patientId: String(body.patientId),
    originEncounterId: body.originEncounterId ? String(body.originEncounterId) : null,
    problemId: body.problemId ? String(body.problemId) : null,
    diagnosisId: body.diagnosisId ? String(body.diagnosisId) : null,
    kind: body.kind ? String(body.kind) : undefined,
    reason: String(body.reason ?? ""),
    dueOn: body.dueOn ? String(body.dueOn) : undefined,
    intervalCode: body.intervalCode ? String(body.intervalCode) : undefined,
    priority: body.priority ? String(body.priority) : undefined,
    // CPR-FUP-002 s5. `source` is passed through and VALIDATED by the engine rather than trusted:
    // a caller claiming "investigation" with no investigation behind it is refused there.
    source: body.source ? String(body.source) : undefined,
    originWorkspace: body.originWorkspace ? String(body.originWorkspace) : undefined,
    status: body.status ? String(body.status) : undefined,
    // ⚠ MIGRATION 299's FIELDS, AND THIS ROUTE DROPPED ALL SIX. The composer collected a type, an
    // owner and instructions; the engine accepted them; this file between the two forwarded none --
    // so every follow-up raised from the screen arrived typeless and unassigned, silently. The third
    // instance of the dropped-at-the-middle-layer class today (scheduledAt, the batch engine; now
    // this), and tsc waves every one through because an absent property is not an error.
    followUpType: body.followUpType ? String(body.followUpType) : undefined,
    assignedTo: body.assignedTo ? String(body.assignedTo) : undefined,
    assignedQueue: body.assignedQueue ? String(body.assignedQueue) : undefined,
    locationId: body.locationId ? String(body.locationId) : undefined,
    instructions: body.instructions ? String(body.instructions) : undefined,
    actorId: auth.caller.userId, correlationId: auth.caller.traceId,
  });
  if (!result.ok) return { res: NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status }), failureCode: result.code };
  return { res: NextResponse.json({ followUp: result.data, correlationId: auth.caller.traceId }, { status: 201 }), failureCode: null };
}
