import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import { recordProcedureBatch, MAX_PENDING_PROCEDURES } from "@/lib/practice/procedure-capture";
import { workspaceClock, instantInZone } from "@/lib/practice/practice-time";

// POST /api/v1/practice/procedures/batch -- CP-ENC-PROC-001's working set.
//
// ⚠ ADDITIVE. The single-procedure POST beside this one keeps its shape, because the old form, the API
// consumers and a harness assertion all speak it. Overloading one body to mean two things would make
// every one of them a guess about which path ran.
//
// ⚠ SAME CAPABILITY AS THE SINGLE ROUTE (procedure.record). Verified against that file rather than
// assumed -- the diagnosis engine shipped gated on the wrong one and had to be corrected.
//
// ⚠ AND PER-ITEM OUTCOMES SURVIVE A PARTIAL FAILURE. A flat error would tell the screen that three
// recorded procedures do not exist because a fourth was refused, and re-recording them would claim
// something was done to a patient twice.

export async function POST(req: NextRequest) {
  const auth = await requirePracticeContext("procedure.record");
  if (isDenied(auth)) return auth;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }

  const encounterId = String(body.encounterId ?? "");
  if (!encounterId)
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "encounterId is required" } }, { status: 400 });

  const raw = Array.isArray(body.items) ? body.items : [];
  if (raw.length === 0)
    return NextResponse.json({ error: { code: "NO_ITEMS", message: "there is nothing in the working set" } }, { status: 400 });
  if (raw.length > MAX_PENDING_PROCEDURES)
    return NextResponse.json({
      error: {
        code: "TOO_MANY_ITEMS",
        message: `${raw.length} procedures were submitted and one encounter takes at most ${MAX_PENDING_PROCEDURES}`,
      },
    }, { status: 422 });

  const str = (v: unknown) => (v === undefined || v === null || v === "" ? undefined : String(v));

  // ⚠ A SCHEDULED TIME IS COMPOSED HERE, IN THE PRACTICE TIMEZONE -- never on the client (2026-08-17).
  //
  // This screen used to send a bare `datetime-local` value ("2026-08-18T14:30"), which the engine wrote
  // straight into a timestamptz column. Postgres reads an offsetless timestamp in the connection's own
  // zone, so a Kampala 14:30 was stored as 14:30 UTC and rendered back as 17:30 -- the identical
  // misstamp the booking widgets already paid for ("date and time composed on the server, because a
  // client cannot compose an instant: it does not know the practice timezone, and its own machine's
  // zone is not evidence of it"). The appointments route's idiom is reused, not reinvented.
  //
  // `scheduledAt` is still accepted for a caller holding a REAL instant, exactly as bookAppointment
  // does -- but a refusal is returned rather than a guess when a wall clock cannot be read, because
  // the alternative is a procedure scheduled at a time nobody chose.
  const { timezone } = await workspaceClock(auth.caller.admin, auth.ctx.workspaceId);
  const composed: (string | undefined)[] = [];
  for (const r of raw as Record<string, unknown>[]) {
    const asInstant = str(r.scheduledAt);
    const date = str(r.scheduledDate);
    const time = str(r.scheduledTime);
    if (asInstant) { composed.push(asInstant); continue; }
    if (!date || !time) { composed.push(undefined); continue; }
    const instant = instantInZone(date, time, timezone);
    if (!instant)
      return NextResponse.json({
        error: {
          code: "VALIDATION_ERROR",
          message: `a scheduled time could not be read as a moment in ${timezone}`
            + " -- the date must be YYYY-MM-DD and the time HH:MM on the 24-hour clock",
        },
      }, { status: 400 });
    composed.push(instant);
  }

  const result = await recordProcedureBatch(auth.caller.admin, auth.ctx, {
    encounterId,
    items: (raw as Record<string, unknown>[]).map((r, i) => ({
      procedureTypeId: r.procedureTypeId ? String(r.procedureTypeId) : null,
      label: str(r.label),
      site: str(r.site),
      // ⚠ PASSED THROUGH UNVALIDATED ON PURPOSE. recordProcedure refuses a sided procedure with no side,
      // by name. A route that defaulted laterality would satisfy that check with a value nobody chose --
      // which on a sided procedure is a wrong-site record.
      laterality: str(r.laterality),
      indication: str(r.indication),
      consentStatus: str(r.consentStatus),
      consentNote: str(r.consentNote),
      anaesthesia: str(r.anaesthesia),
      materials: str(r.materials),
      immediateOutcome: str(r.immediateOutcome),
      status: str(r.status),
      abandonedReason: str(r.abandonedReason),
      // CPR-TRT-PROC-003 s10. The engine REFUSES a SCHEDULED procedure without it rather than
      // defaulting to now(), so this has to reach it or the status is a dead end on the screen.
      // The composed instant from above -- see the note beside it. Never the raw client string.
      scheduledAt: composed[i],
      // ⚠ CPR-PROC-HFE-005 s8, PASSED THROUGH AS AN OPAQUE MAP AND NARROWED BY THE ENGINE. Anything not
      // declared in the catalogue's detail_fields is dropped by detailValuesFor before it reaches the
      // table, so a caller cannot use this to write arbitrary keys against a patient's procedure.
      details: r.details && typeof r.details === "object" && !Array.isArray(r.details)
        ? Object.fromEntries(Object.entries(r.details as Record<string, unknown>)
          .map(([k, v]) => [k, String(v ?? "")]))
        : undefined,
    })),
    actorId: auth.caller.userId,
    correlationId: auth.caller.traceId,
  });

  if (!result.ok)
    return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });

  const failed = result.data.results.filter(r => !r.ok).length;
  return NextResponse.json(
    { ...result.data, correlationId: auth.caller.traceId },
    { status: failed > 0 && result.data.recorded > 0 ? 207 : (result.data.recorded > 0 ? 201 : 422) },
  );
}
