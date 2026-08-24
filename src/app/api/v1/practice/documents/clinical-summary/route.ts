import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import { generateClinicalSummary } from "@/lib/practice/document-automation";

// CPR-DOC-AUTO-001 s3/s5 -- the clinical summary, priority 4. Select + summarise over the longitudinal
// record.
//
// THE ONLY GENERATED DOCUMENT WITH NO REQUIRED CONSULTATION. A summary asked for by an insurer or a new
// treating clinician is written between appointments. encounterId is accepted and honoured when given.

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const auth = await requirePracticeContext("document.author");
  if (isDenied(auth)) return auth;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  if (!body.patientId) return NextResponse.json({ error: "patientId is required" }, { status: 400 });
  const result = await generateClinicalSummary(auth.caller.admin, auth.ctx, {
    patientId: String(body.patientId),
    encounterId: body.encounterId ? String(body.encounterId) : null,
    destinationId: body.destinationId ? String(body.destinationId) : null,
    recipient: (body.recipient ?? null) as never,
    purpose: String(body.purpose ?? ""),
    from: body.from ? String(body.from) : null,
    to: body.to ? String(body.to) : null,
    factKeys: Array.isArray(body.factKeys) ? body.factKeys.map(String) : [],
    // CPR-DOC-AUTO-001 s10. Anything other than an explicit "assisted" is deterministic -- the
    // safe reading of an absent, malformed or unexpected value.
    phrasing: body.phrasing === "assisted" ? "assisted" : "deterministic",
    // CPR-DOC-CONFIG-001 s12. Bounded to section order and visibility, and validated in the engine
    // rather than here -- a second caller must not be able to skip the bound by not being this file.
    documentOverride: (body.documentOverride ?? null) as never,
    correlationId: auth.caller.traceId,
  });
  if (!result.ok)
    return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });

  return NextResponse.json({ ...result.data, correlationId: auth.caller.traceId }, { status: 201 });
}
