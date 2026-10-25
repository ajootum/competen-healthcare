import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import { loadCatalogueFor } from "@/lib/individual/catalogue";
import { isUuid } from "@/lib/individual/professional/validate";
import { linkCompetency, linkGoal, unlinkCompetency, unlinkGoal } from "@/lib/individual/professional/needs-store";
import { audit, readBody, refuse } from "@/lib/individual/professional/api";

// Request-time only: never prerendered, no client at build time (foundation harness 11a).
export const dynamic = "force-dynamic";

// /api/individual/professional/need-links -- COMPETEN-PROFESSIONAL-NEEDS-01 N5 and N9 (migration 470).
//
//   POST   { needId, kind: "competency", competencyId, outcome? } -- link a need to a competency OFFERED to
//          Professional (the catalogue allowlist), recording that catalogue's version. Many to many.
//   POST   { needId, kind: "goal", goalId } -- link an existing goal to the need. Many to many.
//   PATCH  { kind: "competency", linkId } unlinks, kept as history. { kind: "goal", needId, goalId } unlinks a goal.
//
// ⚠ A LINK IS NEVER A STATEMENT ABOUT COMPETENCE. It says the person wants to develop towards it. Nothing here reads
// evidence, results or verification. Competency links follow the policy (professional_need_competency_links), and a
// need works fully without any.

export async function POST(req: Request) {
  const ctx = await requireIndividualContext("professional");
  if (isGuardRefusal(ctx)) return ctx;
  const { fields } = await readBody(req);
  if (!isUuid(fields.needId)) return refuse("Choose a need.");
  const { data: need } = await ctx.admin.from("individual_professional_need").select("id").eq("id", fields.needId).eq("user_id", ctx.userId).maybeSingle();
  if (!need) return refuse("That need is not on your record.", 404);

  if (fields.kind === "competency") {
    if ((await loadIndividualPolicy(ctx.admin)).professionalNeeds.competencyLinks !== "offered") return refuse("Linking needs to competencies is turned off.");
    if (!isUuid(fields.competencyId)) return refuse("Choose a competency.");
    const offered = await loadCatalogueFor(ctx.admin, "professional");
    if (offered === null) return refuse("The competencies could not be checked just now. Try again shortly.", 503);
    const outcome = typeof fields.outcome === "string" && fields.outcome.trim() ? fields.outcome.trim() : null;
    const out = await linkCompetency(ctx.admin, ctx.userId, need.id, fields.competencyId, offered, outcome);
    if (!out.ok) return refuse(out.error, out.status);
    await audit(ctx, "individual_professional_need_competency_link", "individual_professional_need", need.id, { competency: fields.competencyId });
    return NextResponse.json({ ok: true, id: out.id }, { status: 201 });
  }
  if (fields.kind === "goal") {
    if (!isUuid(fields.goalId)) return refuse("Choose a goal.");
    const out = await linkGoal(ctx.admin, ctx.userId, fields.goalId, need.id);
    if (!out.ok) return refuse(out.error, out.status);
    await audit(ctx, "individual_professional_need_goal_link", "individual_professional_need", need.id, { goal: fields.goalId });
    return NextResponse.json({ ok: true }, { status: 201 });
  }
  return refuse("Choose what to link.");
}

export async function PATCH(req: Request) {
  const ctx = await requireIndividualContext("professional");
  if (isGuardRefusal(ctx)) return ctx;
  const { fields } = await readBody(req);
  if (fields.kind === "competency") {
    if (!isUuid(fields.linkId)) return refuse("Choose a link.");
    const out = await unlinkCompetency(ctx.admin, ctx.userId, fields.linkId);
    if (!out.ok) return refuse(out.error, out.status);
    await audit(ctx, "individual_professional_need_competency_unlink", "individual_professional_need_competency", fields.linkId);
    return NextResponse.json({ ok: true });
  }
  if (fields.kind === "goal") {
    if (!isUuid(fields.goalId) || !isUuid(fields.needId)) return refuse("Choose a goal and a need.");
    const out = await unlinkGoal(ctx.admin, ctx.userId, fields.goalId, fields.needId);
    if (!out.ok) return refuse(out.error, out.status);
    await audit(ctx, "individual_professional_need_goal_unlink", "individual_professional_need", fields.needId, { goal: fields.goalId });
    return NextResponse.json({ ok: true });
  }
  return refuse("Choose what to unlink.");
}
