import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import { requestQueue, handleRequest } from "@/lib/practice/booking-request-unverified";

/* eslint-disable @typescript-eslint/no-explicit-any */

// /api/v1/practice/booking-requests -- what a practice does with the messages patients leave it.
//
// ⚠ THE CAPABILITY IS `appointment.manage`, WHICH IS ALREADY SEEDED. Fifty codes are live on this
// platform and none is added here: answering "shall we see this person, and when" is arranging who is
// seen, which is exactly what appointment.manage governs. A new code would be a permission granted to
// nobody until somebody remembered to backfill practice_role_assignment -- migration 239 shipped three
// like that.
//
// ⚠ THERE IS NO VERB HERE THAT BOOKS ANYTHING. A practice that decides to see somebody books them in the
// diary, where the rules, checkPlacement and migration 255's exclusion constraint all apply. A "confirm"
// button on this endpoint would be a second booking path, and a second booking path is how the first
// one's guards stop being the ones that matter.

export async function GET(req: NextRequest) {
  const auth = await requirePracticeContext("appointment.manage");
  if (isDenied(auth)) return auth;
  const { ctx, caller } = auth;

  const r = await requestQueue(caller.admin, ctx, {
    includeHandled: req.nextUrl.searchParams.get("includeHandled") === "1",
  });
  return r.ok
    ? NextResponse.json({ ...r.data, correlationId: caller.traceId })
    : NextResponse.json({ error: r.message, code: r.code }, { status: r.status });
}

export async function POST(req: NextRequest) {
  const auth = await requirePracticeContext("appointment.manage");
  if (isDenied(auth)) return auth;

  let body: Record<string, any>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }

  const { ctx, caller } = auth;
  const r = await handleRequest(caller.admin, ctx, {
    requestId: String(body.requestId ?? ""),
    outcome: String(body.outcome ?? ""),
    note: body.note === undefined ? null : String(body.note),
    actorId: caller.userId, correlationId: caller.traceId,
  });
  return r.ok
    ? NextResponse.json({ ...r.data, correlationId: caller.traceId })
    : NextResponse.json({ error: r.message, code: r.code }, { status: r.status });
}
