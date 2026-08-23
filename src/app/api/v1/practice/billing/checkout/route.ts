import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import { gatewayConfig } from "@/lib/practice/subscription-gateway";
import { startCheckout } from "@/lib/practice/subscription";

// POST /api/v1/practice/billing/checkout  { planCode }
//
// Starts a Flutterwave checkout for the CALLER'S OWN workspace and returns the hosted payment link.
//
// ⚠ THE AMOUNT IS NEVER TAKEN FROM THE REQUEST. Only a plan CODE crosses the wire; the price is read from
// practice_plans server-side. A client-supplied amount is the oldest hole in payment integrations -- it
// turns the price into a suggestion.
//
// ⚠ AND THE WORKSPACE IS NEVER TAKEN FROM THE REQUEST EITHER. It comes from requirePracticeContext, so a
// practitioner cannot start a checkout that would pay for somebody else's workspace, whether by mistake
// or otherwise.

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const auth = await requirePracticeContext("practice.settings.manage");
  if (isDenied(auth)) return auth;

  let body: { planCode?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  const planCode = typeof body.planCode === "string" ? body.planCode.trim() : "";
  if (!planCode) return NextResponse.json({ error: "planCode required" }, { status: 400 });

  const { data: me } = await auth.caller.admin.from("profiles")
    .select("email, full_name").eq("id", auth.caller.userId).maybeSingle();
  // The gateway needs an email for the receipt. It comes from the profile, never from the request body --
  // a client-supplied billing email is a phishing surface and a way to misdirect a receipt.
  const email = me?.email ?? null;
  if (!email) return NextResponse.json({ error: "No email on file to bill against" }, { status: 409 });

  const result = await startCheckout(auth.caller.admin, gatewayConfig(), {
    workspaceId: auth.ctx.workspaceId,
    userId: auth.caller.userId,
    email,
    name: me?.full_name ?? null,
    planCode,
    correlationId: auth.caller.traceId,
  });

  if (!result.ok) {
    // Each of these is a different thing for the practitioner to do, so they are not collapsed into 500.
    const status = result.code === "NOT_CONFIGURED" ? 503
      : result.code === "NO_SUCH_PLAN" ? 404
      : result.code === "PLAN_NOT_PRICED" ? 409
      : result.code === "GATEWAY_REFUSED" ? 502
      : 500;
    // `detail` can carry the gateway's own words; it is logged, not shown.
    if (result.detail) console.error(`[practice] checkout ${result.code} for ${auth.ctx.workspaceId}: ${result.detail}`);
    const message = result.code === "NOT_CONFIGURED" ? "Payments are not configured on this deployment yet."
      : result.code === "NO_SUCH_PLAN" ? "That plan is not available."
      : result.code === "PLAN_NOT_PRICED" ? "That plan has no price set, so it cannot be paid for yet."
      : result.code === "GATEWAY_REFUSED" ? "The payment provider could not start this checkout. Nothing was charged."
      : "The checkout could not be started. Nothing was charged.";
    return NextResponse.json({ error: message, code: result.code, correlationId: auth.caller.traceId }, { status });
  }

  return NextResponse.json({ link: result.link, txRef: result.txRef, correlationId: auth.caller.traceId }, { status: 201 });
}
