import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import { channelSettings, setChannel } from "@/lib/practice/messaging";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// /api/v1/practice/patient-communications -- CPR-BOOK-EMAIL-001 s10.
//
// The one door onto the practice's message channels. `setChannel` has existed, permission-guarded and
// audited, since the messaging arc -- what it never had was a caller, which is why every practice's
// email channel sat off and every booking page said no code could be sent. This route is deliberately
// thin: the engine owns the rules (a channel without a sender identity is refused; enabling is
// audited), and the pilot exposes EMAIL only. SMS and WhatsApp are not offered here -- creating the
// seam is the engine's job, already done; offering the channel is a product decision not yet taken.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export async function GET() {
  const auth = await requirePracticeContext("practice.settings.manage");
  if (isDenied(auth)) return auth;
  const { ctx, caller } = auth;
  const channels = await channelSettings(caller.admin, ctx.workspaceId);
  return NextResponse.json({ channels, correlationId: caller.traceId });
}

export async function POST(req: NextRequest) {
  const auth = await requirePracticeContext("practice.settings.manage");
  if (isDenied(auth)) return auth;
  const { ctx, caller } = auth;
  const body = await req.json().catch(() => ({}));

  if (body.action !== "set_email")
    return NextResponse.json({ error: "action must be set_email" }, { status: 400 });

  const r = await setChannel(caller.admin, ctx, {
    kind: "email",
    enabled: body.enabled === true,
    senderName: typeof body.senderName === "string" ? body.senderName : undefined,
    requireConsent: body.requireConsent === undefined ? undefined : body.requireConsent === true,
    correlationId: caller.traceId,
  });
  if (!r.ok) return NextResponse.json({ error: r.message, code: r.code }, { status: r.status });
  return NextResponse.json({ ok: true, enabled: r.data.enabled, correlationId: caller.traceId });
}
