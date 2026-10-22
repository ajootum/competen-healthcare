import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { setConsent } from "@/lib/individual/scholar/store";
import { audit } from "@/lib/individual/scholar/http";
import { CONSENT_FEATURE, CONSENT_NOTICE_VERSION } from "@/lib/individual/scholar/config";

// POST /api/individual/scholar/consent -- COMPETEN-IND-004, the migration-215 per-feature consent, per
// person. Body { grant: true } turns AI processing of the person's uploads on (recording the notice
// version shown), { grant: false } turns it off. Revoking deletes nothing. Every change is audited.

export async function POST(req: Request) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const body = await req.json().catch(() => ({}));
  if (typeof body?.grant !== "boolean") return NextResponse.json({ error: "Say whether to grant or revoke." }, { status: 400 });
  const r = await setConsent(ctx.admin, ctx.userId, body.grant);
  if (!r.ok) return NextResponse.json({ error: "Your choice could not be saved. Nothing has changed." }, { status: 500 });
  await audit(ctx, body.grant ? "individual_scholar_consent_granted" : "individual_scholar_consent_revoked", "individual_scholar_consent", null,
    { feature: CONSENT_FEATURE, notice_version: CONSENT_NOTICE_VERSION });
  return NextResponse.json({ ok: true, granted: body.grant });
}
