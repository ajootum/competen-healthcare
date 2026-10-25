import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import { audit, readBody, refuse } from "@/lib/individual/professional/api";
import { addAnnotation, evaluationOf } from "@/lib/individual/professional/evaluation-store";
import { parseAnnotation } from "@/lib/individual/professional/evaluation-form";

// Request-time only: never prerendered, no client at build time (foundation harness 11a).
export const dynamic = "force-dynamic";

// POST /api/individual/professional/evaluation-annotations -- COMPETEN-PROFESSIONAL-EVALUATION-01 E5.
//
// { evaluationId, body, templateCode?, supersedesId? }. An optional private note on the person's own snapshot.
// Append-only (530): a revision is a new note naming the earlier one. Never shared, never sent to AI.

export async function POST(req: Request) {
  const ctx = await requireIndividualContext("professional");
  if (isGuardRefusal(ctx)) return ctx;
  const { fields } = await readBody(req);
  const p = parseAnnotation(fields, (await loadIndividualPolicy(ctx.admin)).professionalEvaluation.templates);
  if (!p.ok) return refuse(p.error);
  if (!(await evaluationOf(ctx.admin, ctx.userId, p.value.evaluationId))) return refuse("That evaluation is not on your record.", 404);
  const made = await addAnnotation(ctx.admin, ctx.userId, p.value.evaluationId, p.value);
  if (!made.ok) return refuse(made.error, made.status);
  await audit(ctx, "individual_professional_evaluation_annotate", "individual_professional_evaluation", p.value.evaluationId, { revises: p.value.supersedesId });
  return NextResponse.json({ ok: true, id: made.id }, { status: 201 });
}
