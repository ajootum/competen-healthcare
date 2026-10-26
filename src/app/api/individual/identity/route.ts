import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { parseIdentityPatch, saveIdentity } from "@/lib/individual/identity";
import { audit, refuse } from "@/lib/individual/professional/api";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build.
export const dynamic = "force-dynamic";

// PUT /api/individual/identity -- COMPETEN-INDIVIDUAL-IDENTITY-HUB-01 (590): the person's own preferred name,
// headline, location and biography, shared by every experience they hold. Self-declared, never verified, private
// unless they put it on a Passport link. The audit row names the fields changed, never their values.

export async function PUT(req: Request) {
  const ctx = await requireIndividualContext();
  if (isGuardRefusal(ctx)) return ctx;
  const parsed = parseIdentityPatch(await req.json().catch(() => ({})));
  if (!parsed.ok) return refuse(parsed.error);
  const saved = await saveIdentity(ctx.admin, ctx.userId, parsed.patch);
  if (saved === "not_provisioned") return refuse("This part of your profile is not set up here yet. Nothing was changed.", 409);
  if (saved === "failed") return refuse("Your profile could not be saved just now. Nothing was changed.", 503);
  await audit(ctx, "individual_identity_update", "individual_identity_profile", ctx.userId, { experience: null, fields: Object.keys(parsed.patch) });
  return NextResponse.json({ ok: true });
}
