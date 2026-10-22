import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { isUuid } from "@/lib/individual/professional/validate";
import { mintShare, parseShare, revokeShare } from "@/lib/individual/professional/share";
import { audit, readBody, refuse } from "@/lib/individual/professional/api";

// /api/individual/professional/share -- COMPETEN-IND-007 s5. A revocable, time-limited Passport link.
//
// Reuses passport_share_tokens and the public /verify page (migration 122). The link also carries the
// person's own Professional records, each stating its evidence class, because the person chose to share
// from here (src/lib/individual/professional/share.ts). POST mints, PATCH ?id= revokes.
//
// ⚠ THE PERSON'S ACT, ALWAYS. Nothing shares automatically, and nothing is ever sent to an organisation:
// the person copies the link and gives it to whom they choose.

export async function POST(req: Request) {
  const ctx = await requireIndividualContext("professional");
  if (isGuardRefusal(ctx)) return ctx;
  const { fields } = await readBody(req);
  const input = parseShare(fields);
  const link = await mintShare(ctx.admin, ctx.userId, input);
  if (!link) return NextResponse.json({ error: "The link could not be created just now. Try again shortly." }, { status: 500 });
  await audit(ctx, "create_passport_share", "passport_share_token", link.id, { scope: input.scope, days: input.days, includes_own_records: true });
  return NextResponse.json({ ok: true, path: `/verify/${link.token}`, link }, { status: 201 });
}

export async function PATCH(req: Request) {
  const ctx = await requireIndividualContext("professional");
  if (isGuardRefusal(ctx)) return ctx;
  const id = new URL(req.url).searchParams.get("id");
  if (!isUuid(id)) return refuse("Choose a link.");
  if (!(await revokeShare(ctx.admin, ctx.userId, id))) return refuse("That link is not one of yours.", 404);
  await audit(ctx, "revoke_passport_share", "passport_share_token", id);
  return NextResponse.json({ ok: true });
}
