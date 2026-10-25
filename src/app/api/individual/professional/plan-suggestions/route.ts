import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import { isUuid } from "@/lib/individual/professional/validate";
import { AI_PLAN_KINDS, aiPlanQuestion, parseAiPlanLines, type AiPlanKind } from "@/lib/individual/professional/plan-form";
import { askProfessionalAssistant } from "@/lib/individual/professional/needs-ai";
import { audit, readBody, refuse } from "@/lib/individual/professional/api";

// Allow up to 60s for AI generation -- the ceiling the Professional assistant uses.
export const maxDuration = 60;
// Request-time only: never prerendered, no client at build time (foundation harness 11a).
export const dynamic = "force-dynamic";

// POST /api/individual/professional/plan-suggestions -- COMPETEN-PROFESSIONAL-PLAN-01, AI help with planning.
//
// { goalId, kind: activities | milestones | structure | evidence | review }. Asks the Holdings Personal AI (the same
// guard, fair use, model eligibility and gateway as every Professional AI call, through askProfessionalAssistant)
// about ONE goal of the person's own. NOTHING IS SAVED HERE: suggestions go back to the page, and each becomes part of
// the plan only when the person accepts it through the ordinary forms. Private reflections are never sent.
//
// Deterministic suggestions (competencies and courses that share the goal's words, milestones from its dates) are
// computed on the page and need no AI. Planning works fully without this route.

export async function POST(req: Request) {
  const ctx = await requireIndividualContext("professional");
  if (isGuardRefusal(ctx)) return ctx;
  const { fields } = await readBody(req);
  if ((await loadIndividualPolicy(ctx.admin)).professionalPlan.ai !== "on") return refuse("AI help with planning is turned off.");
  const kind = fields.kind as AiPlanKind;
  if (!AI_PLAN_KINDS.includes(kind)) return refuse("Choose what you would like help with.");
  if (!isUuid(fields.goalId)) return refuse("Choose a goal.");
  const { data: goal } = await ctx.admin.from("individual_professional_goal").select("id, title, intended_outcome").eq("id", fields.goalId).eq("user_id", ctx.userId).maybeSingle();
  if (!goal) return refuse("That goal is not on your record.", 404);
  const out = await askProfessionalAssistant(ctx, req, aiPlanQuestion(kind, goal));
  if (!out.ok) return NextResponse.json(out.body, { status: out.status });
  await audit(ctx, "individual_professional_plan_ai", "individual_professional_goal", goal.id, { kind, model: out.model });
  if (kind === "evidence" || kind === "review") return NextResponse.json({ ok: true, kind, text: out.answer.slice(0, 3000) });
  const items = parseAiPlanLines(out.answer);
  return NextResponse.json({ ok: true, kind, items, ...(items.length ? {} : { note: "The assistant did not suggest anything in a form that can be added. Try again, or add your own." }) });
}
