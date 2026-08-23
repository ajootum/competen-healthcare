import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { gatewayConfig, verifHashMatches } from "@/lib/practice/subscription-gateway";
import { applyWebhook } from "@/lib/practice/subscription";

// POST /api/v1/practice/billing/webhook/flutterwave
//
// ⚠ THIS IS THE ONLY UNAUTHENTICATED WRITE PATH IN THE PRACTICE API, because Flutterwave has no Competen
// session. Everything below follows from that:
//
//   - the verif-hash header is checked FIRST, constant-time, before the body is even parsed. An
//     unsigned request costs us one string compare and learns nothing.
//   - the body is treated as a HINT, never as fact. It supplies an event id and a transaction id; the
//     engine then asks Flutterwave what actually happened and compares that against our own row.
//   - it ALWAYS RETURNS 200 once the signature passes. A gateway retries on non-2xx, so returning 500 for
//     "this transaction is a mismatch" would summon the same bad delivery forever. The verdict is
//     recorded in practice_checkout_event; the HTTP status only tells Flutterwave we received it.
//
// A 401 is returned for a bad signature -- that one is worth retrying against, because it usually means
// the secret was rotated on one side only.

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const cfg = gatewayConfig();
  // Not configured is not "unauthorised": there is no secret to check against, so nothing can be trusted.
  if (!cfg) return NextResponse.json({ error: "not configured" }, { status: 503 });

  if (!verifHashMatches(req.headers.get("verif-hash"), cfg.secretHash)) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }

  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  const b = body as any;
  const data = b?.data ?? b;
  // Flutterwave has shipped more than one webhook shape over the years; the id can arrive at either level.
  const providerTxId = data?.id != null ? String(data.id) : (b?.id != null ? String(b.id) : null);
  const txRef = data?.tx_ref ? String(data.tx_ref) : (b?.txRef ? String(b.txRef) : null);

  // The idempotency KEY. Prefer the transaction id -- it is stable across retries of the same charge --
  // and fall back to the event id only when there is no transaction to key on.
  const providerEventId = providerTxId ?? (b?.["event.type"] ? String(b["event.type"]) : null) ?? txRef;
  if (!providerEventId) {
    return NextResponse.json({ received: true, verdict: "unverified", detail: "no usable id" }, { status: 200 });
  }

  const admin = createAdminClient();
  const result = await applyWebhook(admin, cfg, { providerEventId, providerTxId, txRef });

  // Logged, not returned in detail: the response goes to the gateway, and a verdict is internal.
  if (result.verdict !== "applied" && result.verdict !== "duplicate") {
    console.error(`[practice] flutterwave webhook ${result.verdict}: ${result.detail ?? ""}`);
  }
  return NextResponse.json({ received: true, verdict: result.verdict }, { status: 200 });
}
