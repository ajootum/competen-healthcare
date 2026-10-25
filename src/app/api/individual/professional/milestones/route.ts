import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import { isUuid, isoDate } from "@/lib/individual/professional/validate";
import { parseMilestone } from "@/lib/individual/professional/plan-form";
import { addMilestone, deleteMilestone, setMilestoneAchieved } from "@/lib/individual/professional/plan-store";
import { audit, readBody, refuse } from "@/lib/individual/professional/api";

// Request-time only: never prerendered, no client at build time (foundation harness 11a).
export const dynamic = "force-dynamic";

// /api/individual/professional/milestones -- COMPETEN-PROFESSIONAL-PLAN-01 P4 (migration 480). Optional milestones on a
// goal: POST { goalId, title, type?, dueOn? }, PATCH { id, achievedOn | achievedOn: "" to undo }, DELETE ?id=. A
// milestone reached is the person's own note of progress. It achieves no goal and verifies nothing.

export async function POST(req: Request) {
  const ctx = await requireIndividualContext("professional");
  if (isGuardRefusal(ctx)) return ctx;
  const { fields } = await readBody(req);
  if (!isUuid(fields.goalId)) return refuse("Choose a goal.");
  const m = parseMilestone(fields, (await loadIndividualPolicy(ctx.admin)).professionalPlan);
  if (!m.ok) return refuse(m.error);
  const out = await addMilestone(ctx.admin, ctx.userId, fields.goalId, m.value);
  if (!out.ok) return refuse(out.error, out.status);
  await audit(ctx, "individual_professional_milestone_create", "individual_professional_milestone", out.id, { goal: fields.goalId, suggested: fields.suggested === "ai" ? "ai" : fields.suggested === "rule" ? "rule" : null });
  return NextResponse.json({ ok: true, id: out.id }, { status: 201 });
}

export async function PATCH(req: Request) {
  const ctx = await requireIndividualContext("professional");
  if (isGuardRefusal(ctx)) return ctx;
  const { fields } = await readBody(req);
  if (!isUuid(fields.id)) return refuse("Choose a milestone.");
  const on = isoDate(fields.achievedOn);
  if (on === undefined) return refuse("That is not a real date.");
  const out = await setMilestoneAchieved(ctx.admin, ctx.userId, fields.id, on);
  if (!out.ok) return refuse(out.error, out.status);
  await audit(ctx, "individual_professional_milestone_achieved", "individual_professional_milestone", fields.id, { achieved: !!on });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const ctx = await requireIndividualContext("professional");
  if (isGuardRefusal(ctx)) return ctx;
  const id = new URL(req.url).searchParams.get("id");
  if (!isUuid(id)) return refuse("Choose a milestone.");
  const out = await deleteMilestone(ctx.admin, ctx.userId, id);
  if (!out.ok) return refuse(out.error, out.status);
  await audit(ctx, "individual_professional_milestone_delete", "individual_professional_milestone", id);
  return NextResponse.json({ ok: true });
}
