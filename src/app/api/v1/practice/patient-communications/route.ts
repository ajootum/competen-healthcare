import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import { channelSettings, setChannel, setMessagePreferences } from "@/lib/practice/messaging";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// /api/v1/practice/patient-communications -- CPR-SET-COMMS-001.
//
// The one door onto the practice's message channels. Two actions:
//
//   save_email       the patient-facing identity (sender name, reply-to) -- saving valid settings IS
//                    what activates the channel. There is no separate on switch, because s2 rules that
//                    email verification is a booking dependency, not a marketing opt-in. ("set_email"
//                    is accepted as an alias for the pre-CPR-SET-COMMS-001 console's wire format.)
//   set_preferences  which configurable message types send (s3.2). The engine refuses required types.
//
// The engine owns the rules; this stays thin. The pilot exposes EMAIL only -- SMS and WhatsApp are not
// offered here, and no provider name, credential or infrastructure detail crosses this boundary (s9).
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

  if (body.action === "save_email" || body.action === "set_email") {
    const r = await setChannel(caller.admin, ctx, {
      kind: "email",
      // Saving valid settings activates the channel unless the caller explicitly says otherwise --
      // the old console's off switch remains expressible on the wire, but no screen renders one.
      enabled: body.enabled === undefined ? true : body.enabled === true,
      senderName: typeof body.senderName === "string" ? body.senderName : undefined,
      replyTo: typeof body.replyTo === "string" ? body.replyTo : undefined,
      requireConsent: body.requireConsent === undefined ? undefined : body.requireConsent === true,
      correlationId: caller.traceId,
    });
    if (!r.ok) return NextResponse.json({ error: r.message, code: r.code }, { status: r.status });
    return NextResponse.json({ ok: true, enabled: r.data.enabled, correlationId: caller.traceId });
  }

  if (body.action === "set_preferences") {
    const r = await setMessagePreferences(caller.admin, ctx, {
      kind: "email",
      preferences: body.preferences && typeof body.preferences === "object" ? body.preferences : {},
      correlationId: caller.traceId,
    });
    if (!r.ok) return NextResponse.json({ error: r.message, code: r.code }, { status: r.status });
    return NextResponse.json({ ok: true, preferences: r.data.preferences, correlationId: caller.traceId });
  }

  return NextResponse.json({ error: "action must be save_email or set_preferences" }, { status: 400 });
}
