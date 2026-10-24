import { NextResponse } from "next/server";
import { requireIndividualSession, isSessionRefusal } from "@/lib/individual/guard";
import { individualCommerceEnabled, startIndividualCheckout } from "@/lib/individual/commerce";
import { gatewayConfig } from "@/lib/commerce/gateway";

// Request-time only: it reads two gates and the session, and must never be prerendered at build.
export const dynamic = "force-dynamic";

// POST /api/individual/billing/checkout -- begin paying for one Competen Individual plan (P1 Commercial,
// migration 399). Body: { planCode }. Answers { link }, the hosted checkout to send the payer to.
//
// ⚠ DARK unless BOTH the release gate and individual_commerce are on: 404 before the body is read, the same
// answer as a route that does not exist. requireIndividualSession, not requireIndividualContext, because a
// first purchase may come from a signed-in person with no membership yet -- the membership is written by the
// settlement, never here, and only after the payment is proven.
//
// ⚠ A CONFIRMED EMAIL ONLY. The address goes to the payment provider and receives the receipt.

export async function POST(req: Request) {
  const s = await requireIndividualSession();
  if (isSessionRefusal(s)) return s;
  if (!(await individualCommerceEnabled(s.admin))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!s.email || !s.emailConfirmedAt)
    return NextResponse.json({ error: { code: "EMAIL_UNCONFIRMED", message: "Confirm your email address before paying." } }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const planCode = typeof body?.planCode === "string" ? body.planCode.trim() : "";
  if (!/^[a-z0-9_]{3,64}$/.test(planCode))
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "planCode must name a plan" } }, { status: 400 });

  const { data: profile } = await s.admin.from("profiles").select("full_name").eq("id", s.userId).maybeSingle();
  const out = await startIndividualCheckout(s.admin, gatewayConfig(), {
    userId: s.userId, email: s.email, name: profile?.full_name ?? null, planCode,
  });
  if (!out.ok) return NextResponse.json({ error: { code: out.code, message: out.message } }, { status: out.status });
  return NextResponse.json({ link: out.link, txRef: out.txRef });
}
