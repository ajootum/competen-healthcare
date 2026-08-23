import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import { generateVisitSummary } from "@/lib/practice/document-automation";

// CPR-DOC-AUTO-001 s3/s5 -- the visit summary, priority 2. One-click into review: the only body this
// needs is which facts to include, and the form offers s9's default without asking anything.

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const auth = await requirePracticeContext("document.author");
  if (isDenied(auth)) return auth;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  if (!body.patientId) return NextResponse.json({ error: "patientId is required" }, { status: 400 });
  if (!body.encounterId) return NextResponse.json({ error: "encounterId is required" }, { status: 400 });

  const result = await generateVisitSummary(auth.caller.admin, auth.ctx, {
    patientId: String(body.patientId),
    encounterId: String(body.encounterId),
    // Omitted on purpose when the caller sends none -- see prepare(). An explicit [] still means none.
    factKeys: Array.isArray(body.factKeys) ? body.factKeys.map(String) : undefined,
    correlationId: auth.caller.traceId,
  });
  if (!result.ok)
    return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });

  return NextResponse.json({ ...result.data, correlationId: auth.caller.traceId }, { status: 201 });
}
