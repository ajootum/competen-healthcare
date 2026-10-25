import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { markNoticeRead } from "@/lib/individual/notifications";
import { isUuid } from "@/lib/individual/professional/validate";

// Request-time only: never prerendered, no client at build time (foundation harness 11a).
export const dynamic = "force-dynamic";

// /api/individual/notifications -- mark one of the person's own notices read (migration 437).
//
// Any experience: a notice belongs to the person, not to Scholar or Professional. The write is the service role,
// scoped to the signed-in person's own row, and it changes read_at only (437's guard refuses anything else).

export async function PATCH(req: Request) {
  const ctx = await requireIndividualContext();
  if (isGuardRefusal(ctx)) return ctx;
  const body = await req.json().catch(() => ({}));
  if (!isUuid(body?.id)) return NextResponse.json({ error: "Choose a notice." }, { status: 400 });
  const changed = await markNoticeRead(ctx.admin, ctx.userId, body.id);
  return NextResponse.json({ ok: true, changed });
}
