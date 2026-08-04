import { NextRequest, NextResponse } from "next/server";
import { getCaller, isResponse, isSuper } from "@/lib/api-auth";
import {
  getFormat, updateFormat, formatHistory, formatPractitionerNumber,
  FORMAT_CHANGE_ACKNOWLEDGEMENT,
} from "@/lib/practice/identifier-format";

// GET   /api/v1/practice/identifier-format -- the current shape, its history, and a worked example
// PATCH /api/v1/practice/identifier-format -- change it
//
// SUPER-ADMIN ONLY. This is the shape of a permanent identifier that patients type and that is printed
// onto cards; it is not a display preference, and it is not something a practice configures for itself.
//
// A CHANGE NEVER TOUCHES A NUMBER ALREADY ISSUED, and the response says so in as many words rather than
// leaving an operator to infer it from silence.

export async function GET() {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSuper(c)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const admin = c.admin as any; // eslint-disable-line @typescript-eslint/no-explicit-any
  const [format, history] = await Promise.all([getFormat(admin), formatHistory(admin)]);
  const { count: issued } = await admin.from("practice_practitioner_identity")
    .select("*", { count: "exact", head: true });

  return NextResponse.json({
    format,
    history,
    issued: issued ?? 0,
    // A worked example, because a prefix and a digit count do not show what a person will actually read.
    example: formatPractitionerNumber(1, format),
    exampleLater: formatPractitionerNumber(123456, format),
    acknowledgement: FORMAT_CHANGE_ACKNOWLEDGEMENT,
    appliesToExisting: false,
  });
}

export async function PATCH(req: NextRequest) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSuper(c)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }

  const result = await updateFormat(c.admin as any, { // eslint-disable-line @typescript-eslint/no-explicit-any
    prefix: body.prefix === undefined ? undefined : String(body.prefix),
    digits: body.digits === undefined ? undefined : Number(body.digits),
    checkDigit: body.checkDigit === undefined ? undefined : body.checkDigit === true,
    separator: body.separator === undefined ? undefined : String(body.separator),
    reason: String(body.reason ?? ""),
    acknowledgement: body.acknowledgement ? String(body.acknowledgement) : undefined,
    actorId: c.userId, correlationId: c.traceId,
  });
  if (!result.ok)
    return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });

  return NextResponse.json({
    ...result.data,
    // STATED ON EVERY SUCCESSFUL CHANGE. The one thing an operator might otherwise assume happened.
    appliesToExisting: false,
    note: "Numbers already issued are unchanged. This shape applies to every number issued from now on.",
  });
}
