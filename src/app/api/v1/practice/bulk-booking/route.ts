import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import { createAdminClient } from "@/lib/supabase/server";
import { bulkCommit, type BulkRow } from "@/lib/practice/bulk-booking";

// CP-BULK-BOOKING-001 s13's create endpoint.
//
// ⚠ IT CREATES NOTHING ITSELF. Every row goes through bookAppointment, the same domain service
// single-patient booking uses, because s13 forbids a parallel rules engine for bulk operations.
//
// ⚠ AND IT RETURNS PER-ROW OUTCOMES EVEN WHEN ROWS FAILED (s12: "return row-level success/failure
// payloads even when the overall request fails"). A 4xx carrying no detail would leave the screen unable
// to say which patient was not booked, and s12 forbids silently skipping any of them.

const MAX_ROWS = 100;

export async function POST(req: NextRequest) {
  const auth = await requirePracticeContext("appointment.manage");
  if (isDenied(auth)) return auth;

  const body = await req.json().catch(() => ({}));
  const raw = Array.isArray(body?.rows) ? body.rows : [];
  if (raw.length === 0)
    return NextResponse.json({ error: { code: "NO_ROWS", message: "no rows were submitted" } }, { status: 400 });
  // A bound, so one request cannot sit in a loop for minutes. Named rather than silently truncating:
  // a batch quietly cut to 100 would look like it booked everybody.
  if (raw.length > MAX_ROWS)
    return NextResponse.json({
      error: { code: "TOO_MANY_ROWS", message: `${raw.length} rows were submitted and the limit for one batch is ${MAX_ROWS} -- book this clinic in two passes` },
    }, { status: 422 });

  const rows: BulkRow[] = raw.map((r: Record<string, unknown>) => ({
    clientRowId: String(r.clientRowId ?? ""),
    patientId: String(r.patientId ?? ""),
    startsAt: String(r.startsAt ?? ""),
    visitTypeId: String(r.visitTypeId ?? ""),
    consultationModeId: String(r.consultationModeId ?? ""),
    locationId: r.locationId ? String(r.locationId) : null,
    note: r.note ? String(r.note) : null,
  }));

  const missing = rows.filter(r => !r.patientId || !r.startsAt || !r.clientRowId);
  if (missing.length)
    return NextResponse.json({
      error: { code: "VALIDATION_ERROR", message: "every row needs a patient, a time and a row id" },
    }, { status: 400 });

  const admin = createAdminClient();
  const result = await bulkCommit(admin, auth.ctx, {
    rows, actorId: auth.caller.userId, correlationId: auth.caller.traceId,
  });

  // 207 is the honest status for a batch where some rows worked and some did not: a flat 200 would tell
  // a retry-on-failure client that everything succeeded, and a 4xx would tell it nothing did.
  const status = result.booked > 0 && result.failed > 0 ? 207 : (result.ok ? 200 : 422);
  return NextResponse.json({
    outcomes: result.outcomes, booked: result.booked, failed: result.failed,
    ...(result.ok ? {} : { error: { code: result.code ?? "NOTHING_BOOKED", message: result.message ?? "no row could be booked" } }),
  }, { status });
}
