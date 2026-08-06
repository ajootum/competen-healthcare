import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import { recordReferral, updateReferralStatus } from "@/lib/practice/encounter-workspace";

// POST  /api/v1/practice/encounters/{id}/referrals  -- record that a referral was decided on.
// PATCH /api/v1/practice/encounters/{id}/referrals  -- record what the practitioner has since been told.
//
// ⚠ RECORDED, NOT SENT. CompetenPractice has no email, no SMS and no messaging of any kind. There is no
// channel in this body, no recipient address, and no sent_at anywhere in the table -- nothing here may
// ever claim that anything was transmitted. The letter that actually goes somewhere is a
// practice_clinical_document with its own release register (migration 195).
//
// `accepted` and `declined` are recorded only when somebody TOLD the practitioner. They are notes about
// news received, not observations of a system.

export async function POST(req: NextRequest, { params }: { params: Promise<{ encounterId: string }> }) {
  const auth = await requirePracticeContext("encounter.edit");
  if (isDenied(auth)) return auth;
  const { encounterId } = await params;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }

  const result = await recordReferral(auth.caller.admin, {
    workspaceId: auth.ctx.workspaceId, encounterId,
    referredTo: String(body.referredTo ?? ""), reason: String(body.reason ?? ""),
    referredOn: body.referredOn ? String(body.referredOn) : undefined,
    actorId: auth.caller.userId, correlationId: auth.caller.traceId,
  });
  if (!result.ok) return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });
  return NextResponse.json({ referral: result.data, correlationId: auth.caller.traceId }, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const auth = await requirePracticeContext("encounter.edit");
  if (isDenied(auth)) return auth;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }

  const referralId = String(body.referralId ?? "");
  if (!referralId) return NextResponse.json({ error: "referralId is required" }, { status: 400 });

  const result = await updateReferralStatus(auth.caller.admin, {
    workspaceId: auth.ctx.workspaceId, referralId, status: String(body.status ?? ""),
    actorId: auth.caller.userId, correlationId: auth.caller.traceId,
  });
  if (!result.ok) return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });
  return NextResponse.json({ referral: result.data, correlationId: auth.caller.traceId });
}
