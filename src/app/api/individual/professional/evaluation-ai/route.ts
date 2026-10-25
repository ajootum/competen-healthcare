import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import { audit, readBody, refuse, todayUtc } from "@/lib/individual/professional/api";
import { askProfessionalAssistant } from "@/lib/individual/professional/needs-ai";
import { evaluate } from "@/lib/individual/professional/evaluation";
import { loadEvaluationInput } from "@/lib/individual/professional/evaluation-sources";
import { currentConfigVersion } from "@/lib/individual/professional/evaluation-store";
import { parseScope } from "@/lib/individual/professional/evaluation-form";
import { aiEvaluationQuestion, aiPolicyVersion, sha256, EVALUATION_AI_ACTION } from "@/lib/individual/professional/evaluation-ai";

// Allow up to 60s for AI generation -- the ceiling the Professional assistant uses.
export const maxDuration = 60;
// Request-time only: never prerendered, no client at build time (foundation harness 11a).
export const dynamic = "force-dynamic";

// POST /api/individual/professional/evaluation-ai -- COMPETEN-PROFESSIONAL-EVALUATION-01 s11.
//
// { scope, ref?, outcome? }. Asks the Holdings Personal AI (askProfessionalAssistant: the same guard, fair use, model
// eligibility and gateway as every Professional AI call) to summarise the DETERMINISTIC findings it is sent. Nothing is
// saved but an ids-only audit row (model, policy version, sha256 of the answer), which is what lets a snapshot carry
// this text as labelled AI. Private reflections and notes are never sent. Evaluation works fully without this route.

export async function POST(req: Request) {
  const ctx = await requireIndividualContext("professional");
  if (isGuardRefusal(ctx)) return ctx;
  const { fields } = await readBody(req);
  const policy = (await loadIndividualPolicy(ctx.admin)).professionalEvaluation;
  if (policy.ai !== "on") return refuse("AI help with evaluation is turned off.");
  const scope = parseScope(fields, policy);
  if (!scope.ok) return refuse(scope.error);
  const { input } = await loadEvaluationInput(ctx.admin, ctx.userId, todayUtc());
  const ev = evaluate(input, scope.value, policy);
  if (!ev) return refuse("That is not on your record.", 404);
  const out = await askProfessionalAssistant(ctx, req, aiEvaluationQuestion(ev));
  if (!out.ok) return NextResponse.json(out.body, { status: out.status });
  const text = out.answer.trim().slice(0, 8000);
  const model = out.model ?? "unrecorded";
  const policyVersion = aiPolicyVersion(await currentConfigVersion(ctx.admin));
  await audit(ctx, EVALUATION_AI_ACTION, "individual_professional_evaluation", null, { scope_kind: ev.scope.kind, model, policy_version: policyVersion, text_sha256: sha256(text) });
  return NextResponse.json({ ok: true, text, model, policyVersion });
}
