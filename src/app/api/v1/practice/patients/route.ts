import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import { searchPatients, registerPatient } from "@/lib/practice/patients";

// GET  /api/v1/practice/patients?q= -- ranked registry search (CPR-V2-004; FLOW-001 search inputs).
// POST /api/v1/practice/patients    -- register (CPR-V2-005: duplicate detection BEFORE save; a 409 with
//       candidates is the workflow working, not an error to hide -- the UI shows the candidates and the
//       caller either opens one or confirms a genuine namesake with confirmNew).

export async function GET(req: NextRequest) {
  const auth = await requirePracticeContext("patient.list");
  if (isDenied(auth)) return auth;

  const q = req.nextUrl.searchParams.get("q") ?? "";
  const { results } = await searchPatients(auth.caller.admin, auth.ctx.workspaceId, q);
  return NextResponse.json({ results, correlationId: auth.caller.traceId });
}

export async function POST(req: NextRequest) {
  const auth = await requirePracticeContext("patient.create");
  if (isDenied(auth)) return auth;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }

  const result = await registerPatient(auth.caller.admin, {
    workspaceId: auth.ctx.workspaceId,
    displayName: String(body.displayName ?? ""),
    sex: body.sex ? String(body.sex) : undefined,
    birthDate: body.birthDate ? String(body.birthDate) : undefined,
    ageEstimateYears: body.ageEstimateYears != null ? Number(body.ageEstimateYears) : undefined,
    phone: body.phone ? String(body.phone) : undefined,
    email: body.email ? String(body.email) : undefined,
    identifiers: Array.isArray(body.identifiers)
      ? (body.identifiers as { type: string; value: string; issuer?: string }[]).filter(i => i?.type && i?.value).slice(0, 8)
      : undefined,
    confirmNew: body.confirmNew === true,
    actorId: auth.caller.userId,
    correlationId: auth.caller.traceId,
  });

  if (!result.ok) {
    return NextResponse.json({
      error: { code: result.code, message: result.message }, candidates: result.candidates ?? [],
    }, { status: result.status });
  }
  return NextResponse.json({ patient: result.data, correlationId: auth.caller.traceId }, { status: 201 });
}
