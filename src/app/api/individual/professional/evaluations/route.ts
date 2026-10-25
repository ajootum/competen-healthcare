import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import { audit, readBody, refuse, todayUtc } from "@/lib/individual/professional/api";
import { evaluate } from "@/lib/individual/professional/evaluation";
import { loadEvaluationInput } from "@/lib/individual/professional/evaluation-sources";
import { currentConfigVersion, evaluationOf, recordEvaluation } from "@/lib/individual/professional/evaluation-store";
import { parseCorrection, parseScope } from "@/lib/individual/professional/evaluation-form";
import { aiProvenanceHolds } from "@/lib/individual/professional/evaluation-ai";

// Request-time only: never prerendered, no client at build time (foundation harness 11a).
export const dynamic = "force-dynamic";

// POST /api/individual/professional/evaluations -- COMPETEN-PROFESSIONAL-EVALUATION-01 E5, record a snapshot.
//
// { scope, ref?, outcome?, from?, to?, ai?: { text, model, policyVersion }, supersedesId?, correctionNote? }. The
// evaluation is RECOMPUTED HERE from the person's own records, never taken from the browser, and stored as an immutable
// snapshot (migration 530). AI text is kept only when the AI route recorded that exact answer for this person (its audit
// row), labelled as AI. A correction names the person's own earlier snapshot of the same scope and says why. Nothing
// else is written: no source record is touched.

export async function POST(req: Request) {
  const ctx = await requireIndividualContext("professional");
  if (isGuardRefusal(ctx)) return ctx;
  const { fields } = await readBody(req);
  const policy = (await loadIndividualPolicy(ctx.admin)).professionalEvaluation;
  const scope = parseScope(fields, policy);
  if (!scope.ok) return refuse(scope.error);
  const correction = parseCorrection(fields);
  if (!correction.ok) return refuse(correction.error);
  if (correction.value) {
    if (policy.corrections !== "linked") return refuse("Corrections are not offered. Record a new evaluation instead.");
    const orig = await evaluationOf(ctx.admin, ctx.userId, correction.value.id);
    if (!orig) return refuse("That evaluation is not on your record.", 404);
    if (orig.scope_kind !== scope.value.kind || (orig.scope_ref ?? null) !== (scope.value.ref ?? null)) return refuse("A correction evaluates the same thing as the evaluation it corrects.");
  }
  let ai: { text: string; model: string; policyVersion: string } | null = null;
  const a = fields.ai as Record<string, unknown> | undefined;
  if (a && typeof a === "object" && typeof a.text === "string" && a.text.trim()) {
    if (policy.ai !== "on") return refuse("AI help with evaluation is turned off.");
    if (typeof a.model !== "string" || typeof a.policyVersion !== "string") return refuse("The AI summary is incomplete. Ask again, or record without it.");
    ai = { text: a.text.trim().slice(0, 8000), model: a.model, policyVersion: a.policyVersion };
    if (!(await aiProvenanceHolds(ctx.admin, ctx.userId, ai))) return refuse("That AI summary could not be matched to your request. Ask again, or record without it.");
  }
  const today = todayUtc();
  const { input, context } = await loadEvaluationInput(ctx.admin, ctx.userId, today);
  const ev = evaluate(input, scope.value, policy);
  if (!ev) return refuse("That is not on your record.", 404);
  const made = await recordEvaluation(ctx.admin, ctx.userId, ev, { context, policy, configVersion: await currentConfigVersion(ctx.admin), ai, supersedes: correction.value });
  if (!made.ok) return refuse(made.error, made.status);
  await audit(ctx, "individual_professional_evaluation_record", "individual_professional_evaluation", made.id,
    { scope_kind: ev.scope.kind, sources: ev.sources.length, ai: !!ai, corrects: correction.value?.id ?? null });
  return NextResponse.json({ ok: true, id: made.id }, { status: 201 });
}
