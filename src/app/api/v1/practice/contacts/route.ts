import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import { listContacts, recordContact } from "@/lib/practice/communication";

// GET  /api/v1/practice/contacts?patientId=&followUpId= -- the register of contact with patients.
// POST /api/v1/practice/contacts                        -- record one that happened in the world.
//
// READING rides on patient.list (the log is a patient-facing record); WRITING needs comm.record.
// Nothing here sends anything -- see migration 200, boundary decision 2.

export async function GET(req: NextRequest) {
  const auth = await requirePracticeContext("patient.list");
  if (isDenied(auth)) return auth;

  const url = new URL(req.url);
  const contacts = await listContacts(auth.caller.admin, auth.ctx.workspaceId, {
    patientId: url.searchParams.get("patientId") ?? undefined,
    followUpId: url.searchParams.get("followUpId") ?? undefined,
  });
  return NextResponse.json({ contacts, correlationId: auth.caller.traceId });
}

export async function POST(req: NextRequest) {
  const auth = await requirePracticeContext("comm.record");
  if (isDenied(auth)) return auth;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  if (!body.patientId) return NextResponse.json({ error: "patientId is required" }, { status: 400 });

  const result = await recordContact(auth.caller.admin, {
    workspaceId: auth.ctx.workspaceId,
    patientId: String(body.patientId),
    followUpId: body.followUpId ? String(body.followUpId) : null,
    encounterId: body.encounterId ? String(body.encounterId) : null,
    channel: body.channel ? String(body.channel) : undefined,
    direction: body.direction ? String(body.direction) : undefined,
    outcome: body.outcome ? String(body.outcome) : undefined,
    summary: String(body.summary ?? ""),
    actorId: auth.caller.userId, correlationId: auth.caller.traceId,
  });
  if (!result.ok) return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });
  return NextResponse.json({ contact: result.data, correlationId: auth.caller.traceId }, { status: 201 });
}
