import { meteredRefusalBody, requestIdFor } from "@/lib/ai/allowance";
import { aiStatus } from "@/lib/ai/config";
import { checkAiQuota } from "@/lib/ai/quota";
import { runIndividualAssistant } from "../personal-ai";
import { individualAiQuota, individualQuotaRefusal, loadIndividualPolicy } from "../policy";
import { individualPlanAiLimit } from "../commerce";
import { pilotQuotaRefusal } from "../pilot-ai";
import type { IndividualContext } from "../guard";
import { professionalLegacyQuotaApplies } from "./ai-quota";
import { AI_ERROR, aiErrorBody, aiErrorKindOf } from "../ai-error";

// ── THE PERSONAL AI FOR DEVELOPMENT NEEDS ── COMPETEN-PROFESSIONAL-NEEDS-01 N4 and N7 ─────────────────────────────
//
// The Holdings Personal AI in Professional's development mode, with the SAME controls, in the same order, as the
// Professional assistant route (src/app/api/individual/professional/assistant/route.ts): the caller's guard, ONE AI
// limit at a time (the legacy quota only while metering is off, the metered allowance and model eligibility inside
// runIndividualAssistant otherwise), configuration, then the gateway with person attribution, its identifier screen
// and audit. Grounding is the person's own Professional record (and profile, where the privacy policy allows it).
// Nothing is stored here: the caller stores suggestions privately, only as suggestions.

export type AskOutcome = { ok: true; answer: string; model: string | null } | { ok: false; status: number; body: Record<string, unknown> };

export async function askProfessionalAssistant(ctx: IndividualContext, req: Request, question: string): Promise<AskOutcome> {
  if (await professionalLegacyQuotaApplies(ctx.admin)) {
    const quota = individualAiQuota(await checkAiQuota(ctx.admin, ctx.userId), await loadIndividualPolicy(ctx.admin), await individualPlanAiLimit(ctx.admin, ctx.userId));
    const refusal = await pilotQuotaRefusal(ctx.admin, "professional", ctx.userId, quota, individualQuotaRefusal(quota, "questions"), "questions");
    if (refusal) return { ok: false, status: refusal.status, body: { error: refusal.error } };
  }
  // LEARNING-CLOSE-2026-11 D06 / LE-01: the shared words and code (ai-error.ts), the same as Scholar's routes.
  if (!aiStatus().configured) return { ok: false, status: AI_ERROR.not_configured.status, body: aiErrorBody("not_configured") };
  const out = await runIndividualAssistant(ctx.admin, {
    userId: ctx.userId, fullName: ctx.profile.fullName, live: ctx.live, experience: "professional", mode: "development", question,
    requestId: requestIdFor(ctx.userId, req.headers.get("x-request-id")),
  });
  if (!out.ok && out.kind === "invalid") return { ok: false, status: out.status, body: { error: out.error } };
  if (!out.ok && out.kind === "metered") { const m = meteredRefusalBody(out.refusal); return { ok: false, status: m.status, body: m.body }; }
  if (!out.ok) { const kind = aiErrorKindOf(out.result.error); return { ok: false, status: AI_ERROR[kind].status, body: aiErrorBody(kind) }; }
  return { ok: true, answer: out.answer, model: out.model ?? null };
}
