import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import { emitEvent } from "@/lib/mos/event";
import { launchEncounter, LIVE_STATUSES } from "@/lib/practice/encounters";

// GET  /api/v1/practice/encounters?status=live|all[&patientId=] -- the encounter queue (CPR-V2-006
//      "encounter queue/history"), narrowable to one patient.
// POST /api/v1/practice/encounters -- FLOW-001 launch. Returns 200 with resumed:true when a live
//      encounter already exists for the patient, and 201 when one is created: resuming is a SUCCESS,
//      not a conflict, because "one active encounter per visit" is the intended behaviour rather than
//      an error the caller should recover from.

export async function GET(req: NextRequest) {
  const auth = await requirePracticeContext("encounter.list");
  if (isDenied(auth)) return auth;

  const scope = req.nextUrl.searchParams.get("status") ?? "live";
  // ONE PATIENT'S HISTORY, ASKED FOR BY THE THING THAT NEEDS IT. The start-an-encounter picker has to
  // know whether this person has been seen here before, because FLOW-001's pathway is written onto the
  // encounter and never revised. Reading the whole queue and filtering it in the browser would answer
  // "no earlier encounter" for anybody who fell outside the fifty most recent.
  const patientId = req.nextUrl.searchParams.get("patientId");
  let q = auth.caller.admin.from("practice_encounter")
    .select("id, patient_id, status, entry_pathway, encounter_mode, reason_for_visit, started_at")
    .eq("workspace_id", auth.ctx.workspaceId)
    .order("started_at", { ascending: false }).limit(50);
  if (scope === "live") q = q.in("status", LIVE_STATUSES);
  if (patientId) q = q.eq("patient_id", patientId);

  // ⚠ THE ERROR USED TO BE DISCARDED, AND THE PICKER IS WHY THAT NOW MATTERS. A refused read left
  // `encounters: []`, which reads as "this patient has never been seen here" -- and the caller then
  // files a returning patient's consultation as a first visit. An empty list and an unanswered
  // question are different facts and the payload now carries which one this is.
  const { data: encounters, error } = await q;
  const ids = [...new Set(((encounters ?? []) as { patient_id: string }[]).map(e => e.patient_id))];
  const { data: patients } = ids.length
    ? await auth.caller.admin.from("practice_patient").select("id, display_name").eq("workspace_id", auth.ctx.workspaceId).in("id", ids)
    : { data: [] };
  const nameById = new Map(((patients ?? []) as { id: string; display_name: string }[]).map(p => [p.id, p.display_name]));

  return NextResponse.json({
    encounters: ((encounters ?? []) as Record<string, unknown>[]).map(e => ({ ...e, patientName: nameById.get(e.patient_id as string) ?? null })),
    unavailable: !!error,
    detail: error?.message ?? null,
    correlationId: auth.caller.traceId,
  });
}

// CPR-CORE-MOS-001 phase 3 — Start Encounter, the second instrumented critical journey.
//
// ⚠ SAME WRAPPER AS PATIENT BOOKING, AND FOR THE SAME REASON. This handler has five terminal returns.
// Emits placed at each one work until a sixth return is added without a sixth emit, and that failure is
// silent: attempts would exceed outcomes and the journey's success rate would read low forever. The body
// below is unchanged and moved into startEncounter, which cannot return a bare response at all.
//
// ⚠ ONE EVENT NAME, THREE OUTCOMES, WHICH IS WHAT THE OUTCOME COLUMN IS FOR. practice.encounter.started
// is the ACT; started / success / failure is how it went. Patient Booking uses three names because §6
// gives it three, and both aggregate identically through the outcome column — the catalogue records the
// act, never the result.
export async function POST(req: NextRequest) {
  const auth = await requirePracticeContext("encounter.create");
  if (isDenied(auth)) return auth;

  const startedAt = Date.now();
  const base = {
    eventName: "practice.encounter.started",
    practiceId: auth.ctx.workspaceId,
    practitionerId: auth.caller.userId,
    correlationId: auth.caller.traceId,
    component: "encounter",
  } as const;

  await emitEvent(auth.caller.admin, { ...base, outcome: "started" });

  const { res, failureCode } = await startEncounter(req, auth);

  await emitEvent(auth.caller.admin, failureCode === null
    ? { ...base, outcome: "success", durationMs: Date.now() - startedAt }
    : { ...base, outcome: "failure", failureCode, durationMs: Date.now() - startedAt });

  return res;
}

/** The original handler, unchanged except that every return names its failure code. */
async function startEncounter(
  req: NextRequest,
  auth: Extract<Awaited<ReturnType<typeof requirePracticeContext>>, { ctx: unknown }>,
): Promise<{ res: NextResponse; failureCode: string | null }> {

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return { res: NextResponse.json({ error: "invalid JSON" }, { status: 400 }), failureCode: "INVALID_JSON" }; }
  if (!body.patientId) return { res: NextResponse.json({ error: "patientId is required" }, { status: 400 }), failureCode: "MISSING_PATIENT" };

  const pathway = String(body.pathway ?? "booked");
  if (!["booked", "new_walk_in", "walk_in_followup", "scheduled_followup"].includes(pathway))
    return { res: NextResponse.json({ error: "pathway must be one of the four FLOW-001 entry pathways" }, { status: 400 }), failureCode: "UNKNOWN_PATHWAY" };

  const result = await launchEncounter(auth.caller.admin, {
    workspaceId: auth.ctx.workspaceId,
    patientId: String(body.patientId),
    pathway: pathway as "booked" | "new_walk_in" | "walk_in_followup" | "scheduled_followup",
    appointmentId: body.appointmentId ? String(body.appointmentId) : null,
    encounterMode: body.encounterMode ? String(body.encounterMode) : undefined,
    reasonForVisit: body.reasonForVisit ? String(body.reasonForVisit) : undefined,
    actorId: auth.caller.userId, correlationId: auth.caller.traceId,
  });

  if (!result.ok) return { res: NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status }), failureCode: result.code };
  return { res: NextResponse.json({ encounter: result.data, correlationId: auth.caller.traceId }, { status: result.data.resumed ? 200 : 201 }), failureCode: null };
}
