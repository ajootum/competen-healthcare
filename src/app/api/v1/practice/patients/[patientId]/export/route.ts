import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import { exportPatientRecord } from "@/lib/practice/privacy";

// GET /api/v1/practice/patients/{id}/export -- everything this practice holds about one patient.
//
// data.export IS ITS OWN CAPABILITY, held by the practitioner. Reading a record one screen at a time
// and taking the whole thing away in a file are different acts: the second leaves the product entirely,
// past every control in it, and is the one a practice would want to be able to point at afterwards.
//
// THE EXPORT IS LOGGED TWICE, deliberately -- once in the access log as the largest read there is, and
// once in the audit trail as a thing that was done. The two answer different questions later.

export async function GET(_req: NextRequest, { params }: { params: Promise<{ patientId: string }> }) {
  const auth = await requirePracticeContext("data.export");
  if (isDenied(auth)) return auth;
  const { patientId } = await params;

  const result = await exportPatientRecord(auth.caller.admin, auth.ctx, patientId, {
    correlationId: auth.caller.traceId,
  });
  if (!result.ok) return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });

  // Served as a download rather than a rendered page: a file full of somebody's clinical history should
  // land in the practitioner's hands as a file, not sit in a browser tab behind them.
  return new NextResponse(JSON.stringify(result.data, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="patient-${patientId}.json"`,
      // It is a snapshot of a clinical record; nothing should hold a copy of it.
      "Cache-Control": "no-store, private",
    },
  });
}
