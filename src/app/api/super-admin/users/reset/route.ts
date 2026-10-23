import { NextResponse } from "next/server";
import { hqApiGate, isHqRefusal } from "@/lib/hq/api-gate";
import { RESET_CAPABILITY, isUserId, requestAdminReset } from "@/lib/hq/user-reset";

// Request-time only: it reads the session and must never be prerendered.
export const dynamic = "force-dynamic";

// POST /api/super-admin/users/reset { userId } -- HQ-USERS-B, migration 379.
//
// Email a password-reset link to another person, at their verified Auth address, through Supabase Auth
// recovery. Gated by hqApiGate(["hq.platform.users.reset"]): owners, and the Chief Executive and Platform
// Director appointments 379 grants it to. Every rule -- not yourself, owner accounts by owners only,
// suspended and unverified refused, 3 per person and 20 per administrator an hour, the neutral answer,
// the audit trail -- lives in src/lib/hq/user-reset.ts. This route only gates and parses.
//
// ⚠ IT NEVER RETURNS A LINK. Nothing in the response names the target's address or carries a token.
export async function POST(req: Request) {
  const ctx = await hqApiGate([RESET_CAPABILITY]);
  if (isHqRefusal(ctx)) return ctx;
  const body = await req.json().catch(() => ({}));
  if (!isUserId(body?.userId)) return NextResponse.json({ error: "Choose a person." }, { status: 400 });
  const r = await requestAdminReset(ctx.admin, { userId: ctx.userId, fullName: ctx.fullName, isOwner: ctx.isOwner }, body.userId);
  return NextResponse.json(r.body, { status: r.status });
}
