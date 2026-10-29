import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { setConsent } from "@/lib/individual/scholar/store";
import { audit } from "@/lib/individual/scholar/http";
import { CONSENT_AWAITING_LEGAL, CONSENT_FEATURE, CONSENT_NOTICE_VERSION, CROSS_EXPERIENCE_FEATURE, CROSS_EXPERIENCE_NOTICE_VERSION } from "@/lib/individual/scholar/config";
import { consentDocuments } from "@/lib/individual/scholar/consent-gate";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build
// (a build-time render would fail without the service key, or freeze the gate into static HTML).
export const dynamic = "force-dynamic";

// POST /api/individual/scholar/consent -- COMPETEN-IND-004, the migration-215 per-feature consent, per
// person. Body { grant: true } turns AI processing of the person's uploads on (recording the notice
// version shown), { grant: false } turns it off. Revoking deletes nothing. Every change is audited.
// A grant is refused while the Privacy Notice and Terms of Use the notice relies on are unpublished
// (consent-gate.ts). Turning it off is always allowed.
// Migration 700: { feature: "ai_cross_experience_context", grant } is the person's choice to let the Scholar assistant read
// their own Professional development needs and plan goals. Granting it needs Professional to be live for them.

export async function POST(req: Request) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const body = await req.json().catch(() => ({}));
  if (typeof body?.grant !== "boolean") return NextResponse.json({ error: "Say whether to grant or revoke." }, { status: 400 });
  const cross = body.feature === CROSS_EXPERIENCE_FEATURE;
  if (body.feature !== undefined && !cross && body.feature !== CONSENT_FEATURE) return NextResponse.json({ error: "Unknown choice." }, { status: 400 });
  if (body.grant && !consentDocuments().published) return NextResponse.json({ error: CONSENT_AWAITING_LEGAL }, { status: 409 });
  if (cross && body.grant && !ctx.live.includes("professional")) return NextResponse.json({ error: "This needs Competen Professional, where your development plan is kept." }, { status: 409 });
  const feature = cross ? CROSS_EXPERIENCE_FEATURE : CONSENT_FEATURE;
  const r = await setConsent(ctx.admin, ctx.userId, body.grant, feature);
  if (!r.ok) return NextResponse.json({ error: "Your choice could not be saved. Nothing has changed." }, { status: 500 });
  await audit(ctx, body.grant ? "individual_scholar_consent_granted" : "individual_scholar_consent_revoked", "individual_scholar_consent", null,
    { feature, notice_version: cross ? CROSS_EXPERIENCE_NOTICE_VERSION : CONSENT_NOTICE_VERSION });
  return NextResponse.json({ ok: true, granted: body.grant });
}
