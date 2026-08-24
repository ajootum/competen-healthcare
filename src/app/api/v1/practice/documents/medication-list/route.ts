import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import { generateMedicationList } from "@/lib/practice/document-automation";

// CPR-DOC-AUTO-001 s3/s5 -- the medication list, priority 7. One-click, no typed input at all.
//
// s13 asks only that the practitioner confirm the list, and s17's PASS condition is that it matches the
// authoritative current treatments -- so the document IS the list.

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const auth = await requirePracticeContext("document.author");
  if (isDenied(auth)) return auth;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  if (!body.patientId) return NextResponse.json({ error: "patientId is required" }, { status: 400 });
  const result = await generateMedicationList(auth.caller.admin, auth.ctx, {
    patientId: String(body.patientId),
    encounterId: body.encounterId ? String(body.encounterId) : null,
    factKeys: Array.isArray(body.factKeys) ? body.factKeys.map(String) : undefined,
    correlationId: auth.caller.traceId,
  });
  if (!result.ok)
    return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });

  return NextResponse.json({ ...result.data, correlationId: auth.caller.traceId }, { status: 201 });
}
