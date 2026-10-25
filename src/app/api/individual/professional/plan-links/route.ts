import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import { loadCatalogueFor } from "@/lib/individual/catalogue";
import { isUuid } from "@/lib/individual/professional/validate";
import {
  linkActivityGoal, linkCpdToGoal, linkGoalEvidence, linkPlanCompetency, unlinkActivityGoal, unlinkGoalEvidence, unlinkPlanCompetency,
} from "@/lib/individual/professional/plan-store";
import { linkGoal, unlinkGoal } from "@/lib/individual/professional/needs-store";
import { audit, readBody, refuse } from "@/lib/individual/professional/api";

// Request-time only: never prerendered, no client at build time (foundation harness 11a).
export const dynamic = "force-dynamic";

// /api/individual/professional/plan-links -- COMPETEN-PROFESSIONAL-PLAN-01 P3 and P5 (migration 480).
//
// POST links, PATCH unlinks. kind:
//   activity    { activityId, goalId }                       an activity serves a goal (many to many, ordered)
//   need        { goalId, needId }                           a goal serves a need (the 470 join, through needs-store)
//   competency  { goalId | activityId, competencyId, outcome? }  an OFFERED competency, with its framework version
//   evidence    { goalId, evidenceId | reflectionId }        an existing evidence item or private reflection
//   record      { goalId, cpdId | learningRecordId }         retrospective: what already happened served this goal
// A competency or evidence link is unlinked (kept as history), never deleted. Nothing is copied from any source.

export async function POST(req: Request) {
  const ctx = await requireIndividualContext("professional");
  if (isGuardRefusal(ctx)) return ctx;
  const { fields } = await readBody(req);
  const goalId = isUuid(fields.goalId) ? fields.goalId : null;
  switch (fields.kind) {
    case "activity": {
      if (!goalId || !isUuid(fields.activityId)) return refuse("Choose an activity and a goal.");
      const out = await linkActivityGoal(ctx.admin, ctx.userId, fields.activityId, goalId);
      if (!out.ok) return refuse(out.error, out.status);
      await audit(ctx, "individual_professional_activity_goal_link", "individual_professional_goal", goalId, { activity: fields.activityId });
      return NextResponse.json({ ok: true });
    }
    case "need": {
      if (!goalId || !isUuid(fields.needId)) return refuse("Choose a goal and a need.");
      const out = await linkGoal(ctx.admin, ctx.userId, goalId, fields.needId);
      if (!out.ok) return refuse(out.error, out.status);
      await audit(ctx, "individual_professional_goal_need_link", "individual_professional_goal", goalId, { need: fields.needId });
      return NextResponse.json({ ok: true });
    }
    case "competency": {
      const subject = goalId ? { goalId } : isUuid(fields.activityId) ? { activityId: fields.activityId } : null;
      if (!subject || !isUuid(fields.competencyId)) return refuse("Choose a competency.");
      if ((await loadIndividualPolicy(ctx.admin)).professionalPlan.competencyLinks !== "offered") return refuse("Competency links are turned off.");
      const offered = await loadCatalogueFor(ctx.admin, "professional");
      if (!offered) return refuse("The competencies could not be read just now.", 503);
      const outcome = typeof fields.outcome === "string" && fields.outcome.trim() ? fields.outcome.trim() : null;
      const out = await linkPlanCompetency(ctx.admin, ctx.userId, subject, fields.competencyId, offered, outcome);
      if (!out.ok) return refuse(out.error, out.status);
      await audit(ctx, "individual_professional_plan_competency_link", "individual_professional_plan_competency", out.id, { competency: fields.competencyId });
      return NextResponse.json({ ok: true, id: out.id }, { status: 201 });
    }
    case "evidence": {
      const ref = isUuid(fields.evidenceId) ? { evidenceId: fields.evidenceId } : isUuid(fields.reflectionId) ? { reflectionId: fields.reflectionId } : null;
      if (!goalId || !ref) return refuse("Choose the evidence and the goal.");
      const out = await linkGoalEvidence(ctx.admin, ctx.userId, goalId, ref);
      if (!out.ok) return refuse(out.error, out.status);
      await audit(ctx, "individual_professional_goal_evidence_link", "individual_professional_goal_evidence", out.id, { kind: "evidenceId" in ref ? "evidence" : "reflection" });
      return NextResponse.json({ ok: true, id: out.id }, { status: 201 });
    }
    case "record": {
      const ref = isUuid(fields.cpdId) ? { cpdId: fields.cpdId } : isUuid(fields.learningRecordId) ? { learningRecordId: fields.learningRecordId } : null;
      if (!goalId || !ref) return refuse("Choose the CPD entry or learning record, and the goal.");
      const out = await linkCpdToGoal(ctx.admin, ctx.userId, goalId, ref);
      if (!out.ok) return refuse(out.error, out.status);
      await audit(ctx, "individual_professional_goal_record_link", "individual_professional_goal", goalId, { activity: out.activityId, kind: "cpdId" in ref ? "cpd" : "learning" });
      return NextResponse.json({ ok: true, activityId: out.activityId });
    }
    default:
      return refuse("Choose what to link.");
  }
}

export async function PATCH(req: Request) {
  const ctx = await requireIndividualContext("professional");
  if (isGuardRefusal(ctx)) return ctx;
  const { fields } = await readBody(req);
  if (fields.kind === "activity" && isUuid(fields.activityId) && isUuid(fields.goalId)) {
    const out = await unlinkActivityGoal(ctx.admin, ctx.userId, fields.activityId, fields.goalId);
    if (!out.ok) return refuse(out.error, out.status);
    await audit(ctx, "individual_professional_activity_goal_unlink", "individual_professional_goal", fields.goalId, { activity: fields.activityId });
    return NextResponse.json({ ok: true });
  }
  if (fields.kind === "need" && isUuid(fields.goalId) && isUuid(fields.needId)) {
    const out = await unlinkGoal(ctx.admin, ctx.userId, fields.goalId, fields.needId);
    if (!out.ok) return refuse(out.error, out.status);
    await audit(ctx, "individual_professional_goal_need_unlink", "individual_professional_goal", fields.goalId, { need: fields.needId });
    return NextResponse.json({ ok: true });
  }
  if ((fields.kind === "competency" || fields.kind === "evidence") && isUuid(fields.linkId)) {
    const out = fields.kind === "competency" ? await unlinkPlanCompetency(ctx.admin, ctx.userId, fields.linkId) : await unlinkGoalEvidence(ctx.admin, ctx.userId, fields.linkId);
    if (!out.ok) return refuse(out.error, out.status);
    await audit(ctx, `individual_professional_${fields.kind === "competency" ? "plan_competency" : "goal_evidence"}_unlink`, `individual_professional_${fields.kind === "competency" ? "plan_competency" : "goal_evidence"}`, fields.linkId);
    return NextResponse.json({ ok: true });
  }
  return refuse("Choose what to unlink.");
}
