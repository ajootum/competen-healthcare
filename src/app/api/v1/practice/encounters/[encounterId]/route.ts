import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import { getEncounter, transitionEncounter, saveNote } from "@/lib/practice/encounters";
import { ENCOUNTER_ACTIONS } from "@/lib/practice/encounter-constants";

// GET   /api/v1/practice/encounters/{id}          -- everything CPR-006 renders.
// PATCH /api/v1/practice/encounters/{id}          -- { action } state machine, or { noteType, body } autosave.
//
// Signing needs encounter.sign; everything else needs encounter.edit. That split is deliberate: an
// assistant may hold encounter.list to run the queue, and a future scribe role could hold edit without
// ever being able to put a practitioner's signature on a clinical record.

export async function GET(_req: NextRequest, { params }: { params: Promise<{ encounterId: string }> }) {
  const auth = await requirePracticeContext("encounter.list");
  if (isDenied(auth)) return auth;
  const { encounterId } = await params;

  const detail = await getEncounter(auth.caller.admin, auth.ctx.workspaceId, encounterId);
  if (!detail) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ...detail, correlationId: auth.caller.traceId });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ encounterId: string }> }) {
  const { encounterId } = await params;
  let body: { action?: string; noteType?: string; body?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }

  // Autosave path.
  if (body.noteType !== undefined) {
    const auth = await requirePracticeContext("encounter.edit");
    if (isDenied(auth)) return auth;
    const result = await saveNote(auth.caller.admin, {
      workspaceId: auth.ctx.workspaceId, encounterId, noteType: String(body.noteType),
      body: String(body.body ?? ""), actorId: auth.caller.userId, correlationId: auth.caller.traceId,
    });
    if (!result.ok) return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });
    return NextResponse.json({ saved: result.data, correlationId: auth.caller.traceId });
  }

  const to = ENCOUNTER_ACTIONS[body.action ?? ""];
  if (!to) return NextResponse.json({ error: `action must be one of: ${Object.keys(ENCOUNTER_ACTIONS).join(", ")}` }, { status: 400 });

  const auth = await requirePracticeContext(to === "SIGNED" ? "encounter.sign" : "encounter.edit");
  if (isDenied(auth)) return auth;

  const result = await transitionEncounter(auth.caller.admin, {
    workspaceId: auth.ctx.workspaceId, encounterId, to,
    actorId: auth.caller.userId, correlationId: auth.caller.traceId,
  });
  if (!result.ok) return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });
  return NextResponse.json({ encounter: result.data, correlationId: auth.caller.traceId });
}
