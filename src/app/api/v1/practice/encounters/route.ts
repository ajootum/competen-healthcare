import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import { launchEncounter, LIVE_STATUSES } from "@/lib/practice/encounters";

// GET  /api/v1/practice/encounters?status=live|all -- the encounter queue (CPR-V2-006 "encounter queue/history").
// POST /api/v1/practice/encounters -- FLOW-001 launch. Returns 200 with resumed:true when a live
//      encounter already exists for the patient, and 201 when one is created: resuming is a SUCCESS,
//      not a conflict, because "one active encounter per visit" is the intended behaviour rather than
//      an error the caller should recover from.

export async function GET(req: NextRequest) {
  const auth = await requirePracticeContext("encounter.list");
  if (isDenied(auth)) return auth;

  const scope = req.nextUrl.searchParams.get("status") ?? "live";
  let q = auth.caller.admin.from("practice_encounter")
    .select("id, patient_id, status, entry_pathway, encounter_mode, reason_for_visit, started_at")
    .eq("workspace_id", auth.ctx.workspaceId)
    .order("started_at", { ascending: false }).limit(50);
  if (scope === "live") q = q.in("status", LIVE_STATUSES);

  const { data: encounters } = await q;
  const ids = [...new Set(((encounters ?? []) as { patient_id: string }[]).map(e => e.patient_id))];
  const { data: patients } = ids.length
    ? await auth.caller.admin.from("practice_patient").select("id, display_name").in("id", ids)
    : { data: [] };
  const nameById = new Map(((patients ?? []) as { id: string; display_name: string }[]).map(p => [p.id, p.display_name]));

  return NextResponse.json({
    encounters: ((encounters ?? []) as Record<string, unknown>[]).map(e => ({ ...e, patientName: nameById.get(e.patient_id as string) ?? null })),
    correlationId: auth.caller.traceId,
  });
}

export async function POST(req: NextRequest) {
  const auth = await requirePracticeContext("encounter.create");
  if (isDenied(auth)) return auth;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  if (!body.patientId) return NextResponse.json({ error: "patientId is required" }, { status: 400 });

  const pathway = String(body.pathway ?? "booked");
  if (!["booked", "new_walk_in", "walk_in_followup", "scheduled_followup"].includes(pathway))
    return NextResponse.json({ error: "pathway must be one of the four FLOW-001 entry pathways" }, { status: 400 });

  const result = await launchEncounter(auth.caller.admin, {
    workspaceId: auth.ctx.workspaceId,
    patientId: String(body.patientId),
    pathway: pathway as "booked" | "new_walk_in" | "walk_in_followup" | "scheduled_followup",
    appointmentId: body.appointmentId ? String(body.appointmentId) : null,
    encounterMode: body.encounterMode ? String(body.encounterMode) : undefined,
    reasonForVisit: body.reasonForVisit ? String(body.reasonForVisit) : undefined,
    actorId: auth.caller.userId, correlationId: auth.caller.traceId,
  });

  if (!result.ok) return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });
  return NextResponse.json({ encounter: result.data, correlationId: auth.caller.traceId }, { status: result.data.resumed ? 200 : 201 });
}
