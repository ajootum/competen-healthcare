import { meteredRefusalBody, requestIdFor } from "@/lib/ai/allowance";
import { aiStatus } from "@/lib/ai/config";
import { checkAiQuota } from "@/lib/ai/quota";
import { runIndividualAssistant } from "../personal-ai";
import { individualAiQuota, individualQuotaRefusal, loadIndividualPolicy } from "../policy";
import { individualPlanAiLimit } from "../commerce";
import type { IndividualContext } from "../guard";
import { professionalLegacyQuotaApplies } from "./ai-quota";

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
    const refusal = individualQuotaRefusal(quota, "questions");
    if (refusal) return { ok: false, status: refusal.status, body: { error: refusal.error } };
  }
  if (!aiStatus().configured) return { ok: false, status: 503, body: { error: "The personal AI is not configured on this environment." } };
  const out = await runIndividualAssistant(ctx.admin, {
    userId: ctx.userId, fullName: ctx.profile.fullName, live: ctx.live, experience: "professional", mode: "development", question,
    requestId: requestIdFor(ctx.userId, req.headers.get("x-request-id")),
  });
  if (!out.ok && out.kind === "invalid") return { ok: false, status: out.status, body: { error: out.error } };
  if (!out.ok && out.kind === "metered") { const m = meteredRefusalBody(out.refusal); return { ok: false, status: m.status, body: m.body }; }
  if (!out.ok) {
    const status = out.result.error === "not_configured" ? 503 : 502;
    return { ok: false, status, body: { error: out.result.error === "refusal" ? "The assistant declined that request." : "The assistant could not answer just now. Try again shortly." } };
  }
  return { ok: true, answer: out.answer, model: out.model ?? null };
}
