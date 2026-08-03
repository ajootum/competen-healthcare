import { NextRequest, NextResponse } from "next/server";
import { getCaller, isResponse } from "@/lib/api-auth";
import { acceptInvitation } from "@/lib/practice/team";

// POST /api/v1/practice/team/join -- redeem an invitation code.
//
// THE ONLY PRACTICE ROUTE THAT DOES NOT USE requirePracticeContext, and it cannot: the caller is not a
// member of anything yet, which is the entire point of the request. So the guard is authentication
// ALONE, and the workspace comes from the invitation rather than from a header, a cookie or the body.
// A caller cannot name the practice they are joining -- only present a code that names it for them.
//
// EVERY BAD CODE GETS THE SAME REFUSAL. The engine does not distinguish "no such code" from "already
// used" from "expired", because telling somebody which of their guesses was nearly right is help they
// should not receive.

export async function POST(req: NextRequest) {
  const caller = await getCaller();
  if (isResponse(caller)) return caller;

  let body: { code?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }

  const result = await acceptInvitation(caller.admin, {
    code: String(body.code ?? ""), userId: caller.userId, correlationId: caller.traceId,
  });
  if (!result.ok) return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });

  return NextResponse.json({ joined: result.data, correlationId: caller.traceId }, { status: 201 });
}
