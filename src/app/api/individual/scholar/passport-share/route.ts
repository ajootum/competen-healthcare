import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { isUuid } from "@/lib/individual/professional/validate";
import { activateShare, listShares, mintShare, parseShare, revokeShare } from "@/lib/individual/professional/share";
import { checkPassportRecords, parsePassportView, scholarViewRefusal } from "@/lib/individual/professional/share-passport";
import { loadIndividualPassport } from "@/lib/individual/passport";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import { audit, readBody, refuse } from "@/lib/individual/professional/api";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build.
export const dynamic = "force-dynamic";

// /api/individual/scholar/passport-share -- PRODUCT-EXPERIENCE P4 (owner Option A, 26 Oct): a Scholar learner shares
// formative records from their Passport. The SAME Passport links as Professional (passport_share_tokens, the 540
// record-level view, /verify), made in Scholar:
//
//   POST          { record:study:<id> | record:scholar_evaluation:<id>, purpose?, recipient?, summary?, days? } a DRAFT
//                 view carrying exactly the records ticked -- study achievements and evaluations already on the
//                 person's Passport (375, 427), nothing else. Closed to everyone until activated.
//   PATCH ?id=    { action: "activate" } opens the draft once. Without an action: withdraws the link.
//
// ⚠ ONLY WHAT WAS TICKED, ONLY FORMATIVE. No Professional record, no organisation record, no AI text, notes or
// reflections: the parser has no field for them, scholarViewRefusal refuses any other kind, and checkPassportRecords
// refuses a record that is not on the person's Passport. /verify labels each one formative, never verified.
// ⚠ ONLY THE PERSON'S OWN SCHOLAR LINKS are activated or withdrawn here.

export async function POST(req: Request) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const { fields } = await readBody(req);
  const policy = await loadIndividualPolicy(ctx.admin);
  const input = parseShare(fields, policy.shareLinkMaxDays);
  const view = parsePassportView(fields, policy.professionalPassport);
  if (!view.ok) return refuse(view.error);
  const notScholar = scholarViewRefusal(view.value);
  if (notScholar) return refuse(notScholar);
  const passport = await loadIndividualPassport(ctx.admin, ctx.userId, new Date().toISOString().slice(0, 10));
  const recErr = await checkPassportRecords(ctx.admin, ctx.userId, view.value.records, {
    study: passport.study.ok ? passport.study.data.map(s => s.itemId).filter((v): v is string => !!v) : [],
    evaluations: passport.evaluations.ok ? passport.evaluations.data.map(e => e.itemId).filter((v): v is string => !!v) : [],
  });
  if (recErr) return refuse(recErr);
  const link = await mintShare(ctx.admin, ctx.userId, input, { overview: false, itemIds: [] }, [], [], view.value, [], "scholar");
  if (!link) return NextResponse.json({ error: "The link could not be created just now. Try again shortly." }, { status: 500 });
  await audit(ctx, "create_passport_share", "passport_share_token", link.id, { experience: "scholar", days: input.days, own_records: view.value.records.length, draft: true });
  return NextResponse.json({ ok: true, path: `/verify/${link.token}`, link, draft: true }, { status: 201 });
}

export async function PATCH(req: Request) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const id = new URL(req.url).searchParams.get("id");
  if (!isUuid(id)) return refuse("Choose a link.");
  const mine = await listShares(ctx.admin, ctx.userId, "scholar");
  if (mine === null) return refuse("Your links could not be read just now. Try again.", 503);
  if (!mine.some(l => l.id === id)) return refuse("That is not one of your Scholar links.", 404);
  const { fields } = await readBody(req).catch(() => ({ fields: {} as Record<string, unknown> }));
  if (fields.action === "activate") {
    if (!(await activateShare(ctx.admin, ctx.userId, id))) return refuse("That link is not one of your drafts.", 404);
    await audit(ctx, "activate_passport_share", "passport_share_token", id, { experience: "scholar" });
    return NextResponse.json({ ok: true });
  }
  if (!(await revokeShare(ctx.admin, ctx.userId, id))) return refuse("That link could not be withdrawn.", 404);
  await audit(ctx, "revoke_passport_share", "passport_share_token", id, { experience: "scholar" });
  return NextResponse.json({ ok: true });
}
