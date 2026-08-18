import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import { emitEvent } from "@/lib/mos/event";
import { listDocuments, createDocument } from "@/lib/practice/documentation";

// GET  /api/v1/practice/documents?patientId=&encounterId=&status= -- CPR-130 document list.
// POST /api/v1/practice/documents                                  -- create one, optionally composed
//                                                                     from a real encounter.

export async function GET(req: NextRequest) {
  const auth = await requirePracticeContext("document.view");
  if (isDenied(auth)) return auth;

  const url = new URL(req.url);
  const documents = await listDocuments(auth.caller.admin, auth.ctx.workspaceId, {
    patientId: url.searchParams.get("patientId") ?? undefined,
    encounterId: url.searchParams.get("encounterId") ?? undefined,
    status: url.searchParams.get("status") ?? undefined,
  });
  return NextResponse.json({ documents, correlationId: auth.caller.traceId });
}

// CPR-CORE-MOS-001 phase 3 — Issue Document, the fourth instrumented critical journey.
//
// ⚠ SAME WRAPPER, SAME REASON. The body is unchanged and moved into makeDocument, which cannot return a
// bare response at all, so a return added later cannot escape the attempt/outcome pairing.
//
// ⚠ THE ATTEMPT EVENT IS practice.document.issue_attempted, ADDED BY MIGRATION 314. §6 gives this domain
// only result-shaped names — generated, issued, issue_failed — and none of them can carry an attempt
// without saying something untrue about itself.
export async function POST(req: NextRequest) {
  const auth = await requirePracticeContext("document.author");
  if (isDenied(auth)) return auth;

  const base = {
    practiceId: auth.ctx.workspaceId,
    practitionerId: auth.caller.userId,
    correlationId: auth.caller.traceId,
    component: "documents",
  } as const;

  await emitEvent(auth.caller.admin, { ...base, eventName: "practice.document.issue_attempted", outcome: "started" });

  // ⚠ THE CLOCK STARTS AFTER THE ATTEMPT EMIT, AND IT DID NOT USED TO. With it above, every
  // journey's duration included the round trip that RECORDED the attempt - a validation failure
  // returning immediately reported 440ms, almost all of it telemetry. The instrumentation was
  // measuring itself and inflating the latency of the journeys it exists to observe. Only running
  // the screen showed it: the numbers were plausible, and wrong.
  const startedAt = Date.now();

  const { res, failureCode } = await makeDocument(req, auth);

  await emitEvent(auth.caller.admin, failureCode === null
    ? { ...base, eventName: "practice.document.issued", outcome: "success", durationMs: Date.now() - startedAt }
    : { ...base, eventName: "practice.document.issue_failed", outcome: "failure", failureCode, durationMs: Date.now() - startedAt });

  return res;
}

/** The original handler, unchanged except that every return names its failure code. */
async function makeDocument(
  req: NextRequest,
  auth: Extract<Awaited<ReturnType<typeof requirePracticeContext>>, { ctx: unknown }>,
): Promise<{ res: NextResponse; failureCode: string | null }> {

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return { res: NextResponse.json({ error: "invalid JSON" }, { status: 400 }), failureCode: "INVALID_JSON" }; }
  if (!body.patientId) return { res: NextResponse.json({ error: "patientId is required" }, { status: 400 }), failureCode: "MISSING_PATIENT" };

  const result = await createDocument(auth.caller.admin, {
    workspaceId: auth.ctx.workspaceId,
    patientId: String(body.patientId),
    encounterId: body.encounterId ? String(body.encounterId) : null,
    templateId: body.templateId ? String(body.templateId) : null,
    docType: body.docType ? String(body.docType) : undefined,
    title: String(body.title ?? ""),
    addressedTo: body.addressedTo ? String(body.addressedTo) : undefined,
    body: body.body !== undefined ? String(body.body) : undefined,
    composeFrom: body.composeFrom === true,
    actorId: auth.caller.userId, correlationId: auth.caller.traceId,
  });
  if (!result.ok) return { res: NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status }), failureCode: result.code };
  return { res: NextResponse.json({ document: result.data, correlationId: auth.caller.traceId }, { status: 201 }), failureCode: null };
}
