import { NextResponse } from "next/server";
import { requireIndividualContext, requireIndividualSession, isGuardRefusal, isSessionRefusal } from "@/lib/individual/guard";
import { gatewayConfig } from "@/lib/commerce/gateway";
import { learningCommerceEnabled } from "@/lib/learning/policy";
import { startCourseCheckout } from "@/lib/learning/commerce";

// Request-time only: it reads the release gates and the session, and must never be prerendered at build.
export const dynamic = "force-dynamic";

// POST /api/individual/learning/checkout -- COMPETEN-LEARNING-01 S3, migration 463. Body: { priceId }. Answers
// { link }, the hosted checkout to send the payer to.
//
// ⚠ DARK unless learning_app AND learning_commerce are on: 404, the answer of a route that does not exist. And with
// no gateway keys the checkout is refused NOT_CONFIGURED. Staging uses Flutterwave TEST keys only.
//
// ⚠ A MEMBER, NOT A SUBSCRIBER. requireIndividualContext (gate 3, membership) -- because course-purchase registration
// is OFF (owner D5) -- with no experience: buying a course never needs Scholar or Professional (D2).
//
// ⚠ A CONFIRMED EMAIL ONLY. The address goes to the payment provider and receives the receipt.

export async function POST(req: Request) {
  const ctx = await requireIndividualContext();
  if (isGuardRefusal(ctx)) return ctx;
  if (!(await learningCommerceEnabled(ctx.admin))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const s = await requireIndividualSession();
  if (isSessionRefusal(s)) return s;
  if (!s.email || !s.emailConfirmedAt) return NextResponse.json({ error: { code: "EMAIL_UNCONFIRMED", message: "Confirm your email address before paying." } }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const priceId = typeof body?.priceId === "string" ? body.priceId.trim().slice(0, 40) : "";
  const out = await startCourseCheckout(ctx.admin, gatewayConfig(), { userId: ctx.userId, email: s.email, name: ctx.profile.fullName, priceId });
  if (!out.ok) return NextResponse.json({ error: { code: out.code, message: out.message } }, { status: out.status });
  return NextResponse.json({ link: out.link, txRef: out.txRef });
}
