// Allow up to 60s for AI generation -- the same ceiling /api/me/copilot uses.
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { isMeteredRefusal, meteredRefusalBody, requestIdFor, runMeteredAi } from "@/lib/ai/allowance";
import { aiStatus } from "@/lib/ai/config";
import { checkAiQuota } from "@/lib/ai/quota";
import { individualAiQuota, individualQuotaRefusal, loadIndividualPolicy } from "@/lib/individual/policy";
import { individualPlanAiLimit } from "@/lib/individual/commerce";
import { currentTraceId } from "@/lib/trace";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { isExperienceKey } from "@/lib/individual/experiences";
import { loadIndividualPassport } from "@/lib/individual/passport";
import { cleanQuestion, recordContext, systemPrompt, QUESTION_MAX } from "@/lib/individual/assistant";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build
// (a build-time render would fail without the service key, or freeze the gate into static HTML).
export const dynamic = "force-dynamic";

// POST /api/individual/assistant -- COMPETEN-IND-003 s2(6), the personal AI entry point.
//
// Gate 3 first (requireIndividualContext, never getCaller -- see src/lib/individual/guard.ts), and the
// experience named in the body must be LIVE for this person. Then the estate's existing AI controls, in
// the order /api/me/copilot applies them: quota, configuration, generate() through the gateway (which
// writes plat_ai_requests), and an audit row.
//
// ⚠ THE AUDIT ACTION IS `ai_assistant_query` SO THE QUOTA COUNTS IT. checkAiQuota counts audit_log rows
// by action. A new action name would be an AI route the hourly limit cannot see. entity_type says which
// assistant it was.
//
// ⚠ ATTRIBUTION IS `person` (AI-LOG-001's AiAttribution, src/lib/ai/gateway.ts). A person in Competen
// Individual has no tenant and no workspace, so the usage row records the actor alone. Passing some other
// id as a tenant (a hospital, a workspace) is the foreign-key mismatch COMPETEN-IND-002 s2.7 found -- the
// insert fails and the usage row is silently lost.

// No GET: the assistant page reads aiStatus() on the server, and an unguarded GET would be an Individual
// entry point that answered while the release gate is off.

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const experience = body?.experience;
  const known = isExperienceKey(experience);

  // The guard (release gate, then gate 3) runs BEFORE any input validation, so a disabled Individual
  // answers 404 to every request rather than revealing which inputs it would have accepted.
  const ctx = await requireIndividualContext(known ? experience : undefined);
  if (isGuardRefusal(ctx)) return ctx;
  if (!known) return NextResponse.json({ error: "Unknown experience" }, { status: 400 });

  const question = cleanQuestion(body?.question);
  if (!question) return NextResponse.json({ error: `Ask a question of up to ${QUESTION_MAX} characters.` }, { status: 400 });

  // The estate limit (quota.ts, unchanged) and the Individual policy limit, whichever is tighter (CONFIG-002).
  const quota = individualAiQuota(await checkAiQuota(ctx.admin, ctx.userId), await loadIndividualPolicy(ctx.admin), await individualPlanAiLimit(ctx.admin, ctx.userId));
  // Fails CLOSED: an unreadable count is a 503 refusal, never a free pass (individualAiQuota).
  const refusal = individualQuotaRefusal(quota, "questions");
  if (refusal) return NextResponse.json({ error: refusal.error }, { status: refusal.status });
  if (!aiStatus().configured) return NextResponse.json({ error: "The personal AI is not configured on this environment." }, { status: 503 });

  const passport = await loadIndividualPassport(ctx.admin, ctx.userId, new Date().toISOString().slice(0, 10));
  const record = recordContext({ name: ctx.profile.fullName, experience, live: ctx.live, passport });

  // AI-FAIR-USE-01: through the Holdings allowance (atomic reservation, settlement). With metering off it is
  // generate() unchanged, behind the quota above.
  const result = await runMeteredAi(ctx.admin, {
    userId: ctx.userId, product: experience, activity: "assistant", requestId: requestIdFor(ctx.userId, req.headers.get("x-request-id")),
    generate: {
      system: systemPrompt(experience),
      user: `My Competen record:\n${record}\n\nMy question: ${question}`,
      tier: "reasoning",
      maxTokens: 900,
      context: { userId: ctx.userId, attribution: { scope: "person" }, operation: `individual_assistant_${experience}` },
    },
  });
  if (isMeteredRefusal(result)) { const m = meteredRefusalBody(result); return NextResponse.json(m.body, { status: m.status }); }
  if (!result.ok) {
    const status = result.error === "not_configured" ? 503 : 502;
    const msg = result.error === "refusal" ? "The assistant declined to answer that question." : "The assistant could not answer just now. Try again shortly.";
    return NextResponse.json({ error: msg }, { status });
  }

  await ctx.admin.from("audit_log").insert({
    trace_id: await currentTraceId(), actor_id: ctx.userId, actor_name: ctx.profile.fullName,
    action: "ai_assistant_query", entity_type: "individual_assistant", entity_id: null,
    new_value: { experience, question_chars: question.length, model: result.model },
  }).then((r: unknown) => r, () => {});

  return NextResponse.json({ answer: result.text });
}
