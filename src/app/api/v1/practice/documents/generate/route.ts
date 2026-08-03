import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import { generateFromTemplate } from "@/lib/practice/document-generation";

// POST /api/v1/practice/documents/generate -- CPR-330 generate one document from a template.
//
// document.author, not report.view: a generated referral letter is an authored clinical document and
// must not become easier to produce because a template did the typing.
//
// A 422 UNRESOLVED_FIELDS is the normal, useful answer -- the client shows which fields are missing and
// offers `allowUnresolved` to generate the draft with visible [[markers]] to fill by hand.

export async function POST(req: NextRequest) {
  const auth = await requirePracticeContext("document.author");
  if (isDenied(auth)) return auth;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  if (!body.templateId) return NextResponse.json({ error: "templateId is required" }, { status: 400 });
  if (!body.patientId) return NextResponse.json({ error: "patientId is required" }, { status: 400 });

  const result = await generateFromTemplate(auth.caller.admin, auth.ctx, {
    templateId: String(body.templateId),
    patientId: String(body.patientId),
    encounterId: body.encounterId ? String(body.encounterId) : null,
    title: body.title ? String(body.title) : undefined,
    addressedTo: body.addressedTo ? String(body.addressedTo) : undefined,
    allowUnresolved: body.allowUnresolved === true,
    correlationId: auth.caller.traceId,
  });
  if (!result.ok) return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });
  return NextResponse.json({ document: result.data, correlationId: auth.caller.traceId }, { status: 201 });
}
