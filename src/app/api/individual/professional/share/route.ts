import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { isUuid } from "@/lib/individual/professional/validate";
import { activateShare, mintShare, parseShare, revokeShare } from "@/lib/individual/professional/share";
import { checkPassportRecords, parsePassportView } from "@/lib/individual/professional/share-passport";
import { loadIndividualPassport } from "@/lib/individual/passport";
import { checkShareLearning, parseShareLearning } from "@/lib/individual/professional/share-learning";
import { checkShareCompetencies, parseShareCompetencies } from "@/lib/individual/professional/share-competency";
import { loadLcpdConfig } from "@/lib/individual/lcpd-config";
import { audit, readBody, refuse } from "@/lib/individual/professional/api";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import { checkShareChoice, parseShareProfile } from "@/lib/individual/professional/share-profile";

// Request-time only: never prerendered, no client at build time (foundation harness 11a).
export const dynamic = "force-dynamic";

// COMPETEN-PROFESSIONAL-PASSPORT-01 (Stage 7, migration 540). Every link minted here is a PASSPORT VIEW: a purpose,
// an optional recipient label and summary, and the person's own records chosen one by one. It starts as a DRAFT
// (consent false, refused by /verify), the person previews exactly what the recipient will see, and PATCH
// { action: "activate" } makes it open. PATCH without an action revokes, as before.

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
  const input = parseShare(fields, (await loadIndividualPolicy(ctx.admin)).shareLinkMaxDays);
  const policy = await loadIndividualPolicy(ctx.admin);
  // COMPETEN-PROFESSIONAL-PROFILE-01 part B: the profile records the person ticked for this link, nothing else.
  const profile = parseShareProfile(fields);
  const choiceErr = await checkShareChoice(ctx.admin, ctx.userId, profile, policy.professionalProfile.shareSections);
  if (choiceErr) return refuse(choiceErr);
  // LCPD-01 LCPD-6: the completed learning the person ticked, each their own, completed and of a shareable kind.
  const learningIds = parseShareLearning(fields);
  const learnErr = await checkShareLearning(ctx.admin, ctx.userId, learningIds, await loadLcpdConfig(ctx.admin));
  if (learnErr) return refuse(learnErr);
  // COMPETENCY-01 S11: the competencies and parts the person ticked, each their own and current, parts the policy offers.
  const competencies = parseShareCompetencies(fields);
  const compErr = await checkShareCompetencies(ctx.admin, ctx.userId, competencies, policy.professionalCompetency.shareParts);
  if (compErr) return refuse(compErr);
  // PASSPORT-01 P4: the view and its own records, ticked one by one, of kinds the configuration lets a link carry.
  const view = parsePassportView(fields, policy.professionalPassport);
  if (!view.ok) return refuse(view.error);
  if (view.value.records.some(r => r.kind === "study" || r.kind === "scholar_evaluation")) {
    const passport = await loadIndividualPassport(ctx.admin, ctx.userId, new Date().toISOString().slice(0, 10));
    const recErr = await checkPassportRecords(ctx.admin, ctx.userId, view.value.records, {
      study: passport.study.ok ? passport.study.data.map(s => s.itemId).filter((v): v is string => !!v) : [],
      evaluations: passport.evaluations.ok ? passport.evaluations.data.map(e => e.itemId).filter((v): v is string => !!v) : [],
    });
    if (recErr) return refuse(recErr);
  } else {
    const recErr = await checkPassportRecords(ctx.admin, ctx.userId, view.value.records, { study: [], evaluations: [] });
    if (recErr) return refuse(recErr);
  }
  const link = await mintShare(ctx.admin, ctx.userId, input, profile, learningIds, competencies, view.value);
  if (!link) return NextResponse.json({ error: "The link could not be created just now. Try again shortly." }, { status: 500 });
  await audit(ctx, "create_passport_share", "passport_share_token", link.id, { scope: input.scope, days: input.days, includes_own_records: true, profile_overview: profile.overview, profile_records: profile.itemIds.length, learning_records: learningIds.length, competencies: competencies.length, own_records: view.value.records.length, include_institution: view.value.includeInstitution, draft: true });
  return NextResponse.json({ ok: true, path: `/verify/${link.token}`, link, draft: true }, { status: 201 });
}

export async function PATCH(req: Request) {
  const ctx = await requireIndividualContext("professional");
  if (isGuardRefusal(ctx)) return ctx;
  const id = new URL(req.url).searchParams.get("id");
  if (!isUuid(id)) return refuse("Choose a link.");
  const { fields } = await readBody(req).catch(() => ({ fields: {} as Record<string, unknown> }));
  if (fields.action === "activate") {
    if (!(await activateShare(ctx.admin, ctx.userId, id))) return refuse("That link is not one of your drafts.", 404);
    await audit(ctx, "activate_passport_share", "passport_share_token", id);
    return NextResponse.json({ ok: true });
  }
  if (!(await revokeShare(ctx.admin, ctx.userId, id))) return refuse("That link is not one of yours.", 404);
  await audit(ctx, "revoke_passport_share", "passport_share_token", id);
  return NextResponse.json({ ok: true });
}
