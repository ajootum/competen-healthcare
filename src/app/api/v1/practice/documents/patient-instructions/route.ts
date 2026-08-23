import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import { generatePatientInstructions } from "@/lib/practice/document-automation";

// CPR-DOC-AUTO-001 s3/s5 -- patient instructions, priority 3. Decision + generation: what the
// practitioner types, plus the treatment, medication and follow-up they tick.

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const auth = await requirePracticeContext("document.author");
  if (isDenied(auth)) return auth;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  if (!body.patientId) return NextResponse.json({ error: "patientId is required" }, { status: 400 });
  if (!body.encounterId) return NextResponse.json({ error: "encounterId is required" }, { status: 400 });

  const result = await generatePatientInstructions(auth.caller.admin, auth.ctx, {
    patientId: String(body.patientId),
    encounterId: String(body.encounterId),
    instructions: body.instructions ? String(body.instructions) : null,
    factKeys: Array.isArray(body.factKeys) ? body.factKeys.map(String) : [],
    correlationId: auth.caller.traceId,
  });
  if (!result.ok)
    return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });

  return NextResponse.json({ ...result.data, correlationId: auth.caller.traceId }, { status: 201 });
}
